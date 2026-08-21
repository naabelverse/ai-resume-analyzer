"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";

import { JD_MAX_CHARS } from "@/lib/limits";
import { cn } from "@/lib/utils";

interface JobDescriptionInputProps {
  value?: string;
  onChange?: (value: string) => void;
  defaultOpen?: boolean;
}

/**
 * Collapsible job-description textarea. Leaving it empty is a first-class
 * case: keyword matching is skipped entirely rather than rendering an empty
 * panel downstream.
 */
export function JobDescriptionInput({
  value,
  onChange,
  defaultOpen = false,
}: JobDescriptionInputProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [internal, setInternal] = useState("");

  const text = value ?? internal;
  const atCap = text.length >= JD_MAX_CHARS;

  function handleChange(next: string) {
    const clipped = next.slice(0, JD_MAX_CHARS);
    if (value === undefined) setInternal(clipped);
    onChange?.(clipped);
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen}>
      {/*
        Two jobs, one control. Closed, it is the only thing standing in for the
        field it hides, so it wears that field's edge and fill and reads as
        something that opens. Open, the textarea below carries those, and a
        second bordered box stacked on top of it would read as a second input —
        so the trigger drops back to being the label for what it opened.

        Padding stays on the vertical axis in both states: at py-2.5 the row
        clears 40px, and shrinking it when open would quietly drop the target
        below that on the state where it is still the way to close.
      */}
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-control py-2.5",
          "text-body font-medium transition-colors",
          open
            ? "px-1 text-ink-soft"
            : "border border-line-strong bg-surface-inset px-3 text-ink hover:border-brand-600 hover:text-brand-600",
        )}
      >
        <span>Paste the job description (optional)</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </Collapsible.Trigger>

      <Collapsible.Content className="pt-2">
        <textarea
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          rows={6}
          maxLength={JD_MAX_CHARS}
          /*
            Asks for the whole posting, because the previous copy asked for
            "the responsibilities and requirements" — two sections, which reads
            as an instruction to summarise. Keyword matching works off the
            terms the role actually uses, and the terms live everywhere in a
            posting, including the boilerplate. Naming the budget is what makes
            the ask credible: "paste it all" from a box that looks small is an
            invitation nobody takes.
          */
          placeholder={`Paste the entire job posting — responsibilities, requirements, nice-to-haves and all. The full text matches better than a summary, and there is room for ${JD_MAX_CHARS.toLocaleString()} characters.`}
          className={cn(
            // Was `bg-surface` — a white field on a white card face, which
            // read as a gap rather than as somewhere to type. The fix is the
            // fill, not the edge: a 1px line is hard to see at any colour,
            // while two different surfaces are obvious at a glance.
            //
            // `--surface-inset`, the same surface `.panel` wears. The field
            // briefly had a deeper token of its own at dL* 6.81 so it would
            // not tie with a passive panel beside it, but that made it the
            // darkest thing in the form, and matching the panels is the read
            // this form wants. At 3.56 it still separates from the card face;
            // what marks it as the live control is focus, not resting depth.
            //
            // `.scrollbar-quiet` is the extracted-text well's scrollbar
            // treatment, shared rather than copied. Colour only — it changes
            // nothing about this field's size, padding, edge, radius or resize
            // handle.
            "w-full resize-y rounded-panel border border-line-strong bg-surface-inset p-3 transition-colors",
            "scrollbar-quiet",
            "text-body text-ink placeholder:text-ink-soft",
            // `outline-none` used to sit here, which suppressed the app-wide
            // focus ring in globals.css and left focus as a one-pixel colour
            // swap — barely a change from resting, and now that resting has a
            // real edge, not a change at all. Without it the standard 2px
            // brand outline applies, so focus outranks the resting state
            // rather than tying with it, and the fill lifts to the live
            // surface to say the field is the one taking input.
            "focus-visible:border-brand-600 focus-visible:bg-surface",
          )}
        />
        <div className="mt-1.5 flex justify-end">
          <span
            className={cn(
              "text-caption tabular-nums",
              atCap ? "font-medium text-warning" : "text-ink-soft",
            )}
          >
            {text.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
