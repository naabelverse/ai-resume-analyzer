/**
 * Typed failure modes.
 *
 * Every user-facing failure in the app resolves to one `ErrorCode`, and all the
 * wording for those codes lives in `ERROR_COPY` below — nowhere else. The
 * server throws `AppError` subclasses, the route maps them to a code, and
 * `<ErrorState>` renders the copy. Changing what the user reads is a one-line
 * edit in one file.
 *
 * Deliberately free of `server-only`: the client error component imports the
 * same map, so the message a user sees is never a second, drifting copy of the
 * message the server meant.
 */

export type ErrorCode =
  | "UNSUPPORTED_FILE"
  | "LEGACY_DOC"
  | "FILE_TOO_LARGE"
  | "EMPTY_RESUME"
  | "EXTRACTION_FAILED"
  | "JD_TOO_LONG"
  | "AI_UNAVAILABLE"
  | "AI_SCHEMA"
  | "AI_RATE_LIMITED"
  | "AI_CREDITS_EXHAUSTED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "UNKNOWN";

export interface ErrorCopy {
  /** Heading. States what happened, in the user's terms. */
  title: string;
  /** One or two sentences of explanation. No apologising, no vagueness. */
  message: string;
  /** The single next action. Never a list of things to try. */
  action: string;
}

export const ERROR_COPY: Record<ErrorCode, ErrorCopy> = {
  UNSUPPORTED_FILE: {
    title: "That file type isn't supported",
    message: "Resumes must be a PDF or a .docx file.",
    action: "Export your resume as a PDF and upload it again.",
  },
  LEGACY_DOC: {
    title: "Old .doc format isn't supported",
    message: "Old .doc format isn't supported. Save as PDF or .docx and try again.",
    action: "Open the file in Word and use Save As to create a PDF or .docx.",
  },
  FILE_TOO_LARGE: {
    title: "That file is too large",
    message: "Resumes need to be under 5MB. Most are well under 1MB.",
    action: "Export a fresh PDF from Word or Google Docs — that usually shrinks it a lot.",
  },
  EMPTY_RESUME: {
    title: "No text found in that file",
    message:
      "This looks like a scanned image. Upload a text-based PDF, or export a fresh copy from Word or Google Docs.",
    action: "Export a new PDF from the original document rather than scanning a printout.",
  },
  EXTRACTION_FAILED: {
    title: "That file couldn't be read",
    message: "The file is either corrupted or password-protected, so its text can't be extracted.",
    action: "Open it to confirm it works, then export a fresh copy and try again.",
  },
  JD_TOO_LONG: {
    title: "That job description is too long",
    message: "Job descriptions are capped at 8,000 characters.",
    /*
      Recovery advice, and it has to agree with what the textarea asked for.
      The placeholder invites the whole posting; this used to answer an overrun
      with "paste just the responsibilities and requirements sections", which
      told the user to do the thing they had just been told not to do — and
      threw away role-specific terms in the bargain, since matching works off
      the words the posting uses and they are spread through all of it.

      So it names what to cut rather than what to keep, and picks the parts
      carrying no terms a resume could match: benefits, the company blurb, the
      interview process. Those are usually the longest parts too.
    */
    action:
      "Cut the parts that say nothing about the role itself — benefits, the company blurb, the interview process — and paste the rest.",
  },
  /**
   * Provider-neutral wording, deliberately.
   *
   * These two said "Claude" while AI_PROVIDER=nvidia, and this copy is not
   * confined to a log: the route puts the code on `meta.degradedReason` and
   * `<DegradedBanner>` renders `message` verbatim, so a user running the
   * open-weight model was told a model they were not using could not be
   * reached. `AI_PROVIDER` selects the transport at runtime, so any copy that
   * names one provider is wrong half the time by construction.
   */
  AI_UNAVAILABLE: {
    title: "The AI analysis is unavailable",
    message:
      "The AI model couldn't be reached, so only the automated checks below could run.",
    action: "Try again in a moment for the full AI review.",
  },
  AI_SCHEMA: {
    title: "The analysis came back unreadable",
    message:
      "The model's response didn't match the expected format twice in a row.",
    action: "Run the analysis again — this is almost always transient.",
  },
  /**
   * These two DO name NVIDIA, and that is currently accurate rather than
   * sloppy: only `lib/ai/providers/nvidia.ts` maps a status onto them, and the
   * Anthropic provider has no 429/402 mapping at all, so neither code is
   * reachable on that transport. Adding one there without splitting this copy
   * would reintroduce exactly the bug fixed above, in mirror image.
   */
  AI_RATE_LIMITED: {
    title: "The AI provider is rate limiting us",
    message:
      "NVIDIA's free tier allows 40 requests per minute per model, and that ceiling was just hit.",
    action: "Wait about a minute, then run the analysis again.",
  },
  AI_CREDITS_EXHAUSTED: {
    title: "Your NVIDIA API credits have run out",
    message:
      "The provider rejected the request for lack of credit, not for load — waiting will not help.",
    action:
      "Top up or renew your free credits at build.nvidia.com, or set AI_PROVIDER=anthropic with an Anthropic key.",
  },
  RATE_LIMITED: {
    title: "Too many analyses",
    message: "This app allows 5 analyses every 10 minutes to keep costs predictable.",
    action: "Wait a few minutes, then run your analysis again.",
  },
  NETWORK: {
    title: "The connection dropped",
    message: "The request didn't reach the server, so nothing was analysed.",
    action: "Check your connection and run the analysis again.",
  },
  UNKNOWN: {
    title: "Something went wrong",
    message: "The analysis stopped for a reason the app doesn't recognise.",
    action: "Run the analysis again. If it keeps happening, try a different file.",
  },
};

/** The one-line message for a code. Used where there's no room for full copy. */
export function messageFor(code: ErrorCode): string {
  return ERROR_COPY[code].message;
}

/** Narrows an arbitrary string to an ErrorCode, falling back to UNKNOWN. */
export function toErrorCode(value: unknown): ErrorCode {
  return typeof value === "string" && value in ERROR_COPY
    ? (value as ErrorCode)
    : "UNKNOWN";
}

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ERROR_COPY[code].message);
    this.code = code;
    this.name = new.target.name;
  }
}

export class UnsupportedFileError extends AppError {
  constructor() {
    super("UNSUPPORTED_FILE");
  }
}

/** Split from UnsupportedFileError because .doc has its own required wording. */
export class LegacyDocError extends AppError {
  constructor() {
    super("LEGACY_DOC");
  }
}

export class FileTooLargeError extends AppError {
  constructor() {
    super("FILE_TOO_LARGE");
  }
}

export class EmptyResumeError extends AppError {
  constructor() {
    super("EMPTY_RESUME");
  }
}

export class ExtractionFailedError extends AppError {
  constructor(cause?: unknown) {
    super("EXTRACTION_FAILED");
    this.cause = cause;
  }
}

export class JobDescriptionTooLongError extends AppError {
  constructor() {
    super("JD_TOO_LONG");
  }
}

/** The AI call failed outright. Recoverable: the route degrades instead. */
export class AiUnavailableError extends AppError {
  constructor(cause?: unknown) {
    super("AI_UNAVAILABLE");
    this.cause = cause;
  }
}

/** The model's output failed validation twice. Also degradable. */
export class AiSchemaError extends AppError {
  constructor(cause?: unknown) {
    super("AI_SCHEMA");
    this.cause = cause;
  }
}

export class RateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMITED");
  }
}

/**
 * The upstream provider is rate limiting us — distinct from `RateLimitedError`,
 * which is this app throttling one IP. Conflating them would tell a user to
 * slow down when the real constraint is somewhere they cannot see.
 */
export class AiRateLimitedError extends AppError {
  constructor(
    readonly retryAfterSeconds: number,
    cause?: unknown,
  ) {
    super("AI_RATE_LIMITED");
    this.cause = cause;
  }
}

/**
 * Free credits are gone. Deliberately NOT folded into AI_UNAVAILABLE: that
 * message says "try again in a moment", which is actively wrong here and would
 * have someone retrying a wall for an hour.
 */
export class AiCreditsExhaustedError extends AppError {
  constructor(cause?: unknown) {
    super("AI_CREDITS_EXHAUSTED");
    this.cause = cause;
  }
}
