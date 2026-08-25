import { Check, Minus, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { KeywordMatch } from "@/types";

interface KeywordMatchPanelProps {
  /** Null when no job description was supplied. */
  data: KeywordMatch | null;
  /**
   * The AI leg failed. `data` is null either way, but the reason differs and
   * so does the advice — sending someone off to paste a job description they
   * already pasted is work that cannot help them.
   */
  degraded?: boolean;
}

export function KeywordMatchPanel({
  data,
  degraded = false,
}: KeywordMatchPanelProps) {
  // No JD is a normal state, not a broken one.
  if (!data) {
    return (
      <div className="panel flex flex-col items-center gap-2 px-6 py-8 text-center">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-muted-tint text-ink-soft"
        >
          <Search className="size-4" strokeWidth={2.2} />
        </span>
        <p className="text-body text-ink-soft">
          {degraded
            ? "Keyword matching needs the AI review, and it did not run. Any job description you pasted was not compared."
            : "Paste a job description to see how well your resume matches it."}
        </p>
      </div>
    );
  }

  const total = data.matched.length + data.missing.length;

  /**
   * Every term covered — and there were terms to cover.
   *
   * Derived from the arrays rather than from `matchPercent === 100`, because
   * the percentage is the model's own rounding of the same two lengths and a
   * 99.6 would round to 100 while `missing` still held an entry. The copy
   * below says "every term", so it has to be true of the list, not of a
   * rounded number describing it.
   */
  const everyTermMatched = total > 0 && data.missing.length === 0;

  return (
    <div>
      {/* Missing second, deliberately: it is the actionable half, so it reads
          last and sits closest to the advice about what to do with it. These
          were one undivided list before, which grouped by tone only because
          the data happened to arrive that way — nothing enforced it. */}
      <div className="flex flex-col gap-4">
        {/* The empty message for one group only makes sense when the OTHER has
            something in it. A job description that yielded no keywords at all
            leaves both empty, and then "none of the terms appear" and "covers
            every term" would both render, contradicting each other about a set
            with nothing in it. Both fall back to rendering nothing. */}
        <Group
          label="In your resume"
          tone="matched"
          items={data.matched}
          empty={
            data.missing.length > 0
              ? "None of the role's terms appear in your resume yet."
              : undefined
          }
        />
        <Group
          label="Not found"
          tone="missing"
          items={data.missing}
          empty={
            data.matched.length > 0
              ? "Your resume covers every term in this job description."
              : undefined
          }
        />
      </div>

      <div className="mt-5">
        <Progress
          value={data.matchPercent}
          aria-label={`${data.matchPercent}% keyword match`}
          // The same green as the matched pills. The bar measures exactly what
          // those pills are, so a separate hue read as a second metric.
          //
          // Note this IS `--success`, the pass token, and a 40% match is not a
          // pass. The line under the count row is what carries that: colour
          // ties the bar to the pills, copy carries the judgement. If that line
          // ever goes, this should go back to neutral with it.
          indicatorClassName="bg-success"
        />
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-note text-ink-soft">
            Matched {data.matched.length}/{total} keywords
          </span>
          <span className="text-note font-semibold text-ink tabular-nums">
            {data.matchPercent}%
          </span>
        </div>
        {/* A bare percentage has no scale attached, so it reads as a grade. No
            figure is claimed here: this app documents what it has measured and
            it has never measured a typical match rate. Both clauses are true by
            construction instead, and the second names the cost of padding —
            the interview — rather than just forbidding it. */}
        <p className="mt-2 max-w-[66ch] text-caption text-ink-soft">
          {everyTermMatched ? (
            // Reworded rather than suppressed at 100%. The first clause becomes
            // false the moment the rare thing has happened, and the second
            // asks for terms that are not missing. What survives is the half
            // that matters MOST here: a full match is the likeliest result of
            // padding, so this is exactly where the interview test belongs.
            <>
              Make sure every term here is one you could discuss in an
              interview.
            </>
          ) : (
            // Kept in full at 0%. It reads as calibration rather than excuse —
            // "not the goal" is still true of a zero — and the anti-stuffing
            // half is at its most load-bearing when someone has matched nothing
            // and is most tempted to paste the job description wholesale.
            <>
              Few job descriptions list only things one person has done, so a
              full match is rare and not the goal. Add the missing terms that
              genuinely describe your experience — not ones you couldn&apos;t
              discuss in an interview.
            </>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * One labelled group of pills, or nothing at all.
 *
 * An empty group renders no label. "Not found" with nothing under it reads as
 * a rendering fault rather than as a perfect score, and "In your resume" over
 * an empty row is worse — it states something untrue.
 */
function Group({
  label,
  tone,
  items,
  empty,
}: {
  label: string;
  tone: "matched" | "missing";
  items: string[];
  /** Shown INSTEAD of the label and pills. Omit to render nothing at all. */
  empty?: string;
}) {
  if (items.length === 0) {
    // The label goes with the pills. A heading over one sentence of prose
    // reads as a group that failed to load rather than as a group that is
    // legitimately empty, which is what this sentence exists to say.
    return empty ? <p className="text-note text-ink-soft">{empty}</p> : null;
  }

  return (
    <div>
      <p className="mb-2 text-caption font-semibold tracking-wide text-ink-soft uppercase">
        {label}
      </p>
      <ul aria-label={label} className="flex flex-wrap gap-2">
        {items.map((keyword) => (
          <li key={`${tone}-${keyword}`}>
            <Chip tone={tone} label={keyword} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chip({ tone, label }: { tone: "matched" | "missing"; label: string }) {
  const Icon = tone === "matched" ? Check : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium",
        tone === "matched"
          ? "bg-success-tint text-success"
          : "bg-muted-tint text-ink-soft",
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={3} />
      {label}
    </span>
  );
}
