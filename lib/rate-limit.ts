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
): RateLimitVerdict {
  prune(now);

  const existing = buckets.get(key);
  if (!existing) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: MAX_REQUESTS - existing.count,
    retryAfterSeconds: 0,
  };
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
