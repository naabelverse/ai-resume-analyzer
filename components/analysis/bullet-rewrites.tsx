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
    <ul className="flex flex-col gap-5">
      {rewrites.map((rewrite, index) => (
        <RewriteRow key={index} rewrite={rewrite} />
      ))}
    </ul>
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
          <div className="flex flex-1 items-center">
            <p className="text-note leading-relaxed text-ink">
              {rewrite.improved}
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
