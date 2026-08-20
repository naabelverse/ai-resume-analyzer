import type { AppError, ErrorCode } from "@/lib/errors";
import type { ApiFailure } from "@/types";

/**
 * How an `ErrorCode` becomes an HTTP response.
 *
 * One map, shared by every route, for the same reason there is one
 * `ERROR_COPY`: a second copy would start out identical and then drift, and
 * the drift would show up as one endpoint calling a too-large file a 413 while
 * another called it a 400. No `server-only` guard — this reads nothing but its
 * argument and builds a `Response`, which is a web global on both sides.
 */

/** Everything absent from this map is a 400. */
const HTTP_STATUS: Partial<Record<ErrorCode, number>> = {
  RATE_LIMITED: 429,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE: 415,
  LEGACY_DOC: 415,
};

export function statusFor(code: ErrorCode): number {
  return HTTP_STATUS[code] ?? 400;
}

/**
 * The failure envelope. `error.message` is the `AppError`'s own message, which
 * is written to be shown to a person — routes never compose one themselves.
 */
export function failureResponse(
  error: AppError,
  extraHeaders?: HeadersInit,
): Response {
  const body: ApiFailure = {
    ok: false,
    error: { code: error.code, message: error.message },
  };

  return Response.json(body, {
    status: statusFor(error.code),
    headers: extraHeaders,
  });
}
