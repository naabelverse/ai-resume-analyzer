import "server-only";

/**
 * A fixed-window limiter, per IP, in process memory.
 *
 * Two honest caveats, both documented in the README rather than hidden:
 *
 *   1. On serverless it is per-instance. Five requests per instance, not five
 *      globally. It raises the cost of casual abuse; it is not a security
 *      control, and pretending otherwise would be the mistake.
 *   2. It trusts `x-forwarded-for`, which a client can forge unless something
 *      trustworthy sits in front. Behind Vercel or any normal reverse proxy
 *      that header is rewritten and safe to use. Directly exposed, it is not.
 *
 * The alternative — Redis or Vercel KV — is the right answer for real traffic
 * and the wrong answer for a project whose whole point is that it runs with no
 * infrastructure on first clone.
 */

export const WINDOW_MS = 10 * 60 * 1000;
export const MAX_REQUESTS = 5;

/**
 * The preview endpoint's own ceiling, deliberately far above the analyse one.
 *
 * The two requests cost different things. An analysis is a model call against
 * metered credits; a preview is one PDF or DOCX parse, measured well under
 * 230ms. Sharing a counter would mean that looking at five files left you
 * unable to analyse any of them — the limiter punishing the exact care this
 * feature exists to encourage.
 *
 * So this bucket is not rationing normal use. It exists only to stop the
 * endpoint being farmed as a free document-to-text service, and 30 in ten
 * minutes sits comfortably past what picking, checking and re-picking a resume
 * takes while staying far below what would make farming it worthwhile.
 */
export const MAX_PREVIEW_REQUESTS = 30;

/**
 * The feedback endpoint has two ceilings, because it has two costs.
 *
 * A send is a call to a metered third party. Everything else — a malformed
 * body, a honeypot hit, a message that failed validation — is a JSON parse and
 * some string checks, and never leaves the process. One counter covering both
 * makes the cheap path spend the expensive path's allowance, which is how
 * somebody who mistyped their email address twice ends up unable to report the
 * bug they came to report.
 *
 * So: `MAX_FEEDBACK_SENDS` is charged at the send and nowhere else, and
 * `MAX_FEEDBACK_REQUESTS` is charged on every request that reaches the route.
 *
 * Three sends in ten minutes, because nobody writes their third distinct bug
 * report that fast, and because a send that FAILS is still charged — it cost a
 * real API call, and making failures free would leave the expensive path
 * unbounded during exactly the outage that would attract the most retries.
 *
 * Twenty requests in ten minutes is the second, cheaper ceiling. A real person
 * cannot reach it: three sends plus every typo and rethink along the way is
 * nowhere near twenty. A bot posting junk reaches it quickly and stops, which
 * is the whole job — without it, metering only the send would leave the
 * honeypot and validation paths free to hammer forever.
 *
 * The two caveats at the top of this file apply to both and are not softened
 * by the low numbers: per-instance on serverless, and the counters reset on
 * redeploy. This raises the cost of casual abuse. It will not hold up at
 * scale, and it is not a security control.
 */
export const MAX_FEEDBACK_SENDS = 3;
export const MAX_FEEDBACK_REQUESTS = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Drops expired buckets so the map cannot grow without bound. */
function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  now = Date.now(),
  max = MAX_REQUESTS,
): RateLimitVerdict {
  prune(now);

  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: max - existing.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Namespaces a key so two endpoints with different costs cannot draw on one
 * allowance. The prefix is part of the key rather than a second Map, so
 * pruning and `resetRateLimits` keep working on both without knowing they
 * exist.
 */
export function previewKeyFrom(request: Request): string {
  return `preview:${clientKeyFrom(request)}`;
}

/**
 * The feedback buckets, prefixed for the same reason `preview:` is: sending a
 * bug report must not spend an analysis, and being out of analyses must not
 * stop someone telling us why.
 *
 * Two of them, one per ceiling above. Separate prefixes rather than separate
 * Maps, so pruning and `resetRateLimits` keep working on both without knowing
 * they exist.
 *
 * `checkRateLimit` is what makes the split work: it declines *without*
 * incrementing when a bucket is already at its cap, so calling it immediately
 * before the send charges only the requests that got that far. Nothing needs
 * to peek first.
 */
export function feedbackSendKeyFrom(request: Request): string {
  return `feedback:send:${clientKeyFrom(request)}`;
}

export function feedbackRequestKeyFrom(request: Request): string {
  return `feedback:req:${clientKeyFrom(request)}`;
}

/**
 * `x-forwarded-for` is a comma-separated chain; the client is the first entry.
 * Falls back to a shared bucket rather than to something spoofable, so an
 * absent header means "everyone shares one limit", not "no limit".
 */
export function clientKeyFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam. Never called by application code. */
export function resetRateLimits(): void {
  buckets.clear();
}
