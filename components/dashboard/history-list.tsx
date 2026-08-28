"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DEGRADED_COPY } from "@/lib/errors";
import { persistenceMode, store } from "@/lib/store";
import { cn } from "@/lib/utils";
import { VERDICT_BADGE, deriveVerdict } from "@/types";
import type { AnalysisSummary } from "@/types";

/**
 * Past analyses, newest first.
 *
 * Reads through the same `store` interface the rest of the app uses, so it
 * shows session history when `PERSISTENCE=session` and database history when
 * `PERSISTENCE=db` — and, if the database is configured but unreachable, the
 * session history the remote store falls back to. No branch in this component
 * knows which of those happened.
 */
export function HistoryList() {
  const [records, setRecords] = useState<AnalysisSummary[] | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void store.list().then(setRecords);
  }, []);

  useEffect(refresh, [refresh]);

  async function remove(id: string) {
    setPendingId(id);
    try {
      await store.remove(id);
      setRecords((current) => current?.filter((entry) => entry.id !== id) ?? null);
    } finally {
      setPendingId(null);
    }
  }

  if (records === null) {
    return <p className="py-6 text-body text-ink-soft">Loading your history…</p>;
  }

  if (records.length === 0) {
    return (
      <div className="panel flex flex-col items-center gap-3 px-6 py-10 text-center">
        {/* Says what happens to the history, not how to change it. This once
            named both persistence variables and told the reader to set them,
            which is a setup instruction wearing an empty state's clothes: an
            env var means nothing to someone using the app, and reading one
            here suggests they missed a step. Turning on `db` mode is a
            developer's job and it is documented in the README.

            The branch is on the store that is actually running, not on a flag
            the copy then names. Both sentences are true of the mode they
            appear in — "it clears when you close the tab" is a promise the db
            store does not keep, and one the session store must make, since
            losing a report you waited a minute for is worth a warning. */}
        <p className="text-body text-ink-soft">
          {persistenceMode === "session"
            ? "No analyses yet. Your history stays in this browser tab — it clears when you close it."
            : "No analyses yet. Anything you analyse will be saved here."}
        </p>
        <Button asChild>
          <Link href="/">Analyse a resume</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {records.map((record) => (
        <li key={record.id} className="flex items-center gap-3 py-3">
          {/*
            No score for a degraded run — the rule the report page has followed
            since `95ae0c9`, applied to the one place still breaking it. The
            number here was worse than the one removed there: it is the most
            scannable thing in the row, it sits in a brand-tinted badge that
            reads as a grade, and unlike the report page nothing beside it says
            the AI never ran.

            Marked as well as suppressed, because those are one change rather
            than alternatives. A blank slot where every other row has a badge
            reads as broken; a caption alone would leave the misleading number
            winning on sight, which is the small version of a 14px caveat
            losing to a 180px ring. So the badge stops claiming a grade and the
            line below says why.

            Dimensions are identical either way — same `size-10`, same radius,
            same row. Only the fill and what is inside it change.
          */}
          {record.degraded ? (
            <span
              className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-warning-tint text-warning"
              aria-hidden="true"
            >
              <AlertCircle className="size-4" strokeWidth={2.4} />
            </span>
          ) : (
            <span
              className={cn(
                "grid size-10 shrink-0 place-items-center rounded-[12px] text-body font-semibold tabular-nums",
                VERDICT_BADGE[deriveVerdict(record.overallScore)],
              )}
            >
              {record.overallScore}
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink" title={record.fileName}>
              {record.fileName}
            </p>
            <p className="mt-0.5 text-caption text-ink-soft">
              <time dateTime={record.createdAt}>
                {new Date(record.createdAt).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
              {/* Carries the meaning the badge stopped carrying, and is the
                  only thing on this row a screen reader gets about it — the
                  glyph beside it is decorative. */}
              {record.degraded && (
                <span className="text-warning-ink">
                  {" · "}
                  {DEGRADED_COPY.rowNote}
                </span>
              )}
            </p>
          </div>

          {/* The two actions are one cluster and own their spacing. They used
              to be direct children of the row, so the only thing between them
              was its `gap-3` — the same 12px that separates the score badge
              from the filename, which is what made them read as two unrelated
              controls rather than a pair. The 12px was never the whole story
              either: both buttons are ghosts, so their padding is invisible at
              rest and adds to whatever gap is set. The trailing `px-3` on View
              plus the icon button's 10px centring put 34px between the arrow
              and the bin, and 55px between the word and the bin.

              So the fix is the grouping, not a smaller number bolted onto the
              row: nested, the pair sets its own near-zero gap while the row
              keeps the 12px rhythm it wants everywhere else. Padding stays —
              it is the hit area, and shrinking a 36px target to close a visual
              gap trades a real affordance for an optical one. */}
          <div className="flex shrink-0 items-center gap-0.5">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/analyze/${record.id}`}>
                View
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 text-ink-soft hover:text-danger"
              disabled={pendingId === record.id}
              onClick={() => void remove(record.id)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span className="sr-only">Delete the analysis of {record.fileName}</span>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
