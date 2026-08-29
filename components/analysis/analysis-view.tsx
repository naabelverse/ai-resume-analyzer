"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Upload } from "lucide-react";

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

        ABSENT ENTIRELY WHEN DEGRADED, which is the whole card and not just the
        ring. The deterministic scorer measures whether an email address is
        present, how many bullets carry a number, and which of six headings it
        found. The gauge renders that identically to a real one — same ring,
        same 0-100, and since the header was unified, the same green/amber/red
        — under a label reading "Strong" or "Poor". Those words judge how good
        a resume IS. Nothing here judged that. A resume can be structurally
        immaculate and badly written and this card would call it Strong.

        Qualifying it was the alternative and it does not work: a 14px line of
        caveat cannot beat a 180px ring with a number in it, and every attempt
        to make it win means a louder warning, which makes the failure page
        more alarming rather than more honest.

        The rest of the card goes with the ring because the rest of the card is
        about the ring — `summary` and `scoreRationale` from `buildDegradedResult`
        both describe a score, and left standing alone they would explain a
        number that is no longer on screen.
      */}
      {!meta.degraded && (
      <Reveal index={0}>
        <Card>
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-8">
            <ScoreGauge score={analysis.overallScore} />
            {/*
              The divider lands on the ROW's midpoint, and the first track is
              derived from that rather than picked as a ratio.

              These two columns were `grid-cols-2` — genuinely equal, measured
              at 433px each on a 1440 viewport. They still read as lopsided,
              because the ring is a flex sibling outside this grid and the eye
              groups it with the heading beside it: ring + gap + summary is
              645px of apparent "Resume score" against 401px of rationale.
              Even columns, uneven regions. Equalising the columns harder does
              nothing, since they were never unequal.

              With R the ring block (180 gauge + the row's 32px gap = 212) and
              G this grid's own width, a divider at the row midpoint (R + G)/2
              sits after a first track of G/2 - R/2 - gap = G/2 - 138px. A
              percentage in `grid-template-columns` resolves against G, so that
              expression IS the track.

              Derived, not tuned, because the ring is a fixed 180px while the
              columns are fluid — so any fixed fr ratio only balances at one
              width. The 4fr/7fr that centres the divider at 1440 puts it 26px
              off centre at 1040, where this two-column mode starts.
            */}
            <div className="grid min-w-0 flex-1 gap-5 min-[1040px]:grid-cols-[calc(50%_-_138px)_minmax(0,1fr)] min-[1040px]:gap-8">
              {/*
                Both columns centre their own content, and the grid keeps its
                default `stretch` so the rule between them still runs the full
                height of the row.

                Grid items stretch, but text inside a stretched box starts at
                the top, so every pixel of the height difference between the
                two columns collected at the BOTTOM of the shorter one. That is
                what read as sparse: at 1440 a two-line rationale is 37px of
                text in a 121px box — 82px of void under it, none above.

                It redistributes the slack rather than removing it. What
                removes it is a shorter column, and there is nothing here to
                shorten: the two fields are capped independently
                (`FIELD_CAPS.summary` 500, `scoreRationale` 220), so their
                heights are free to differ by design.
              */}
              <div className="flex min-w-0 flex-col justify-center">
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
              <p className="flex min-w-0 flex-col justify-center border-t border-line pt-4 text-note leading-relaxed text-ink-soft min-[1040px]:border-t-0 min-[1040px]:border-l min-[1040px]:pt-0 min-[1040px]:pl-8">
                {/*
                  This wrapper is load-bearing, not tidying. A flex container
                  wraps each contiguous run of text in its own anonymous item,
                  so without it the label and the rationale become two separate
                  flex items and `flex-col` stacks them — "Why this score:" on
                  its own line above a paragraph it is meant to open. One
                  element holding both keeps them a single run of inline text
                  that wraps normally, and gives `justify-center` the one child
                  it needs to centre.
                */}
                <span>
                  <span className="font-medium text-ink">Why this score: </span>
                  {analysis.scoreRationale}
                </span>
              </p>
            </div>
          </div>
        </Card>
      </Reveal>
      )}

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
            {/*
              A CONTAINER query, not a breakpoint, and the numbers are why.

              This card sits in a grid that goes two-column at 900px, so its
              width does not track the viewport — it falls off a cliff there.
              Measured: at a 899px viewport the card has 811px of content, and
              at 900px it has 370px. A `md:` or `lg:` variant would put the
              side-by-side row at its widest just before the breakpoint and rip
              it away just after, which is the opposite of what those variants
              are for. `@container` asks the only question that matters here —
              is THIS CARD wide enough — and gets the same answer at every
              viewport that produces the same card.

              420px is the card's CONTENT width, which is what a container query
              measures — not its border-box. Worth stating because the two are
              50px apart here (24px padding a side, 1px border) and picking the
              threshold off the outer width silently costs you a breakpoint:
              at 460 the 1024px viewport stacked, because its 482px-wide card
              is only 432px inside.

              420 is where the button's 221px still leaves the filename ~190px,
              about twenty-four characters, with the full name on hover via
              `title`. Below it the button goes back to its own row at full
              width. Content widths that decides: 520 at 1440 and 432 at 1024
              go side by side; 370 at 900 and 300 at 390 stack.
            */}
            <Card className="@container">
              <div className="flex flex-col gap-5 @min-[420px]:flex-row @min-[420px]:items-end @min-[420px]:justify-between">
                {/*
                  `min-w-0` is load-bearing, not defensive. A flex item will not
                  shrink below its content by default, so without it the
                  filename's `truncate` never engages: a long name pushes the
                  row wider instead of ellipsing and shoves the button off the
                  card's edge.
                */}
                <div className="min-w-0">
                  <CardTitle>Your resume</CardTitle>
                  <p className="mt-2 truncate text-body font-medium text-ink" title={fileName}>
                    {fileName}
                  </p>
                  <p className="mt-1 text-note text-ink-soft">
                    {meta.wordCount.toLocaleString()} words
                    {meta.pageCount ? `, ${meta.pageCount} page${meta.pageCount === 1 ? "" : "s"}` : ""}
                    {meta.truncated ? " — the middle was omitted for length" : ""}
                  </p>
                </div>
                {/*
                  `shrink-0` so the button keeps its natural width and the
                  filename is what gives — the label is fixed, and truncating a
                  button's own words would be nonsense.

                  Upload, not ArrowLeft. The arrow read as "go back", which is
                  this app's `ArrowRight` reversed, and this button does not go
                  back: it starts a new analysis. It lands on the dropzone in
                  `/`, which marks itself with `UploadCloud` — so this is that
                  icon's plain sibling at inline size, pointing at the thing you
                  arrive on.
                */}
                <Button
                  asChild
                  variant="secondary"
                  className="w-full shrink-0 @min-[420px]:w-auto"
                >
                  <Link href="/">
                    <Upload className="size-4" aria-hidden="true" />
                    Analyse another resume
                  </Link>
                </Button>
              </div>
            </Card>
          </Reveal>

          <Reveal index={2}>
            <Card>
              {/*
                Renamed when degraded for the same reason the score card is
                gone: "Section breakdown" over six ungraded rows promises a
                verdict that is not there, and what these rows actually report
                is what was found in the file.
              */}
              <CardTitle>
                {meta.degraded ? "What we found" : "Section breakdown"}
              </CardTitle>
              <div className="mt-4">
                <SectionBreakdown
                  sections={analysis.sections}
                  degraded={meta.degraded}
                />
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
