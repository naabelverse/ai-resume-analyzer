import { z } from "zod";

import { FEEDBACK_MAX_CHARS } from "@/lib/limits";
import type { ErrorCode } from "@/lib/errors";

/**
 * What a feedback submission is, and what makes one valid.
 *
 * No `server-only` guard, deliberately, and for the reason `lib/limits.ts`
 * records: both sides need this. The form disables its button and counts
 * characters from the same rules the route enforces, so the two cannot drift
 * into the state where the browser lets something through that the server then
 * refuses with a different number in the message.
 *
 * The route enforces them *again* regardless. This endpoint is public and will
 * be found by scrapers, and everything below is advisory until the server has
 * run it.
 */

/**
 * The three kinds of feedback, with both labels they need.
 *
 * `label` is what the radio says; `subject` is the short tag the email subject
 * carries. They differ because "Feedback on the analysis" reads well beside a
 * radio and badly inside `[...]` in an inbox list. One array rather than two
 * maps, so a fourth type cannot arrive with a radio label and no subject tag.
 */
export const FEEDBACK_TYPES = [
  { value: "analysis", label: "Feedback on the analysis", subject: "Analysis" },
  { value: "bug", label: "Bug", subject: "Bug" },
  { value: "suggestion", label: "Suggestion", subject: "Suggestion" },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number]["value"];

/** The subject tag for a type. Total over the union, so no fallback is needed. */
export function subjectTagFor(type: FeedbackType): string {
  return FEEDBACK_TYPES.find((entry) => entry.value === type)!.subject;
}

/**
 * The honeypot's field name, exported so the input that renders it and the
 * check that reads it are one string. Two copies of a name that must match, in
 * files that never import each other, is how a honeypot quietly stops working:
 * nothing fails, bots just start getting through.
 *
 * "website" rather than something obviously fake — the point is that an
 * autofilling bot recognises it and fills it in.
 */
export const HONEYPOT_FIELD = "website";

export interface FeedbackSubmission {
  type: FeedbackType;
  /** Trimmed, non-empty, within the cap. */
  message: string;
  /** Null when the user did not give one — the field is optional. */
  email: string | null;
  /** The analysis being viewed when the modal opened, when there was one. */
  analysisId: string | null;
}

export type FeedbackParse =
  | { ok: true; value: FeedbackSubmission }
  | { ok: false; code: ErrorCode };

/**
 * The shape a body has to have before any of its values are worth judging.
 *
 * Loose on purpose: every field is read as an unknown string here so the
 * checks below can each name their own `ErrorCode`. A single strict schema
 * would collapse "you wrote nothing", "you wrote too much" and "that is not an
 * email address" into one Zod failure, and the user would be told which by
 * whichever issue happened to sort first.
 *
 * Unlisted keys are dropped rather than passed through. That is the guarantee
 * that matters most here: the app promises the resume is never stored, and a
 * client that posts `resumeText` alongside its message must not be able to get
 * that into an email. Zod strips unknown keys by default, so the promise holds
 * by construction rather than by the route remembering to pick fields.
 */
const BodySchema = z.object({
  type: z.unknown(),
  message: z.unknown(),
  email: z.unknown().optional(),
  analysisId: z.unknown().optional(),
});

const TYPE_VALUES = FEEDBACK_TYPES.map((entry) => entry.value);

/**
 * Route ids are opaque: 16 hex characters from `newAnalysisId`, or the literal
 * `demo`. Anything else did not come from this app's own routing.
 *
 * A mismatch drops the id rather than failing the submission. It is a silent
 * field the user never sees, never typed and cannot correct — refusing to send
 * someone's bug report because a route segment looked odd would be the wrong
 * trade by a wide margin.
 */
const ANALYSIS_ID_PATTERN = /^[a-z0-9-]{1,64}$/i;

/** True when the hidden field came back with anything in it. */
export function isHoneypotFilled(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;

  const value = (raw as Record<string, unknown>)[HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

export function parseFeedback(raw: unknown): FeedbackParse {
  const body = BodySchema.safeParse(raw);
  if (!body.success) return { ok: false, code: "FEEDBACK_INVALID" };

  const { type, message, email, analysisId } = body.data;

  if (typeof type !== "string" || !TYPE_VALUES.includes(type as FeedbackType)) {
    return { ok: false, code: "FEEDBACK_INVALID" };
  }

  if (typeof message !== "string") return { ok: false, code: "FEEDBACK_INVALID" };

  const trimmed = message.trim();
  if (trimmed.length === 0) return { ok: false, code: "FEEDBACK_EMPTY" };
  if (trimmed.length > FEEDBACK_MAX_CHARS) {
    return { ok: false, code: "FEEDBACK_TOO_LONG" };
  }

  /*
    Checked only when non-empty. The field is optional, and an absent optional
    field is not a validation failure — it is the common case, since most
    people sending a bug report do not want a reply.
  */
  const trimmedEmail = typeof email === "string" ? email.trim() : "";
  if (trimmedEmail.length > 0 && !z.email().safeParse(trimmedEmail).success) {
    return { ok: false, code: "FEEDBACK_EMAIL_INVALID" };
  }

  const id =
    typeof analysisId === "string" && ANALYSIS_ID_PATTERN.test(analysisId)
      ? analysisId
      : null;

  return {
    ok: true,
    value: {
      type: type as FeedbackType,
      message: trimmed,
      email: trimmedEmail.length > 0 ? trimmedEmail : null,
      analysisId: id,
    },
  };
}
