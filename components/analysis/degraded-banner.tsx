import Link from "next/link";
import { AlertCircle } from "lucide-react";

import {
  DEGRADED_COPY,
  ERROR_COPY,
  GENERIC_RETRY,
  type ErrorCode,
} from "@/lib/errors";

/**
 * Shown when `meta.degraded` is true: the AI portion failed, so what renders
 * below it covers formatting and structure only.
 *
 * WHY A LINK AND NOT A "TRY AGAIN" BUTTON. There is nothing here to retry
 * with. `<AnalyzeForm>` posts the raw file, saves a record of
 * `{id, fileName, createdAt, data, meta}` and navigates — which unmounts the
 * form and drops the `File`. What arrives on this page is the filename as a
 * string; the bytes are gone, and the server never kept them either. Holding
 * them to enable a retry means either a module-level reference, which dies on
 * the reload this page invites, or browser storage, which would break "Nothing
 * is stored — your file is discarded once the text has been read" on the
 * upload card. The job description is not carried either, so a "retry" would
 * silently run a DIFFERENT analysis than the one that failed. A link that
 * admits you have to pick the file again is the honest version.
 *
 * The wording splits in two on purpose. `DEGRADED_COPY` is what is true of
 * every degraded run; only the next step differs by cause, and that comes from
 * the failing code's `action`. Exhausted credits and a momentary rate limit
 * both land here, and one is fixed by waiting a minute while the other never
 * is — telling someone to run it again when the credit is gone wastes their
 * afternoon.
 *
 * WHICH IS WHY THE GENERIC ACTION IS DROPPED HERE. `AI_UNAVAILABLE` and
 * `AI_SCHEMA` both carry `GENERIC_RETRY`, and that sentence is the one thing
 * the button beside it already says. Rendering both put "Running it again
 * usually works." next to a button reading "Upload it again" — two phrasings
 * of one step, which read as two different actions and left the reader
 * guessing which the click performs. That pairing shipped in `95ae0c9`, where
 * both strings were written, and was never right rather than having broken
 * later. Only actions the button CANNOT express survive here.
 */
export function DegradedBanner({ reason }: { reason: ErrorCode | null }) {
  const copy = reason ? ERROR_COPY[reason].action : null;
  const action = copy === GENERIC_RETRY ? null : copy;

  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-panel border border-warning/30 bg-warning-tint px-4 py-3 text-note leading-relaxed sm:flex-row sm:items-center sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {/* The row carries the type so the slot below can measure one line
            against it; the glyph then centres on the first line of the message
            rather than on the whole block. */}
        <span aria-hidden="true" className="flex h-[1lh] shrink-0 items-center">
          <AlertCircle className="size-4 text-warning" strokeWidth={2.4} />
        </span>
        {/*
          No `max-w-[72ch]` any more. It wrapped the text at roughly 800px
          inside a container running the full shell width, so the banner
          reserved the whole row and used half of it. The measure is now set by
          the thing beside it — the link takes its width on the right, the text
          takes the rest — which is a readable column AND a balanced row rather
          than a choice between the two.
        */}
        <div className="min-w-0">
          <p className="text-ink">
            <span className="font-semibold">{DEGRADED_COPY.title}.</span>{" "}
            <span className="text-ink-soft">{DEGRADED_COPY.body}</span>
          </p>
          {action && <p className="mt-1.5 text-ink-soft">{action}</p>}
        </div>
      </div>

      {/*
        A bordered link rather than a `<Button>`. The button variants would put
        a second primary-looking action on the page, and this is a way out of a
        failure, not the page's purpose. `min-h-10` because the README already
        lists sub-40px targets as a known issue and this is a new target.
      */}
      <Link
        href="/"
        className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-control border border-warning/40 px-4 font-medium text-warning-ink hover:bg-warning/10"
      >
        {DEGRADED_COPY.linkLabel}
      </Link>
    </div>
  );
}
