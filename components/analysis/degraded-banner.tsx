import { AlertCircle } from "lucide-react";

import { ERROR_COPY, type ErrorCode } from "@/lib/errors";

/**
 * Shown when `meta.degraded` is true: the AI portion failed, so the report
 * below is the deterministic checks only.
 *
 * It names the actual cause rather than saying "AI unavailable" for everything.
 * Exhausted credits and a momentary rate limit both land here, but one is fixed
 * by waiting sixty seconds and the other never is — telling someone to "try
 * again shortly" when their credits are gone wastes their afternoon.
 *
 * Presenting a structural-only score as though it were the full review would be
 * the worse failure: the user would act on a number that never judged their
 * writing.
 */
export function DegradedBanner({ reason }: { reason: ErrorCode | null }) {
  const copy = reason ? ERROR_COPY[reason] : null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-panel border border-warning/30 bg-warning-tint px-4 py-3 text-note leading-relaxed"
    >
      {/* The row carries the type so the slot below can measure one line
          against it; the glyph then centres on the first line of the message
          rather than on the whole block. */}
      <span aria-hidden="true" className="flex h-[1lh] shrink-0 items-center">
        <AlertCircle className="size-4 text-warning" strokeWidth={2.4} />
      </span>
      <div className="max-w-[72ch]">
        <p className="text-ink">
          <span className="font-semibold">
            {copy ? copy.title : "AI review unavailable"}.
          </span>{" "}
          <span className="text-ink-soft">
            The score and feedback below come from automated structural checks
            only — they measure format and completeness, not how well your
            resume is written.
          </span>
        </p>
        {copy && (
          <p className="mt-1.5 text-ink-soft">
            {copy.message} <span className="text-ink">{copy.action}</span>
          </p>
        )}
      </div>
    </div>
  );
}
