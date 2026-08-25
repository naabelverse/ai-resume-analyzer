"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BulletRewrite } from "@/types";

interface BulletRewritesProps {
  rewrites: BulletRewrite[];
  /**
   * The AI leg failed, so the list is empty because nothing read the resume —
   * not because the writing was judged and found fine. Paying that compliment
   * on the strength of a request that never completed is the one thing this
   * card must not do.
   */
  degraded?: boolean;
}

export function BulletRewrites({
  rewrites,
  degraded = false,
}: BulletRewritesProps) {
  if (rewrites.length === 0) {
    return (
      <p className="text-body text-ink-soft">
        {degraded
          ? "No rewrites: these come from the AI review, and it did not run. Nothing here has read your bullet points."
          : "No bullet rewrites for this resume — the experience section already reads well."}
      </p>
    );
  }

  return (
    <>
      {/* Stated once, above the list, rather than per card. RULE 2 used to tell
          the model to explain the convention in every `why`, which produced
          three different phrasings across three cards and silence on a fourth
          that contained two placeholders. The explanation is the interface's
          job: it is the same sentence every time, and it belongs where the
          reader meets the first placeholder. */}
      <p className="mb-4 text-caption text-ink-soft">
        Square brackets mark numbers only you know — replace them with your real
        figures before using these.
      </p>

      <ul className="flex flex-col gap-5">
        {rewrites.map((rewrite, index) => (
          <RewriteRow key={index} rewrite={rewrite} />
        ))}
      </ul>
    </>
  );
}

/**
 * Splits on a bracketed placeholder, keeping the delimiters.
 *
 * A capturing group makes `split` return the matches as well as the text
 * between them, so the pieces reassemble without losing a character.
 * `[^\]\n]*` refuses to cross a newline or a closing bracket, so an unmatched
 * `[` cannot swallow the rest of the bullet.
 */
const PLACEHOLDER_SPLIT = /(\[[^\]\n]*\])/g;

/** Anchored and NOT global — `test` on a `/g` regex is stateful and would alternate. */
const IS_PLACEHOLDER = /^\[[^\]\n]*\]$/;

/**
 * Renders `text` with any bracketed placeholder highlighted.
 *
 * A deliberate no-op when nothing matches: `split` returns a single-element
 * array, and this hands back the original string rather than an array holding
 * one fragment. The common path is then identical to what shipped before —
 * same node, same text — so the new failure path is entered only when there is
 * actually something to highlight.
 *
 * `whitespace-nowrap` on the mark is load-bearing at narrow widths: without it
 * `[X ms]` breaks across lines at its space and stops reading as one token.
 */
function withPlaceholders(text: string) {
  const parts = text.split(PLACEHOLDER_SPLIT);
  if (parts.length === 1) return text;

  return parts
    .filter((part) => part !== "")
    .map((part, index) =>
      IS_PLACEHOLDER.test(part) ? (
        <mark
          key={index}
          // No horizontal padding, deliberately. `[X]ms` and `[X]s` are one
          // value, and `px-1` pushed the unit away from its number so the pair
          // read as two things. The tint and the ink mark the placeholder on
          // their own; it does not need room around it. Vertical padding stays
          // — it grows the highlight away from the text, not along the line.
          className="rounded-[4px] bg-warning-tint py-px whitespace-nowrap text-warning-ink"
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
}

function RewriteRow({ rewrite }: { rewrite: BulletRewrite }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(rewrite.improved);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked by permissions; the text stays selectable.
      setCopied(false);
    }
  }

  return (
    <li className="border-t border-line pt-5 first:border-0 first:pt-0">
      {/* Side by side on desktop, stacked on mobile. */}
      <div className="grid gap-3 md:grid-cols-2">
        {/*
          Both boxes are flex columns with a header row of the same fixed
          height, and both bodies sit in a `flex-1` region below it.

          The height is `h-7` because that is what the Copy button measures —
          28px — and the button is what used to set the right-hand row on its
          own. A bare label is 16.8px, so the right label sat 5.6px low
          (`items-center` splitting the difference) and the right body sat the
          full 11.2px low. Pinning both rows to the button's own height is what
          puts the two labels and the two bodies back on the same lines.

          A fixed row rather than lifting the button out with `absolute`: the
          button stays in flow, so nothing can slide under a label and neither
          box has to become a positioning context to hold it.
        */}
        <div className="flex flex-col rounded-panel bg-muted-tint p-3">
          <div className="mb-1.5 flex h-7 items-center">
            <p className="text-caption font-semibold tracking-wide text-ink-soft uppercase">
              Original
            </p>
          </div>
          {/*
            The grid stretches both boxes to the taller one, so the shorter
            text — usually this one, since a rewrite runs longer than what it
            replaces — leaves a gap under it. Centring the text in the space
            the box actually has makes that gap read as room around the text
            rather than as the box having failed to fill. On one column nothing
            stretches, so this has nothing to centre and does nothing.
          */}
          <div className="flex flex-1 items-center">
            <p className="text-note leading-relaxed text-ink-soft">
              {rewrite.original}
            </p>
          </div>
        </div>

        <div className="flex flex-col rounded-panel bg-success-tint/60 p-3">
          <div className="mb-1.5 flex h-7 items-center justify-between gap-2">
            <p className="text-caption font-semibold tracking-wide text-success uppercase">
              Improved
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={copy}
              // Size comes from size="sm"; a text-* here would lose to it.
              className="-mr-1 h-7 px-2"
            >
              {copied ? (
                <>
                  <Check className="size-3.5" /> Copied
                </>
              ) : (
                <>
                  <Copy className="size-3.5" /> Copy
                </>
              )}
            </Button>
          </div>
          {/* Highlighted here only. `copy()` above writes `rewrite.improved`
              itself, never the rendered text — the candidate has to receive the
              brackets to know what to replace, and reading them back off the
              DOM would hand them whatever whitespace the fragments happened to
              produce instead of the string the model actually wrote. */}
          <div className="flex flex-1 items-center">
            <p className="text-note leading-relaxed text-ink">
              {withPlaceholders(rewrite.improved)}
            </p>
          </div>
        </div>
      </div>

      {/* One sentence of commentary has no business running the full width of
          a two-column pair — at 1440 that was 1110px, several times a readable
          measure. Capped in `ch` rather than px so the limit stays tied to the
          face and size it is measuring. */}
      <p className="mt-2.5 max-w-[66ch] text-note text-ink-soft">
        <span className="font-medium text-ink">Why: </span>
        {rewrite.why}
      </p>
    </li>
  );
}
