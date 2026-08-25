"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft } from "lucide-react";

import { Reveal } from "@/components/reveal";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/error-state";
import { BulletRewrites } from "./bullet-rewrites";
import { DegradedBanner } from "./degraded-banner";
import { FeedbackList } from "./feedback-list";
import { KeywordMatchPanel } from "./keyword-match";
import { ScanningCard } from "./scanning-card";
import { ScoreGauge } from "./score-gauge";
import { SectionBreakdown } from "./section-breakdown";
import { store } from "@/lib/store";
import { PLACEHOLDER_ANALYSIS, PLACEHOLDER_FILE_NAME } from "@/lib/placeholder";
import type { AnalysisRecord } from "@/types";

/**
 * Reads the saved analysis by route id and renders it.
 *
 * Client-side because the session store lives in the browser. The database
 * mode could render this on the server, but keeping one code path means the
 * page behaves identically whether or not a database is configured — and the
 * refresh-survives requirement is satisfied the same way in both.
 */

/** The `demo` id serves the static sample so the layout is reviewable without an API key. */
const DEMO: AnalysisRecord = {
  id: "demo",
  fileName: PLACEHOLDER_FILE_NAME,
  createdAt: "2026-01-01T00:00:00.000Z",
  data: PLACEHOLDER_ANALYSIS,
  meta: {
    degraded: false,
    degradedReason: null,
    truncated: false,
    timings: {},
    pageCount: 2,
    wordCount: 612,
  },
};

type ViewState =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "ready"; record: AnalysisRecord };

export function AnalysisView({ id }: { id: string }) {
  // The demo record is known at render time, so it is the initial state
  // rather than something an effect assigns immediately after mounting.
  const [state, setState] = useState<ViewState>(() =>
    id === "demo" ? { phase: "ready", record: DEMO } : { phase: "loading" },
  );

  useEffect(() => {
    if (id === "demo") return;
    let cancelled = false;

    void store.load(id).then((record) => {
      if (cancelled) return;
      setState(record ? { phase: "ready", record } : { phase: "missing" });
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.phase === "loading") {
    return (
      <Card>
        <ScanningCard stageIndex={3} progress={90} />
      </Card>
    );
  }

  if (state.phase === "missing") {
    return (
      <Card>
        <ErrorState code="UNKNOWN">
          <Button asChild>
            <Link href="/">Analyse a resume</Link>
          </Button>
        </ErrorState>
      </Card>
    );
  }

  const { data: analysis, meta, fileName } = state.record;

  return (
    <>
      {meta.degraded && (
        <Reveal index={0} className="mb-5">
          <DegradedBanner reason={meta.degradedReason} />
        </Reveal>
      )}

      {/*
        The verdict leads. It used to sit at the top of the right-hand column
        of a 5/7 split, which buried the one number the page exists to deliver
        and left the shorter left column dead-ending against a much taller
        neighbour. Full width also lets the summary and the rationale sit side
        by side, each at a readable measure, rather than stacking into a narrow
        strip beside the gauge.
      */}
      <Reveal index={0}>
        <Card>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
            <ScoreGauge score={analysis.overallScore} />
            <div className="grid min-w-0 flex-1 gap-5 min-[1040px]:grid-cols-2 min-[1040px]:gap-8">
              <div className="min-w-0">
                <CardTitle>Resume score</CardTitle>
                <p className="mt-2 text-body leading-relaxed text-ink-soft">
                  {analysis.summary}
                </p>
              </div>
              {/*
                The model's own account of what drove the score. Shown rather
                than hidden: a score with visible reasoning behind it can be
                argued with, and one without it can only be believed or
                ignored.

                Not "the band it chose" — it chooses no band. The score is
                computed from its six dimension scores, and the prompt now
                forbids it naming a band or a range here at all, because
                "Band 60-74" is our vocabulary and means nothing to a reader.
              */}
              <p className="min-w-0 border-t border-line pt-4 text-note leading-relaxed text-ink-soft min-[1040px]:border-t-0 min-[1040px]:border-l min-[1040px]:pt-0 min-[1040px]:pl-8">
                <span className="font-medium text-ink">Why this score: </span>
                {analysis.scoreRationale}
              </p>
            </div>
          </div>
        </Card>
      </Reveal>

      {/*
        Two even columns, loaded so they end near together: section breakdown
        is far and away the tallest panel, so it carries one column almost by
        itself while the two mid-sized panels share the other. Pairing it with
        anything else is what left the short column dead-ending halfway down
        the page under the old 5/7 split.
      */}
      <div className="mt-5 grid grid-cols-1 items-start gap-5 min-[900px]:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Reveal index={1}>
            <Card>
              <CardTitle>Your resume</CardTitle>
              <p className="mt-2 truncate text-body font-medium text-ink" title={fileName}>
                {fileName}
              </p>
              <p className="mt-1 text-note text-ink-soft">
                {meta.wordCount.toLocaleString()} words
                {meta.pageCount ? `, ${meta.pageCount} page${meta.pageCount === 1 ? "" : "s"}` : ""}
                {meta.truncated ? " — the middle was omitted for length" : ""}
              </p>
              <div className="mt-5">
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Analyse another resume
                  </Link>
                </Button>
              </div>
            </Card>
          </Reveal>

          <Reveal index={2}>
            <Card>
              <CardTitle>Section breakdown</CardTitle>
              <div className="mt-4">
                <SectionBreakdown sections={analysis.sections} />
              </div>
            </Card>
          </Reveal>
        </div>

        <div className="flex flex-col gap-5">
          <Reveal index={3}>
            <Card>
              {/* The banner above has just said the AI did not run; a card
                  titled "AI feedback" underneath it contradicts that. */}
              <CardTitle>
                {meta.degraded ? "Automated checks" : "AI feedback"}
              </CardTitle>
              <div className="mt-1">
                <FeedbackList items={analysis.feedback} />
              </div>
            </Card>
          </Reveal>

          <Reveal index={4}>
            <Card>
              <CardTitle>Keyword match</CardTitle>
              <div className="mt-4">
                <KeywordMatchPanel
                  data={analysis.keywordMatch}
                  degraded={meta.degraded}
                />
              </div>
            </Card>
          </Reveal>
        </div>
      </div>

      <Reveal index={5} className="mt-5">
        <Card>
          <CardTitle>Suggested bullet rewrites</CardTitle>
          <div className="mt-4">
            <BulletRewrites
              rewrites={analysis.bulletRewrites}
              degraded={meta.degraded}
            />
          </div>
        </Card>
      </Reveal>

      {analysis.redFlags.length > 0 && (
        <Reveal index={6} className="mt-5">
          <Card>
            {/*
              "Things to fix" over `analysis.redFlags` is a DELIBERATE mismatch
              between the heading and the field, not an oversight.

              The heading was "Red flags" while the icons were amber, and in
              this report amber means "Needs work" and red means "Poor" — so
              the section contradicted its own styling. What it actually lists
              is an employment gap and two typos: things worth fixing, not
              things that get a resume rejected. Alarming someone about a
              five-minute problem is the more expensive error, so the name
              moved rather than the colour.

              Red is not free here either. `fail` already owns it in
              `<FeedbackList>`, `<SectionBreakdown>` and `<Badge>`, where it
              means "a concrete problem that costs interviews". Keeping this
              section amber is what keeps those two tiers distinguishable.

              The field stays `redFlags` because renaming a persisted field
              touches stored records — a separate decision from what the
              section is called on screen.
            */}
            <CardTitle>Things to fix</CardTitle>
            <ul className="mt-4 flex flex-col gap-2">
              {analysis.redFlags.map((flag) => (
                <li
                  key={flag}
                  className="flex items-start gap-2.5 text-note leading-relaxed"
                >
                  <span
                    aria-hidden="true"
                    className="flex h-[1lh] shrink-0 items-center"
                  >
                    <AlertCircle className="size-4 text-warning" />
                  </span>
                  <span className="text-ink-soft">{flag}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Reveal>
      )}
    </>
  );
}
