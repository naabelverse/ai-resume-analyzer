import {
  AppError,
  FeedbackEmailInvalidError,
  FeedbackEmptyError,
  FeedbackInvalidError,
  FeedbackRateLimitedError,
  FeedbackSendFailedError,
  FeedbackTooLongError,
  type ErrorCode,
} from "@/lib/errors";
import { isHoneypotFilled, parseFeedback } from "@/lib/feedback";
import { failureResponse } from "@/lib/http";
import { sendFeedbackEmail } from "@/lib/mail";
import {
  MAX_FEEDBACK_REQUESTS,
  MAX_FEEDBACK_SENDS,
  checkRateLimit,
  feedbackRequestKeyFrom,
  feedbackSendKeyFrom,
} from "@/lib/rate-limit";
import type { FeedbackResponse } from "@/types";

/**
 * The feedback form's endpoint.
 *
 * Public, unauthenticated, and it will be found by scrapers — so nothing the
 * client says is trusted. The form caps its textarea, checks the address and
 * only ever sends one of three types; all three are checked again here,
 * because the form is one of the clients this route has rather than the only
 * one.
 *
 * What it will not do, in order of how bad it would be:
 *
 *   1. Report success for a message that was not sent. A "Thanks" over a
 *      silently discarded submission is worse than having no form at all, so
 *      the only path to `{ ok: true }` runs through a send that resolved
 *      without an error — or through the honeypot, which is the one deliberate
 *      exception and exists to tell a bot nothing.
 *   2. Put `RESEND_API_KEY`, `FEEDBACK_EMAIL`, or Resend's own wording in a
 *      response. `lib/mail.ts` logs the real cause and throws one generic
 *      error; this route only ever serialises `ERROR_COPY`.
 *   3. Carry the resume. The payload has no field for the extracted text or
 *      the uploaded filename, and `parseFeedback` drops unknown keys, so a
 *      client that invents one cannot get it into an email. The app promises
 *      the resume is never stored; mailing it here would break that promise
 *      somewhere no user could check.
 *
 * No `maxDuration`, for the same reason `/api/extract` sets none: there is no
 * model call to budget for. One HTTP request to Resend is nowhere near the
 * platform default.
 */

/** Maps the validator's code onto the error the route throws for it. */
const VALIDATION_ERROR: Record<string, () => AppError> = {
  FEEDBACK_EMPTY: () => new FeedbackEmptyError(),
  FEEDBACK_TOO_LONG: () => new FeedbackTooLongError(),
  FEEDBACK_EMAIL_INVALID: () => new FeedbackEmailInvalidError(),
  FEEDBACK_INVALID: () => new FeedbackInvalidError(),
};

function errorFor(code: ErrorCode): AppError {
  return (VALIDATION_ERROR[code] ?? (() => new FeedbackInvalidError()))();
}

export async function POST(request: Request): Promise<Response> {
  try {
    /*
      The cheap ceiling, charged on everything that gets this far — malformed
      bodies, honeypot hits and failed validation included. It is what stops
      the paths below being free to hammer, now that the send bucket is only
      charged at the send.

      A real person cannot reach twenty in ten minutes. A bot posting junk
      reaches it quickly and stops, which is the entire job.
    */
    const requests = checkRateLimit(
      feedbackRequestKeyFrom(request),
      Date.now(),
      MAX_FEEDBACK_REQUESTS,
    );
    if (!requests.allowed) {
      return failureResponse(new FeedbackRateLimitedError(requests.retryAfterSeconds), {
        "retry-after": String(requests.retryAfterSeconds),
      });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      // Not JSON at all. Nothing below can say anything more useful about it.
      throw new FeedbackInvalidError();
    }

    /*
      Before validation, deliberately.

      A bot that filled the hidden field is not going to be told which of its
      other fields was also wrong — every response it can distinguish is a hint
      about how to get through next time. So this returns exactly what a real
      success returns and sends nothing.

      It still spent a rate-limit slot on the way in, which is the point.
    */
    if (isHoneypotFilled(raw)) {
      console.log("[feedback] honeypot filled — discarded, nothing sent");
      return Response.json({ ok: true } satisfies FeedbackResponse);
    }

    const parsed = parseFeedback(raw);
    if (!parsed.ok) return failureResponse(errorFor(parsed.code));

    /*
      The expensive ceiling, charged here and nowhere else — the last gate
      before a call to a metered third party.

      Its position IS the rule: only a request that got this far spends one, so
      a mistyped address or a honeypot hit costs a user nothing. `checkRateLimit`
      declines without incrementing when a bucket is at its cap, so this one
      call both enforces and charges, and nothing needs to peek first.

      It is charged before the send rather than after a successful one. A send
      that fails still cost the API call, and making failures free would leave
      this path unbounded during exactly the outage that attracts the most
      retries.
    */
    const sends = checkRateLimit(
      feedbackSendKeyFrom(request),
      Date.now(),
      MAX_FEEDBACK_SENDS,
    );
    if (!sends.allowed) {
      return failureResponse(new FeedbackRateLimitedError(sends.retryAfterSeconds), {
        "retry-after": String(sends.retryAfterSeconds),
      });
    }

    const started = Date.now();
    const messageId = await sendFeedbackEmail(parsed.value);
    const elapsedMs = Date.now() - started;

    /*
      Counts and timings, never content. The same rule the extraction pipeline
      follows for resume text applies to what someone wrote in confidence here:
      the email is where the message goes, and a log is a second copy in a
      place nobody agreed to.
    */
    console.log(
      `[feedback] sent id=${messageId} type=${parsed.value.type}` +
        ` chars=${parsed.value.message.length}` +
        ` analysis=${parsed.value.analysisId ?? "none"}` +
        ` reply=${parsed.value.email ? "yes" : "no"}, ${elapsedMs}ms`,
    );

    return Response.json({ ok: true } satisfies FeedbackResponse);
  } catch (cause) {
    if (cause instanceof AppError) return failureResponse(cause);

    // Anything unclassified is still a failure to send, and the user is owed
    // that fact rather than a 500 page. The real error goes to the log only.
    console.error("[feedback] unhandled:", cause);
    return failureResponse(new FeedbackSendFailedError(cause));
  }
}
