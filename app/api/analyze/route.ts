import { analyzeResume } from "@/lib/ai/analyze";
import { getEnv, isAiConfigured, PROVIDER_KEY_VAR } from "@/lib/env";
import {
  AppError,
  JobDescriptionTooLongError,
  RateLimitedError,
  UnsupportedFileError,
  type ErrorCode,
} from "@/lib/errors";
import { extractResume } from "@/lib/extract";
import { JD_MAX_CHARS } from "@/lib/limits";
import { checkRateLimit, clientKeyFrom } from "@/lib/rate-limit";
import {
  buildDegradedResult,
  runDeterministicChecks,
  summariseChecksForModel,
} from "@/lib/scoring";
import type { AnalysisMeta, AnalyzeResponse } from "@/types";

/**
 * The platform's hard ceiling for this function, in seconds.
 *
 * It must exceed the WHOLE worst case, not one model call:
 *
 *   ANALYZE_MAX_ATTEMPTS x AI_TIMEOUT_MS + NON_AI_BUDGET_MS
 *     = 2 x 120s + 5s = 245s, inside 300s with 55s to spare.
 *
 * This was 120 — Vercel's cap, which is what made AI_TIMEOUT_MS 50s. The app
 * deploys to Railway, which does not cap function duration, and on a
 * long-running Node server this segment config has no runtime effect at all.
 * It is kept because the invariant is worth keeping honest: it is the one
 * place that states what a single request is allowed to cost, and the test
 * below holds AI_TIMEOUT_MS to it. Deploying somewhere that DOES enforce a
 * ceiling means lowering both numbers together, not discovering the arithmetic
 * in production.
 *
 * The earlier version of this comment claimed the invariant held because
 * 120 > 90, which was only true for a single request. Both SDK clients were
 * built with `maxRetries: 2`, and the SDK retries on timeout, so one call could
 * issue three requests at 90s each — measured live at 203s and 205s. The real
 * ceiling was 2 x 3 x 90s = 540s against a 120s cap, so slow requests were
 * killed by the platform rather than degrading. Both clients now use
 * `maxRetries: 0`; retrying is `analyze.ts`'s job, where it is bounded.
 *
 * `tests/api-analyze.test.ts` asserts the arithmetic above against this
 * constant, so raising the timeout without raising this fails the suite. Note
 * that some Vercel plans cap function duration below 120; see the README.
 *
 * Declared as a literal because Next requires route segment config to be
 * statically analysable — it cannot be computed from the imported constants,
 * which is exactly why the test exists.
 *
 * There is no `export const runtime` here on purpose: Node is the default in
 * Next 16 and the Edge runtime is deprecated, so declaring it would be noise.
 * The route does need Node — unpdf and mammoth both do.
 */
export const maxDuration = 300;

const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  RATE_LIMITED: 429,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  LEGACY_DOC: 415,
};

function failure(error: AppError, extraHeaders?: HeadersInit): Response {
  const body: AnalyzeResponse = {
    ok: false,
    error: { code: error.code, message: error.message },
  };

  return Response.json(body, {
    status: HTTP_STATUS[error.code] ?? 400,
    headers: extraHeaders,
  });
}

export async function POST(request: Request): Promise<Response> {
  const timings: Record<string, number> = {};
  const mark = (stage: string, from: number) => {
    timings[stage] = Date.now() - from;
  };

  try {
    const limit = checkRateLimit(clientKeyFrom(request));
    if (!limit.allowed) {
      return failure(new RateLimitedError(limit.retryAfterSeconds), {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const formStart = Date.now();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UnsupportedFileError();

    const rawJd = form.get("jobDescription");
    const jobDescription =
      typeof rawJd === "string" && rawJd.trim() ? rawJd.trim() : null;
    if (jobDescription && jobDescription.length > JD_MAX_CHARS) {
      throw new JobDescriptionTooLongError();
    }
    mark("read", formStart);

    const extractStart = Date.now();
    const extracted = await extractResume(file);
    mark("extract", extractStart);

    const checkStart = Date.now();
    const checks = runDeterministicChecks(extracted.text, extracted.pageCount);
    mark("checks", checkStart);

    const aiStart = Date.now();
    let degraded = false;
    let degradedReason: ErrorCode | null = null;
    let data;

    if (!isAiConfigured()) {
      // No key configured. Not an error the user caused, and not worth a 500 —
      // the deterministic report is genuinely useful on its own.
      degraded = true;
      degradedReason = "AI_UNAVAILABLE";
      data = buildDegradedResult(checks);
      console.warn(
        `[analyze] ${PROVIDER_KEY_VAR[getEnv().AI_PROVIDER]} is not set — returning degraded report`,
      );
    } else {
      try {
        data = await analyzeResume({
          resumeText: extracted.text,
          jobDescription,
          truncated: extracted.truncated,
          facts: summariseChecksForModel(checks),
        });
      } catch (cause) {
        // Every AI failure degrades rather than propagating. One bad key, one
        // upstream incident, or one stubbornly malformed response must not
        // cost the user the report we could still produce.
        degraded = true;
        // Preserve the specific cause. Rate limiting, exhausted credits, and a
        // malformed response all degrade, but the user's next action differs
        // for each one.
        degradedReason = cause instanceof AppError ? cause.code : "AI_UNAVAILABLE";
        data = buildDegradedResult(checks);
        console.error(
          `[analyze] AI stage failed (${cause instanceof AppError ? cause.code : "unknown"}) — degrading:`,
          cause instanceof Error ? cause.message : cause,
        );
      }
    }
    mark("ai", aiStart);

    const meta: AnalysisMeta = {
      degraded,
      degradedReason,
      truncated: extracted.truncated,
      timings,
      pageCount: extracted.pageCount,
      wordCount: checks.wordCount,
    };

    // Character counts and timings only. The resume text itself is never
    // logged, here or anywhere else in the pipeline.
    console.log(
      `[analyze] ${extracted.kind} ${extracted.charCount} chars${extracted.truncated ? " (truncated)" : ""}, jd=${jobDescription ? jobDescription.length : 0}, degraded=${degraded}${degradedReason ? "(" + degradedReason + ")" : ""}, provider=${getEnv().AI_PROVIDER}, model=${getEnv().AI_MODEL}, timings=${JSON.stringify(timings)}`,
    );

    const body: AnalyzeResponse = { ok: true, data, meta };
    return Response.json(body);
  } catch (cause) {
    if (cause instanceof AppError) return failure(cause);

    console.error("[analyze] unhandled:", cause);
    return Response.json(
      {
        ok: false,
        error: { code: "UNKNOWN", message: "The analysis could not be completed." },
      } satisfies AnalyzeResponse,
      { status: 500 },
    );
  }
}
