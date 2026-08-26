/**
 * Typed failure modes.
 *
 * Every user-facing failure in the app resolves to one `ErrorCode`, and all the
 * wording for those codes lives in `ERROR_COPY` below. The server throws
 * `AppError` subclasses, the route maps them to a code, and `<ErrorState>`
 * renders the copy. Changing what the user reads is a one-line edit in one
 * file.
 *
 * That sentence used to end "— nowhere else", and it was false in a way that
 * cost something. `<DegradedBanner>` hardcoded two sentences of its own, so
 * the copy describing the degraded state was the one piece of user-facing
 * wording no sweep of this file could reach — and it is exactly the copy that
 * was still telling people their analysis was "unreadable" after two separate
 * rounds of cleaning up everything in here.
 *
 * So the claim is now the accurate one: all wording lives in THIS FILE, in one
 * of two exports. `ERROR_COPY` is per-code. `DEGRADED_COPY` is the state-level
 * wording no single code owns — the same sentences whichever failure degraded
 * the run, and keeping one copy of them is what stops four codes drifting
 * apart on the same fact.
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
  | "FEEDBACK_EMPTY"
  | "FEEDBACK_TOO_LONG"
  | "FEEDBACK_EMAIL_INVALID"
  | "FEEDBACK_INVALID"
  | "FEEDBACK_RATE_LIMITED"
  | "FEEDBACK_SEND_FAILED"
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

/**
 * The degraded state's own wording — what the banner says regardless of which
 * failure got us there. The per-code `action` in `ERROR_COPY` supplies the
 * next step; everything here is true of all four.
 *
 * Three deliberate choices, each fixing something the old hardcoded copy did:
 *
 *   - "on our side" stays even when the failure is the provider's. From where
 *     the reader sits, a provider we chose IS our side, and the alternative is
 *     blaming a company they have no relationship with for a page we served.
 *   - "your resume is fine" is not padding. The previous copy said the
 *     analysis came back "unreadable", which reads as a verdict on their FILE.
 *     That is the opposite of what happened, and it is the one misreading here
 *     that would make someone go and edit a resume that was never the problem.
 *   - "no feedback on how it's written" names the gap in terms of what they
 *     wanted. "Automated structural checks only" names it in terms of our
 *     implementation, which tells someone who does not know what we normally
 *     run precisely nothing.
 */
export const DEGRADED_COPY = {
  title: "We couldn't finish this analysis",
  body:
    "Something went wrong on our side — your resume is fine. What's below covers " +
    "formatting and structure only, so there's no feedback on how it's written.",
  /** The link out. Not a retry button — see `<DegradedBanner>` for why. */
  linkLabel: "Upload it again",
} as const;

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
    title: "The written review didn't run",
    message: "We couldn't reach the service that reviews how a resume is written.",
    action: "Running it again usually works.",
  },
  /**
   * Every word of this was rewritten, and the old version is worth keeping in
   * view because each part failed differently:
   *
   *   "The analysis came back unreadable" — reads as a verdict on the reader's
   *   FILE. It was about our own response. Someone told their resume is
   *   unreadable goes and rebuilds a document that was never at fault.
   *
   *   "didn't match the expected format twice in a row" — three internal
   *   facts, none of which a reader can act on or check: that we expect a
   *   format, that something failed to match it, and that we retry once.
   *
   *   "almost always transient" — a word from the incident channel.
   */
  AI_SCHEMA: {
    title: "The written review didn't finish",
    message: "The review came back in a state we couldn't use.",
    action: "Running it again usually works.",
  },
  /**
   * These two used to name NVIDIA, on the argument that it was accurate: only
   * `lib/ai/providers/nvidia.ts` maps a status onto them, so neither code is
   * reachable on the Anthropic transport.
   *
   * Accurate, and still the wrong thing to print. Both of these render in
   * `<DegradedBanner>`, where the reader is someone whose resume review did
   * not happen — they have no relationship with our provider, cannot act on
   * which one it is, and naming it reads as passing the blame for a page we
   * served. `DEGRADED_COPY` says "on our side" for the same reason. The
   * accuracy that mattered is preserved where it belongs: the provider name is
   * in the server log, and the two codes stay separate so the ADVICE can
   * differ, which is the whole point of not folding them together.
   */
  AI_RATE_LIMITED: {
    title: "The written review is busy",
    message: "Too many analyses are running at once for us to add another.",
    action: "Wait about a minute, then upload it again.",
  },
  AI_CREDITS_EXHAUSTED: {
    title: "The written review is unavailable for now",
    message:
      "This app has run out of the credit it needs to review writing, so waiting won't help.",
    /*
      Addressed to the reader, who is not the operator. The previous wording
      told them to top up an account they do not hold and to set an environment
      variable they cannot reach — an instruction only whoever deployed the app
      can act on, and one that reads to everyone else as though they had missed
      a setup step.

      It does not promise a retry will work: the message directly above says
      waiting will not help, and this is the one AI failure where that is true.
    */
    action:
      "Running it again won't help until that's restored — check back later, or let whoever runs this app know.",
  },
  RATE_LIMITED: {
    title: "Too many analyses",
    message: "This app allows 5 analyses every 10 minutes to keep costs predictable.",
    action: "Wait a few minutes, then run your analysis again.",
  },
  /* ------------------------------------------------------------- feedback --
     The feedback form's own codes.

     They do not reuse the analysis ones, and the reason is the same one that
     split AI_RATE_LIMITED from RATE_LIMITED above: copy that names the wrong
     activity is wrong in a way the reader can see. RATE_LIMITED says "this app
     allows 5 analyses every 10 minutes", which is true and irrelevant to
     someone whose bug report was refused; NETWORK ends "run the analysis
     again", which is not what they were doing.

     Four of the six are only reachable by a client that is not this app's
     form — it caps the textarea, checks the address and always sends a valid
     type. They are written for a person anyway, because the alternative is
     copy nobody proof-read sitting in a public endpoint.
  ------------------------------------------------------------------------- */
  FEEDBACK_EMPTY: {
    title: "There's no message to send",
    message: "Feedback needs something written in the message box.",
    action: "Describe what you ran into, then send it again.",
  },
  FEEDBACK_TOO_LONG: {
    title: "That message is too long",
    message: "Feedback messages are capped at 5,000 characters.",
    action: "Trim it to the part that matters most and send it again.",
  },
  FEEDBACK_EMAIL_INVALID: {
    title: "That email address doesn't look right",
    message: "The address in the optional reply field couldn't be read.",
    /* Names the escape hatch, because the field is optional and a message
       nobody can reply to is still worth far more than one never sent. */
    action: "Correct it, or clear the field and send without it.",
  },
  FEEDBACK_INVALID: {
    title: "That submission couldn't be read",
    message: "The feedback form sent something the server didn't recognise.",
    action: "Reload the page and try again.",
  },
  FEEDBACK_RATE_LIMITED: {
    title: "Too much feedback at once",
    message: "This app accepts 3 feedback messages every 10 minutes.",
    action: "Wait a few minutes, then send it again.",
  },
  FEEDBACK_SEND_FAILED: {
    /*
      Deliberately says nothing about why.

      The real cause — which of the two environment variables is missing, what
      Resend called the rejection, what status it carried — is logged on the
      server and stops there. This message is what a scraper reads too.

      What it must do is be honest that nothing was sent, because the one
      outcome worse than a failed feedback form is a "Thanks!" over a message
      that went nowhere.
    */
    title: "That feedback couldn't be sent",
    message: "The message didn't go through, so it hasn't reached anyone.",
    action: "Try again in a moment — what you wrote is still here.",
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

/* --------------------------------------------------------------- feedback --
   Thrown by `/api/feedback` and by `lib/mail.ts`.

   `FeedbackInvalidError` and friends carry no cause: everything they describe
   is a fact about the request body, which the route already has. Only the send
   failure takes one, because that is the only feedback failure with something
   underneath it worth logging.
--------------------------------------------------------------------------- */

export class FeedbackEmptyError extends AppError {
  constructor() {
    super("FEEDBACK_EMPTY");
  }
}

export class FeedbackTooLongError extends AppError {
  constructor() {
    super("FEEDBACK_TOO_LONG");
  }
}

export class FeedbackEmailInvalidError extends AppError {
  constructor() {
    super("FEEDBACK_EMAIL_INVALID");
  }
}

export class FeedbackInvalidError extends AppError {
  constructor() {
    super("FEEDBACK_INVALID");
  }
}

/**
 * This app throttling one IP on the feedback endpoint. Distinct from
 * `RateLimitedError` for the same reason `AiRateLimitedError` is distinct from
 * it: the two ceilings are different numbers on different buckets, and copy
 * quoting the analysis allowance to someone sending a bug report is wrong in a
 * way they can see.
 */
export class FeedbackRateLimitedError extends AppError {
  constructor(readonly retryAfterSeconds: number) {
    super("FEEDBACK_RATE_LIMITED");
  }
}

/**
 * The mail provider refused, threw, or was never configured.
 *
 * One class for all three on purpose. The differences matter to whoever runs
 * this app and are logged for them; to the person who just wrote a bug report
 * they are the same event — it did not send, and what they typed is still on
 * screen. `cause` is carried for the log and is never serialised into a
 * response.
 */
export class FeedbackSendFailedError extends AppError {
  constructor(cause?: unknown) {
    super("FEEDBACK_SEND_FAILED");
    this.cause = cause;
  }
}
