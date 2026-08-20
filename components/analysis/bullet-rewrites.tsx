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
        <div className="rounded-panel bg-muted-tint p-3">
          <p className="mb-1.5 text-caption font-semibold tracking-wide text-ink-soft uppercase">
            Original
          </p>
          <p className="text-note leading-relaxed text-ink-soft">
            {rewrite.original}
          </p>
        </div>

        <div className="rounded-panel bg-success-tint/60 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
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
          <p className="text-note leading-relaxed text-ink">
            {rewrite.improved}
          </p>
        </div>
      </div>

      <p className="mt-2.5 text-note text-ink-soft">
        <span className="font-medium text-ink">Why: </span>
        {rewrite.why}
      </p>
    </li>
  );
}
