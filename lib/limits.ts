/**
 * Shared limits.
 *
 * These live in their own module with no `server-only` guard because both
 * sides need them: the browser enforces them for instant feedback, and the
 * route enforces them again because the browser's copy is advisory. Two
 * hand-synchronised constants would eventually disagree, and the one that
 * drifted would be the client's — silently letting through a file the server
 * then rejects with a different number in the message.
 */

/** 5MB. Most resumes are under 1MB; anything past this is images. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Job description cap, enforced by the textarea and by the route. */
export const JD_MAX_CHARS = 8_000;

/**
 * Feedback message cap, enforced by the textarea and by `/api/feedback`.
 *
 * Here rather than in `lib/feedback.ts` for the reason at the top of this
 * file: a cap both sides enforce belongs in the module with no guard on it, so
 * the counter under the textarea and the check in the route are the same
 * number. Measured against the *trimmed* message, which is what gets sent.
 */
export const FEEDBACK_MAX_CHARS = 5_000;

/** Below this, after normalisation, there is nothing to analyse. */
export const MIN_TEXT_CHARS = 200;

/** Above this the resume is truncated head+tail rather than tail-clipped. */
export const MAX_TEXT_CHARS = 15_000;
export const HEAD_CHARS = 12_000;
export const TAIL_CHARS = 3_000;

export const TRUNCATION_MARKER =
  "\n\n[... middle of resume omitted for length ...]\n\n";


/* --------------------------------------------------------------- timing -- */

/**
 * How many times `analyzeResume` will call the model for one request: the
 * first attempt plus at most one retry carrying the validator's complaint.
 *
 * Exported so the worst-case budget below can be asserted rather than
 * asserted-to. A transport error is NOT retried here — it throws straight to
 * the degraded path — so two attempts is the ceiling, reached only when a slow
 * response also fails validation.
 */
export const ANALYZE_MAX_ATTEMPTS = 2;

/**
 * Everything in a request that is not the model call: reading the multipart
 * body, PDF/DOCX extraction, the deterministic checks, JSON serialisation.
 *
 * Measured at under 230ms for ten extractions including a thirteen-page PDF.
 * Budgeted at 5s — roughly twenty times the measurement — to absorb a cold
 * function instance without pretending to know its cost precisely.
 */
export const NON_AI_BUDGET_MS = 5_000;
