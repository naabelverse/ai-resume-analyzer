"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { persistenceMode, store } from "@/lib/store";
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
        <p className="text-body text-ink-soft">
          No analyses yet.
          {/* Both variables, deliberately. The browser store reads the
              NEXT_PUBLIC_ one; naming only PERSISTENCE here would send someone
              to set a server-only value that reads as undefined in the browser
              and leaves them pinned to session mode with no sign why. */}
          {persistenceMode === "session" &&
            " History is kept for this browser tab only — set PERSISTENCE=db" +
              " and NEXT_PUBLIC_PERSISTENCE=db to keep it across sessions."}
        </p>
        <Button asChild>
          <Link href="/">Analyse a resume</Link>
        </Button>
      </div>
    );
  }

  return (
    <ul className="max-w-[736px] divide-y divide-line">
      {records.map((record) => (
        <li key={record.id} className="flex items-center gap-3 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-brand-tint text-body font-semibold text-brand-600 tabular-nums">
            {record.overallScore}
          </span>

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
            </p>
          </div>

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
        </li>
      ))}
    </ul>
  );
}
