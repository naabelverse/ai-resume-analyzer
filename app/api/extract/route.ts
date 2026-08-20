import { AppError, RateLimitedError, UnsupportedFileError } from "@/lib/errors";
import { extractResume } from "@/lib/extract";
import { failureResponse } from "@/lib/http";
import {
  MAX_PREVIEW_REQUESTS,
  checkRateLimit,
  previewKeyFrom,
} from "@/lib/rate-limit";
import type { ExtractResponse } from "@/types";

/**
 * Extraction without analysis, for the preview panel.
 *
 * The value of this endpoint is entirely in it being the *same* extraction:
 * it calls the identical `extractResume` that `/api/analyze` calls, so the
 * text it returns is the text the model will read, down to the normalisation
 * and the truncation. Reimplementing any part of that here — a lighter parse,
 * a different clamp — would make the preview a plausible-looking guess, and a
 * preview that quietly disagrees with the analysis is worse than none.
 *
 * It reaches no provider and needs no key. A preview costs one parse, which is
 * why it gets a much higher rate-limit ceiling than an analysis does.
 *
 * No `maxDuration` here on purpose: unlike the analyze route there is no model
 * call to budget for, and extraction was measured under 230ms for ten files
 * including a thirteen-page PDF. The platform default is nowhere near binding.
 */

export async function POST(request: Request): Promise<Response> {
  try {
    const limit = checkRateLimit(
      previewKeyFrom(request),
      Date.now(),
      MAX_PREVIEW_REQUESTS,
    );
    if (!limit.allowed) {
      return failureResponse(new RateLimitedError(limit.retryAfterSeconds), {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new UnsupportedFileError();

    const started = Date.now();
    const extracted = await extractResume(file);
    const elapsedMs = Date.now() - started;

    // Counts and timings only. The resume text is never logged, here or
    // anywhere else in the pipeline.
    console.log(
      `[extract] ${extracted.kind} ${extracted.charCount} chars${
        extracted.truncated ? " (truncated)" : ""
      }, pages=${extracted.pageCount ?? "n/a"}, ${elapsedMs}ms`,
    );

    const body: ExtractResponse = {
      ok: true,
      data: {
        kind: extracted.kind,
        text: extracted.text,
        pageCount: extracted.pageCount,
        truncated: extracted.truncated,
        charCount: extracted.charCount,
      },
    };

    return Response.json(body);
  } catch (cause) {
    if (cause instanceof AppError) return failureResponse(cause);

    console.error("[extract] unhandled:", cause);
    return Response.json(
      {
        ok: false,
        error: { code: "UNKNOWN", message: "That file could not be read." },
      } satisfies ExtractResponse,
      { status: 500 },
    );
  }
}
