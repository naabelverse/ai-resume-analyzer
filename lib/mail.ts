import "server-only";

import { Resend } from "resend";

import { getEnv } from "@/lib/env";
import { FeedbackSendFailedError } from "@/lib/errors";
import { subjectTagFor, type FeedbackSubmission } from "@/lib/feedback";

/**
 * The one place this app sends mail from.
 *
 * `server-only`, like every other module that touches a key. The guard is what
 * makes pulling this into a client component a build error rather than a
 * leaked `RESEND_API_KEY`.
 *
 * The route below it decides *whether* to send; this file decides only what
 * the message looks like. That split is why the subject and body composition
 * is real code under test — the suite mocks the `resend` package, not this
 * module, so the from/to/replyTo/subject a failure would get wrong are the
 * ones the tests actually read.
 */

/**
 * Resend's shared sandbox sender, used because this account has no verified
 * domain.
 *
 * It only delivers to the address the Resend account itself is registered
 * under — which is what `FEEDBACK_EMAIL` holds, so the one route that uses it
 * works. Sending to anyone else silently requires verifying a domain at
 * https://resend.com/domains and changing this constant to an address at that
 * domain. Until then, treat this as a private mailbox with exactly one
 * recipient, not as a way to mail users.
 */
const FROM_ADDRESS = "onboarding@resend.dev";

let client: Resend | null = null;

/**
 * The mock seam.
 *
 * Lazy rather than module-scope so importing this file — which `next build`
 * does while collecting routes — never requires a key to be present. A missing
 * key is a request-time refusal with a log line, not a build failure.
 */
function getResendClient(apiKey: string): Resend {
  client ??= new Resend(apiKey);
  return client;
}

/** Test seam. Never called by application code. */
export function resetResendClient(): void {
  client = null;
}

/**
 * Subject line, built so an inbox filter can sort on it without opening
 * anything: the type in brackets, the app, and the analysis id when the modal
 * was opened from a report.
 *
 *   [Bug] Resume Analyzer — analysis a1b2c3
 *   [Suggestion] Resume Analyzer
 *
 * Module-private, like `bodyFor` below. Both are covered through the route,
 * which asserts the payload Resend was actually handed — testing them by name
 * would prove the composition works without proving it is what gets sent.
 */
function subjectFor(submission: FeedbackSubmission): string {
  const base = `[${subjectTagFor(submission.type)}] Resume Analyzer`;
  return submission.analysisId ? `${base} — analysis ${submission.analysisId}` : base;
}

/**
 * Plain text, not HTML. There is nothing here that markup would clarify, and
 * the one part that matters — what the person wrote — is better off arriving
 * exactly as they typed it than passed through an escaper.
 *
 * The resume text and the uploaded filename are absent, and that is a promise
 * rather than an oversight: the app tells every visitor the resume is never
 * stored, and mailing it to the operator would break that quietly, in a place
 * no user could ever check. `parseFeedback` drops unknown keys before a
 * submission reaches this function, so there is nothing here to leave out.
 */
function bodyFor(submission: FeedbackSubmission, sentAt: Date): string {
  const lines = [`Type: ${subjectTagFor(submission.type)}`];

  if (submission.analysisId) lines.push(`Analysis: ${submission.analysisId}`);
  lines.push(`From: ${submission.email ?? "not given"}`);
  lines.push(`Sent: ${sentAt.toISOString()}`);
  lines.push("", submission.message, "");

  return lines.join("\n");
}

/**
 * Sends one feedback message, or throws `FeedbackSendFailedError`.
 *
 * Every failure path throws the same error carrying the same user-safe
 * message. The real cause — Resend's own wording, its status code, a missing
 * key — is logged here and goes no further: the route turns this into a
 * response, and a response is something a scraper reads too.
 *
 * Returns Resend's message id so the route can log it. That id is the only
 * thread between "the app says it sent" and a row in Resend's dashboard, which
 * is what makes a delivery question answerable later rather than a shrug.
 */
export async function sendFeedbackEmail(
  submission: FeedbackSubmission,
  sentAt = new Date(),
): Promise<string> {
  const env = getEnv();

  if (!env.RESEND_API_KEY || !env.FEEDBACK_EMAIL) {
    console.error(
      "[feedback] not configured: RESEND_API_KEY and FEEDBACK_EMAIL must both be set",
    );
    throw new FeedbackSendFailedError();
  }

  let result;
  try {
    result = await getResendClient(env.RESEND_API_KEY).emails.send({
      from: FROM_ADDRESS,
      to: env.FEEDBACK_EMAIL,
      /*
        Set only when the user gave an address, so a reply from the inbox goes
        to them rather than to Resend's sandbox sender. Left off entirely when
        they did not, rather than pointed at FROM_ADDRESS — a reply-to that
        goes nowhere is worse than none, because it looks like it works.
      */
      ...(submission.email ? { replyTo: submission.email } : {}),
      subject: subjectFor(submission),
      text: bodyFor(submission, sentAt),
    });
  } catch (cause) {
    // A transport failure: DNS, TLS, a dropped socket. Resend reports API
    // errors on the envelope instead, handled just below.
    console.error("[feedback] resend threw:", cause);
    throw new FeedbackSendFailedError(cause);
  }

  /*
    Resend resolves rather than rejects on an API error, so the envelope has to
    be read. Skipping this is the exact shape of bug this feature must not
    ship: the send fails, nothing throws, and the user is thanked for a message
    that was discarded.
  */
  if (result.error) {
    console.error(
      `[feedback] resend rejected: ${result.error.name} (${result.error.statusCode ?? "no status"}) ${result.error.message}`,
    );
    throw new FeedbackSendFailedError(result.error);
  }

  /*
    A 200 with no id has never been observed, but the type allows it and a
    caller about to log "sent id=undefined" deserves better than that. Treated
    as a failure: if the provider cannot say what it accepted, this app cannot
    claim it was accepted.
  */
  if (!result.data?.id) {
    console.error("[feedback] resend returned no message id");
    throw new FeedbackSendFailedError();
  }

  return result.data.id;
}
