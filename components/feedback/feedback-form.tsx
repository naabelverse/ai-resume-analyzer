"use client";

import { useId } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/error-state";
import { FEEDBACK_TYPES, HONEYPOT_FIELD } from "@/lib/feedback";
import { FEEDBACK_MAX_CHARS } from "@/lib/limits";
import { cn } from "@/lib/utils";
import type { FeedbackForm as FeedbackFormState } from "./use-feedback-form";

/**
 * The modal's body: the form, and the confirmation that replaces it.
 *
 * Every field treatment here is the job-description field's rather than a
 * second standard — the same recessed fill, edge, focus behaviour and
 * character counter. A form that looks like the app's other form is one fewer
 * thing for a reader to work out.
 */

interface FeedbackFormProps {
  form: FeedbackFormState;
  /** Sent with the payload, never rendered. */
  analysisId: string | null;
}

/**
 * Shared by the textarea and the email input.
 *
 * Lifted from `<JobDescriptionInput>` rather than reinvented: `--surface-inset`
 * so a field reads as somewhere to type against a near-white card, an edge in
 * `--line-strong`, and no `outline-none` — the app-wide 2px brand focus ring in
 * globals.css is what marks the live control, and suppressing it leaves focus
 * as a one-pixel colour swap.
 */
const FIELD = cn(
  "w-full rounded-panel border border-line-strong bg-surface-inset p-3 transition-colors",
  "text-body text-ink placeholder:text-ink-soft",
  "focus-visible:border-brand-600 focus-visible:bg-surface",
);

export function FeedbackForm({ form, analysisId }: FeedbackFormProps) {
  const ids = useId();
  const { draft, phase, canSubmit, set, submit } = form;

  const sending = phase.kind === "sending";
  const atCap = draft.message.length >= FEEDBACK_MAX_CHARS;

  /*
    The confirmation, and the only thing that produces it is a response saying
    the mail was sent. It does not dismiss itself: a confirmation that vanishes
    on a timer is one the reader may never have seen, and this is the single
    moment the form has to prove it did what it claimed.
  */
  if (phase.kind === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-success-tint text-success"
        >
          <Check className="size-5" strokeWidth={2.6} />
        </span>

        <div className="max-w-[38ch]">
          <p role="status" className="text-body font-medium text-ink">
            Thanks &mdash; that&rsquo;s been sent.
          </p>
          <p className="mt-2 text-note leading-relaxed text-ink-soft">
            {draft.email
              ? `It's in my inbox. If it needs an answer, the reply goes to ${draft.email}.`
              : "It’s in my inbox. You didn’t leave an address, so there’s no reply coming — it still gets read."}
          </p>
        </div>

        {/*
          "Done", not "Close" — the X in the corner is already named Close, and
          two buttons with one accessible name in one dialog is a genuine
          ambiguity for anyone navigating by name rather than by sight. It also
          reads better: this one ends a task, the X abandons one.
        */}
        <Dialog.Close asChild>
          <Button type="button" variant="secondary" className="mt-1">
            Done
          </Button>
        </Dialog.Close>
      </div>
    );
  }

  return (
    <form
      className="mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(analysisId);
      }}
    >
      {/*
        Radios rather than a select. Three short options that fit on screen at
        once need no disclosure, and this app has no select component — a
        native one would be the only control here not wearing the field
        treatment above.
      */}
      <fieldset disabled={sending}>
        <legend className="text-note font-medium text-ink">
          What&rsquo;s this about?
        </legend>

        <div className="mt-1 flex flex-col">
          {FEEDBACK_TYPES.map((entry) => (
            <label
              key={entry.value}
              className={cn(
                // min-h-10 is the 40px pointer target, which matters most on
                // the phone where these sit directly under a thumb.
                "flex min-h-10 cursor-pointer items-center gap-2.5 text-body transition-colors",
                draft.type === entry.value ? "text-ink" : "text-ink-soft",
              )}
            >
              <input
                type="radio"
                name={`${ids}-type`}
                value={entry.value}
                checked={draft.type === entry.value}
                onChange={() => set("type", entry.value)}
                // `accent-brand-600` resolves to --color-brand-600, so the
                // native control is tinted from the token rather than from a
                // colour written here.
                className="size-4 shrink-0 accent-brand-600"
              />
              {entry.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <label htmlFor={`${ids}-message`} className="text-note font-medium text-ink">
          Your message
        </label>
        <textarea
          id={`${ids}-message`}
          value={draft.message}
          onChange={(event) => set("message", event.target.value)}
          disabled={sending}
          rows={5}
          maxLength={FEEDBACK_MAX_CHARS}
          placeholder="What happened, what you expected instead, or what would make this better."
          // `scrollbar-quiet` is the well and job-description treatment,
          // shared rather than copied — colour only, no geometry.
          className={cn(FIELD, "mt-1.5 resize-y scrollbar-quiet")}
        />
        <div className="mt-1.5 flex justify-end">
          <span
            className={cn(
              "text-caption tabular-nums",
              atCap ? "font-medium text-warning-ink" : "text-ink-soft",
            )}
          >
            {draft.message.length.toLocaleString()} /{" "}
            {FEEDBACK_MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor={`${ids}-email`} className="text-note font-medium text-ink">
          Your email (optional, if you&rsquo;d like a reply)
        </label>
        <input
          id={`${ids}-email`}
          type="email"
          value={draft.email}
          onChange={(event) => set("email", event.target.value)}
          disabled={sending}
          autoComplete="email"
          placeholder="you@example.com"
          className={cn(FIELD, "mt-1.5 h-10 px-3 py-0")}
        />
      </div>

      {/*
        The honeypot.

        Positioned off-screen rather than `display: none` — the crawlers worth
        catching skip hidden fields and fill visible ones, so it has to be
        visible to a parser and unreachable to a person. `aria-hidden` and
        `tabIndex={-1}` keep it out of both the accessibility tree and the tab
        order, so nobody using either can fill it in by accident and have their
        message silently discarded.

        A plausible label and name, for the same reason: an autofilling bot has
        to recognise it as worth completing.
      */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-[-9999px] h-0 overflow-hidden"
      >
        <label htmlFor={`${ids}-website`}>Website</label>
        <input
          id={`${ids}-website`}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={draft.honeypot}
          onChange={(event) => set("honeypot", event.target.value)}
        />
      </div>

      {/* A failure leaves everything above it exactly as it was typed. */}
      {phase.kind === "failed" && <InlineError code={phase.code} />}

      {/*
        `--line-strong`, matching the upload form's action row: this rule
        divides the form body from its action, which is the heavier of the two
        boundaries the tokens distinguish.
      */}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line-strong pt-4">
        <p className="text-caption text-ink-soft">Goes straight to my inbox.</p>
        <Button type="submit" disabled={!canSubmit}>
          {sending ? (
            <>
              {/*
                Frozen by the reduced-motion block in globals.css, which is
                correct: the label beside it is the real signal, the same way
                "Analysing…" is on the upload form.
              */}
              <Loader2 className="animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            "Send feedback"
          )}
        </Button>
      </div>
    </form>
  );
}
