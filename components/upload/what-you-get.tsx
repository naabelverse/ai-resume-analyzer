import { Gauge, ListChecks, MessageSquareText, PenLine, Search } from "lucide-react";

/**
 * Sits under the job-description control and fills the right-hand column.
 *
 * The column exists because the drop target does not need half a card; with
 * the job description collapsed by default — a deliberate choice, since most
 * people have no JD to hand — the space beside it was simply blank, and an
 * empty half card reads as a page that failed to render rather than as one
 * with nothing to say there.
 *
 * So it says the thing a first-time visitor is actually weighing before they
 * hand over a file: what comes back. The closing line is the honest answer to
 * "why would I paste a job description", which is the one question the control
 * above it raises and cannot answer while collapsed.
 */

/** Mirrors the report's own cards, in the order `<AnalysisView>` renders them. */
const OUTPUTS = [
  { icon: Gauge, text: "A score out of 100, and why it landed there" },
  { icon: ListChecks, text: "A section-by-section breakdown" },
  { icon: MessageSquareText, text: "Specific feedback, strongest issues first" },
  { icon: PenLine, text: "Rewrites for your weakest bullet points" },
] as const;

export function WhatYouGet() {
  return (
    /*
      `.panel` supplies the shape, then the fill and edge are lightened off it.
      The trigger above is a control and this is a list of claims, so the
      control has to win — and it could not, because both were wearing the same
      recessed fill and the same strong edge, at which point the larger box
      reads as the more important one.

      Lightened here rather than by pushing the trigger harder: this panel is
      the thing that should recede, and strengthening a control until it beats
      its own supporting text is how a form ends up shouting in two places.

      Overridden per instance, never on `.panel` itself — four other callers
      use that class and all of them want the recessed surface.
    */
    <div className="panel border-line bg-transparent">
      <h3 className="text-title">What you&rsquo;ll get</h3>

      <ul className="mt-3.5 flex flex-col gap-2.5">
        {OUTPUTS.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-2.5">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-brand-600"
              strokeWidth={2.2}
            />
            <span className="text-note text-ink-soft">{text}</span>
          </li>
        ))}
      </ul>

      {/* Divides two things inside one panel, which is `--line`'s actual job —
          and it cannot outweigh the panel's own edge, now that that edge is
          the lighter token too. */}
      <p className="mt-4 flex items-start gap-2.5 border-t border-line pt-3.5">
        <Search
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-ink-soft"
          strokeWidth={2.2}
        />
        <span className="text-note text-ink-soft">
          Paste the job description above and you&rsquo;ll also get a keyword
          match — the role&rsquo;s terms your resume already uses, and the ones
          it misses.
        </span>
      </p>
    </div>
  );
}
