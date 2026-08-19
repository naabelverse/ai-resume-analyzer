import { AlertTriangle } from "lucide-react";

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
      className="flex items-start gap-3 rounded-panel border border-warning/30 bg-warning-tint px-4 py-3"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
        strokeWidth={2.4}
      />
      <div className="text-[13px] leading-relaxed">
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
