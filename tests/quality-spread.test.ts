/**
 * Phase 3 acceptance, the part that was never actually measured: does the
 * score spread across resumes of different quality?
 *
 * Every earlier live check reused a single fixture, which can only ever show
 * that a score comes back — not that it means anything. A scorer that returns
 * 78 for everything passes those checks perfectly and is worthless.
 *
 * So: three resumes for the same role, differing only in quality, three runs
 * each. Role, target seniority, and the job description are held constant so
 * the only variable left is how well the resume is written. The table this
 * prints is the evidence; the three assertions below are the acceptance
 * criterion, one per question worth asking:
 *
 *   1. Do the three score ranges separate without overlapping?
 *   2. Does each mean land in the band the fixture was written for?
 *   3. Is the run-to-run noise on one resume smaller than the distance
 *      between two resumes? If it is not, the number is measuring sampling
 *      variance rather than quality, and no amount of band-tuning fixes that.
 *
 * This spends real credits — nine calls — so it is excluded from `pnpm test`
 * the same way `tests/live-verify.test.ts` is. Run it explicitly:
 *
 *   pnpm test:quality
 */

import { readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

loadEnv({ path: ".env.local", quiet: true });

import { MIN_TEXT_CHARS, normaliseText } from "@/lib/extract";
import {
  runDeterministicChecks,
  statusFor,
  summariseChecksForModel,
} from "@/lib/scoring";
import type { AnalyzeOutcome } from "@/lib/ai/analyze";
import { FIELD_CAPS } from "@/lib/schema/analysis";
import { leakedHeadlines, restatementOverlap } from "./helpers";

const OUT = "quality-report.txt";

/**
 * Buffered, then written once.
 *
 * Appending line by line means reopening the file a few hundred times, and on
 * Windows that loses a race with the filesystem scanner often enough to fail
 * the run with EBUSY — after the API calls have already been paid for. The
 * flush happens in a `finally`, so a crash mid-run still leaves the partial
 * report on disk.
 */
const lines: string[] = [];
const say = (line = "") => lines.push(line);

function flush(): void {
  const report = `${lines.join("\n")}\n`;
  writeFileSync(OUT, report);
  // Also to stdout, so the answer is visible without opening the file.
  console.log(report);
}

/** Overridable so a cheap smoke run is possible without editing the file. */
const RUNS = Number(process.env.QUALITY_RUNS ?? 3);

/**
 * One job description for all three, deliberately.
 *
 * With no JD the rubric judges relevance "against the role the resume is
 * clearly aiming at" — which is inferred from the resume, so a vague resume
 * gets a vague target and grades itself on a curve. Fixing the JD makes the
 * relevance dimension mean the same thing for all three fixtures, which is the
 * whole point of using one role.
 */
const JOB_DESCRIPTION =
  "Mid-level Backend Engineer. You will own services in our payments and " +
  "logistics platform, from API design through production operation. " +
  "Required: 3+ years backend engineering, Python or Go, PostgreSQL, REST API " +
  "design, AWS. Preferred: Kafka or similar streaming, Kubernetes, Terraform, " +
  "CI/CD pipelines, distributed tracing.";

/**
 * The bands each fixture was written to land in, from the acceptance
 * criterion. These are asserted, not merely reported — a fixture that drifts
 * out of its band means either the resume or the rubric changed, and both are
 * worth failing over.
 */
const FIXTURES = [
  { name: "strong", min: 80, max: 100 },
  { name: "middling", min: 55, max: 70 },
  { name: "weak", min: 0, max: 44 },
] as const;

type FixtureName = (typeof FIXTURES)[number]["name"];

interface RunRecord {
  score: number;
  elapsedMs: number;
  attempts: number;
  verdict: string;
  rationale: string;
  sections: Record<string, number>;
  /**
   * The six rubric scores the overall score was computed from. Without these a
   * surprising total cannot be explained — which is the whole reason the score
   * stopped being a single number the model chose.
   */
  dimensions: Record<string, number> | null;
  /**
   * Feedback statuses, counted. Two assertions read this: strong.txt must
   * contain at least one "pass", and no run's feedback may be dominated by a
   * status harsher than the band its own score falls in. The raw counts are
   * printed as well, because item count and uniformity moved together and that
   * is worth watching even where nothing fails on it.
   */
  statuses: Record<string, number>;
  /**
   * The items themselves, both fields.
   *
   * Headlines are kept so the offending strings can be named in a failure
   * rather than merely counted — a rubric heading and a schema key have
   * different causes, and a bare count cannot tell them apart. Details are kept
   * because the run that would have answered whether a detail restates its own
   * headline recorded statuses only, and twenty-eight paid calls turned out to
   * hold no evidence on the question actually being asked.
   */
  feedbackItems: { text: string; detail: string }[];
  matchPercent: number | null;
}

interface FixtureResult {
  name: FixtureName;
  wordCount: number;
  facts: string;
  text: string;
  runs: RunRecord[];
  failures: string[];
}

const results = new Map<FixtureName, FixtureResult>();

/**
 * Severity, mildest first. The only ordering this file needs: "harsher than"
 * is a comparison of positions in this list.
 */
const SEVERITY = ["pass", "warn", "fail"] as const;
type Severity = (typeof SEVERITY)[number];

const rankOf = (status: string): number => SEVERITY.indexOf(status as Severity);

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function scoresFor(name: FixtureName): number[] {
  return results.get(name)!.runs.map((run) => run.score);
}

/**
 * The same thing, for anything that then does arithmetic on it.
 *
 * Statistics on an empty array are not merely wrong, they are quietly wrong.
 * `mean([])` is NaN, which at least announces itself. `Math.min(...[])` is
 * `Infinity` and `Math.max(...[])` is `-Infinity`, which does not: with weak
 * producing no scores, the overlap assertion below evaluated
 * `Math.min(...middling) > Math.max(...weak)` as `62 > -Infinity` and REPORTED
 * GREEN while measuring nothing at all. A suite that costs nine paid calls and
 * can pass on zero data is worse than no suite, because it is trusted.
 *
 * So every assertion that derives a number goes through here first, and "no
 * data" fails as itself rather than as NaN or as a pass.
 */
function requireScores(name: FixtureName): number[] {
  const scores = scoresFor(name);
  if (scores.length === 0) {
    expect.fail(
      `${name}: no data — all ${RUNS} calls failed, so this cannot be ` +
        "evaluated. Their failure reasons are in the report above.",
    );
  }
  return scores;
}

function pad(text: string | number, width: number, left = false): string {
  const value = String(text);
  return left ? value.padEnd(width) : value.padStart(width);
}

async function measure(): Promise<void> {
  // Re-read .env.local through the real validator rather than trusting
  // whatever a previously imported module cached.
  const { resetEnv, getEnv, isAiConfigured } = await import("@/lib/env");
  const { resetProvider } = await import("@/lib/ai/providers");
  resetEnv();
  resetProvider();

  const env = getEnv();
  if (!isAiConfigured()) {
    throw new Error(
      `No API key for AI_PROVIDER="${env.AI_PROVIDER}". This suite measures ` +
        "the live model; there is nothing to measure without one.",
    );
  }

  const { analyzeResumeWithDiagnostics } = await import("@/lib/ai/analyze");

  // Fixtures are plain text, so they skip PDF/DOCX extraction — but they still
  // go through the same normalisation and the same deterministic checks a real
  // upload does, because those counts are injected into the prompt and would
  // otherwise differ from production for reasons unrelated to quality.
  for (const { name } of FIXTURES) {
    const text = normaliseText(
      readFileSync(`tests/fixtures/quality/${name}.txt`, "utf8"),
    );
    if (text.length < MIN_TEXT_CHARS) {
      throw new Error(`Fixture ${name}.txt is below MIN_TEXT_CHARS.`);
    }
    // pageCount is null for all three, exactly as it is for a DOCX upload. A
    // per-fixture page count would leak into the formatting sub-score.
    const checks = runDeterministicChecks(text, null);
    results.set(name, {
      name,
      text,
      wordCount: checks.wordCount,
      facts: summariseChecksForModel(checks),
      runs: [],
      failures: [],
    });
  }

  say(`provider : ${env.AI_PROVIDER}`);
  say(`model    : ${env.AI_MODEL}`);
  say(`temp     : ${env.AI_TEMPERATURE}`);
  say(`runs     : ${RUNS} per fixture`);
  say(`started  : ${new Date().toISOString()}`);

  for (const { name } of FIXTURES) {
    const fixture = results.get(name)!;
    say(`\n--- ${name}.txt deterministic facts (${fixture.wordCount} words) ---`);
    say(fixture.facts);
  }

  /**
   * Round-major, not fixture-major.
   *
   * If the endpoint degrades or rate-limits partway through, this loses a
   * round across all three fixtures rather than every run of whichever fixture
   * happened to be last — a partial result stays comparable instead of
   * becoming a comparison between a fresh endpoint and a struggling one.
   */
  for (let round = 1; round <= RUNS; round += 1) {
    for (const { name } of FIXTURES) {
      const fixture = results.get(name)!;

      let outcome: AnalyzeOutcome;
      try {
        outcome = await analyzeResumeWithDiagnostics({
          resumeText: fixture.text,
          jobDescription: JOB_DESCRIPTION,
          truncated: false,
          facts: fixture.facts,
        });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        fixture.failures.push(`round ${round}: ${message}`);
        say(`\n[${name} round ${round}] FAILED: ${message}`);
        continue;
      }

      const { result, diagnostics } = outcome;
      fixture.runs.push({
        score: result.overallScore,
        elapsedMs: diagnostics.elapsedMs,
        attempts: diagnostics.attempts,
        verdict: result.verdict,
        rationale: result.scoreRationale,
        sections: Object.fromEntries(
          result.sections.map((section) => [section.name, section.score]),
        ),
        dimensions: diagnostics.dimensions,
        statuses: result.feedback.reduce<Record<string, number>>(
          (counts, item) => ({
            ...counts,
            [item.status]: (counts[item.status] ?? 0) + 1,
          }),
          {},
        ),
        feedbackItems: result.feedback.map((item) => ({
          text: item.text,
          detail: item.detail,
        })),
        matchPercent: result.keywordMatch?.matchPercent ?? null,
      });

      say(
        `\n[${name} round ${round}] score=${result.overallScore} ` +
          `verdict=${result.verdict} ${diagnostics.elapsedMs}ms ` +
          `attempts=${diagnostics.attempts} ` +
          `keywords=${result.keywordMatch?.matchPercent ?? "n/a"}%`,
      );
      say(`  rationale: ${result.scoreRationale}`);
      say(
        `  dimensions: ${
          diagnostics.dimensions
            ? Object.entries(diagnostics.dimensions)
                .map(([name, score]) => `${name}=${score}`)
                .join(" ")
            : "none"
        }`,
      );
      say(
        `  sections : ${result.sections.map((s) => `${s.name}=${s.score}`).join(" ")}`,
      );
      say(
        `  feedback : ${result.feedback.map((f) => f.status).join(" ")}`,
      );
      const leaked = leakedHeadlines(result.feedback.map((f) => f.text));
      say(
        `  headlines: ${result.feedback.length} items, ${leaked.length} leaked${
          leaked.length > 0
            ? ` -> ${leaked.map((t) => JSON.stringify(t)).join(", ")}`
            : ""
        }`,
      );
    }
  }

  /* ----------------------------------------------------------- the table -- */

  const header = `${pad("fixture", 9, true)} | ${Array.from(
    { length: RUNS },
    (_, index) => pad(`run ${index + 1}`, 5),
  ).join(" | ")} | ${pad("mean", 6)} | ${pad("spread", 6)}`;

  say(`\n${"=".repeat(header.length)}`);
  say(header);
  say("-".repeat(header.length));

  for (const { name } of FIXTURES) {
    const scores = scoresFor(name);
    const cells = Array.from({ length: RUNS }, (_, index) =>
      pad(scores[index] ?? "-", 5),
    ).join(" | ");
    say(
      `${pad(name, 9, true)} | ${cells} | ` +
        `${pad(scores.length ? mean(scores).toFixed(1) : "-", 6)} | ` +
        `${pad(scores.length ? spread(scores) : "-", 6)}`,
    );
  }
  say("=".repeat(header.length));

  /*
    Printed, not asserted. Uniformity is evidence that one grade was stamped
    across every finding rather than proof of it — statuses alone cannot
    separate an honestly uniform review of a uniformly mediocre resume from a
    lazy one, and the assertion that tried to failed the honest case. The item
    count sits beside it because the two moved together: the only two uniform
    runs in the measurement that prompted this were the two that filled the
    array to its maximum.
  */
  say("\nfeedback distribution (items, pass/warn/fail):");
  for (const { name } of FIXTURES) {
    const cells = results.get(name)!.runs.map((run) => {
      const counts = SEVERITY.map((status) => run.statuses[status] ?? 0);
      const items = counts.reduce((total, value) => total + value, 0);
      return `${items} items ${counts[0]}p/${counts[1]}w/${counts[2]}f`;
    });
    say(`  ${pad(name, 9, true)} ${cells.join("  |  ") || "-"}`);
  }

  /*
    The rate, so a change to the prompt can be judged against a number rather
    than against one clean run. 26c7f3b is the reason this is here: a prompt
    hypothesis formed on n=2 was reverted three runs later, having moved
    nothing. Reported per item AND per run, because the two say different
    things — six leaked headlines in one run of eight is a different failure
    from one leaked headline in each of six runs.
  */
  say();
  say("headline leakage (category names in feedback[].text):");
  let leakedItems = 0;
  let totalItems = 0;
  let leakedRuns = 0;
  let totalRuns = 0;
  for (const { name } of FIXTURES) {
    const runs = results.get(name)!.runs;
    const headlines = runs.map((run) => run.feedbackItems.map((i) => i.text));
    const items = headlines.reduce((sum, texts) => sum + texts.length, 0);
    const leaked = headlines.reduce(
      (sum, texts) => sum + leakedHeadlines(texts).length,
      0,
    );
    const hit = headlines.filter((texts) => leakedHeadlines(texts).length > 0)
      .length;
    leakedItems += leaked;
    totalItems += items;
    leakedRuns += hit;
    totalRuns += runs.length;
    say(
      `  ${pad(name, 9, true)} ${leaked}/${items} items` +
        `${items ? ` (${((leaked / items) * 100).toFixed(1)}%)` : ""}` +
        `, ${hit}/${runs.length} runs affected`,
    );
  }
  say(
    `  ${pad("TOTAL", 9, true)} ${leakedItems}/${totalItems} items` +
      `${totalItems ? ` (${((leakedItems / totalItems) * 100).toFixed(1)}%)` : ""}` +
      `, ${leakedRuns}/${totalRuns} runs affected`,
  );


  /*
    Headline length, against the cap and against the layout.

    The list's design was built around headlines of 34-59 characters
    (PLACEHOLDER_ANALYSIS averages 45.7). A live run measured 79.4 with two of
    five items at the cap and one cut mid-word by the decoder — long enough to
    wrap into a block that reads as a headline followed by a detail, which is
    the bug this block exists to make visible. Printed, not asserted: a long
    headline is a layout problem, not a wrong answer, and the component clamps
    it now regardless.
  */
  say();
  say(`headline length (cap ${FIELD_CAPS.feedbackText}, layout was built for ~46):`);
  for (const { name } of FIXTURES) {
    const texts = results.get(name)!.runs.flatMap((run) =>
      run.feedbackItems.map((item) => item.text),
    );
    if (texts.length === 0) {
      say(`  ${pad(name, 9, true)} -`);
      continue;
    }
    const lengths = texts.map((text) => text.length);
    const atCap = lengths.filter(
      (length) => length >= FIELD_CAPS.feedbackText - 5,
    ).length;
    const cut = texts.filter((text) => text.endsWith("…")).length;
    say(
      `  ${pad(name, 9, true)} mean ${mean(lengths).toFixed(1)}` +
        `, max ${Math.max(...lengths)}` +
        ` | at/near cap ${atCap}/${texts.length}` +
        ` | decoder-cut ${cut}/${texts.length}`,
    );
  }

  /*
    And whether the detail simply says the headline again, which is the other
    half of the same report: an expanded row that adds nothing.
  */
  say();
  say("detail restating its headline (>=60% content-word overlap):");
  let restatingTotal = 0;
  let restatingItems = 0;
  for (const { name } of FIXTURES) {
    const items = results.get(name)!.runs.flatMap((run) => run.feedbackItems);
    const restating = items.filter(
      (item) => restatementOverlap(item.text, item.detail) >= 0.6,
    );
    restatingTotal += restating.length;
    restatingItems += items.length;
    // Three examples, trimmed. The full list ran to twenty-three headlines on
    // one fixture and buried the number it was printed to support.
    const examples = restating
      .slice(0, 3)
      .map((item) => JSON.stringify(item.text.slice(0, 55)));
    say(
      `  ${pad(name, 9, true)} ${restating.length}/${items.length}` +
        `${items.length ? ` (${((restating.length / items.length) * 100).toFixed(1)}%)` : ""}` +
        (examples.length > 0
          ? ` -> ${examples.join(", ")}${restating.length > 3 ? ` +${restating.length - 3} more` : ""}`
          : ""),
    );
  }
  say(
    `  ${pad("TOTAL", 9, true)} ${restatingTotal}/${restatingItems}` +
      `${restatingItems ? ` (${((restatingTotal / restatingItems) * 100).toFixed(1)}%)` : ""}` +
      "   <- compare this line between runs",
  );
  /* ------------------------------------------------------- the questions -- */

  const complete = FIXTURES.every(({ name }) => scoresFor(name).length > 0);
  if (!complete) {
    say("\nIncomplete run - some fixture produced no usable score.");
    return;
  }

  const means = FIXTURES.map(({ name }) => mean(scoresFor(name)));
  const gaps = [means[0]! - means[1]!, means[1]! - means[2]!];
  const worstSpread = Math.max(
    ...FIXTURES.map(({ name }) => spread(scoresFor(name))),
  );

  say("\nQ1 no overlap between ranges:");
  for (const { name } of FIXTURES) {
    const scores = scoresFor(name);
    say(
      `  ${pad(name, 9, true)} range ${Math.min(...scores)}-${Math.max(...scores)}`,
    );
  }

  say("\nQ2 mean inside expected band:");
  for (const [index, { name, min, max }] of FIXTURES.entries()) {
    const value = means[index]!;
    const inside = value >= min && value <= max;
    say(
      `  ${pad(name, 9, true)} mean ${value.toFixed(1)} vs ${min}-${max} ` +
        `${inside ? "IN" : "OUT"}`,
    );
  }

  say("\nQ3 noise vs signal:");
  say(`  widest within-fixture spread : ${worstSpread}`);
  say(`  strong->middling gap         : ${gaps[0]!.toFixed(1)}`);
  say(`  middling->weak gap           : ${gaps[1]!.toFixed(1)}`);
  say(
    `  verdict: ${worstSpread < Math.min(...gaps) ? "signal exceeds noise" : "NOISE SWAMPS SIGNAL"}`,
  );

  say(`\nfinished : ${new Date().toISOString()}`);
}

beforeAll(async () => {
  try {
    await measure();
  } finally {
    // Nine paid calls have already happened by the time anything can throw.
    // The report is the product of this suite; losing it to a late failure
    // would mean paying for the measurement twice.
    flush();
  }
}, 1_800_000);

describe("score spread across resume quality", () => {
  it("produced a live score for every run", () => {
    for (const { name } of FIXTURES) {
      const fixture = results.get(name)!;
      expect(fixture.failures, `${name} had failed calls`).toEqual([]);
      expect(fixture.runs, `${name} produced no runs`).toHaveLength(RUNS);
    }
  });

  // Q2. Checked before the overlap assertion because a mean outside its band
  // explains an overlap, whereas an overlap says nothing about which fixture
  // moved.
  it.each(FIXTURES)(
    "$name scores inside its expected band ($min to $max)",
    ({ name, min, max }) => {
      const average = mean(requireScores(name));
      expect(average).toBeGreaterThanOrEqual(min);
      expect(average).toBeLessThanOrEqual(max);
    },
  );

  /**
   * A real run returned five feedback items, all "fail". The rule that should
   * prevent that is in the system prompt and in the feedback array's schema
   * description, and offline tests pin both -- but only a live call shows
   * whether the model acts on them. strong.txt is quantified throughout, so a
   * review of it with no "pass" item is the model ignoring the rule rather than
   * an honest reading of a weak resume.
   */
  it("finds at least one genuine strength in strong.txt", () => {
    for (const run of results.get("strong")!.runs) {
      expect(run.statuses.pass ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  /**
   * The check that was missing when the headline leak shipped.
   *
   * See `FORBIDDEN_HEADLINES` above for what it catches and why nothing else
   * could. Asserted per run rather than against the aggregate rate: one leaked
   * headline is a visibly broken item on somebody's report, and a percentage
   * averaged over fifteen runs is exactly the shape that hides it.
   */
  it("feedback headlines are findings, not category names", () => {
    for (const { name } of FIXTURES) {
      for (const [index, run] of results.get(name)!.runs.entries()) {
        const texts = run.feedbackItems.map((item) => item.text);
        const leaked = leakedHeadlines(texts);
        expect(
          leaked,
          `${name} round ${index + 1}: ${leaked.length} of ` +
            `${texts.length} headlines name a category instead of ` +
            `stating a finding: ${leaked.map((t) => JSON.stringify(t)).join(", ")}`,
        ).toEqual([]);
      }
    }
  });

  /**
   * This replaced an assertion that every run must use more than one status.
   *
   * That bar was wrong in both directions. It failed a legitimate output:
   * RULE 4 tells the model that "warn" is the ordinary case and that most
   * findings on most resumes are warns, so a middling resume whose findings
   * are all warns is the model doing exactly as it was told — eight warns
   * under a score of 62 has the gauge and the list saying the same thing. And
   * it passed an illegitimate one, because "more than one distinct status" is
   * satisfied by a single dissenting item: seven fails and one pass under a 62
   * would have gone green.
   *
   * Neither is what actually went wrong. That was eight items marked "fail"
   * under a score of 60 and a verdict of "good" — the list handing down a
   * second, harsher grade than the number it sits beneath, which is the
   * pathology STATUS_MEANING was written for.
   *
   * So the bar is coherence rather than variety, and it reads its boundaries
   * from `statusFor` instead of restating them. A weak resume may honestly be
   * all fails; a middling one may not.
   */
  it("feedback is no harsher than the score it accompanies", () => {
    for (const { name } of FIXTURES) {
      for (const run of results.get(name)!.runs) {
        const band = statusFor(run.score);
        const total = Object.values(run.statuses).reduce(
          (sum, count) => sum + count,
          0,
        );
        const harsher = SEVERITY.filter(
          (status) => rankOf(status) > rankOf(band),
        ).reduce((sum, status) => sum + (run.statuses[status] ?? 0), 0);

        // "Dominated" is a strict majority, so an even split is allowed: a
        // strong resume with four warns among eight items is making a point,
        // not overruling its own score.
        //
        // Compared against the half rather than by doubling `harsher`. The
        // predicate is identical, but the doubled form reported "expected 16 to
        // be less than or equal to 8" for a run of eight — a number that
        // appears nowhere in the data, which reads like an accumulator that
        // forgot to reset and sent a reader looking for a bug that was not
        // there. A failure message is evidence too, and it has to be about the
        // quantities being judged.
        expect(
          harsher,
          `${name} scored ${run.score} (${band} band) but ${harsher} of ` +
            `${total} findings are harsher than that band`,
        ).toBeLessThanOrEqual(Math.floor(total / 2));
      }
    }
  });

  // Q1. The strict form: not just separated means, but non-overlapping
  // observed ranges. Means can separate while individual runs interleave, and
  // interleaved runs mean a single analysis cannot be trusted to rank two
  // resumes correctly — which is what the product actually claims to do.
  it("ranges do not overlap between adjacent quality tiers", () => {
    const [strong, middling, weak] = FIXTURES.map(({ name }) =>
      requireScores(name),
    );

    expect(Math.min(...strong!)).toBeGreaterThan(Math.max(...middling!));
    expect(Math.min(...middling!)).toBeGreaterThan(Math.max(...weak!));
  });

  // Q3. The one that decides whether the score measures anything at all.
  it("within-fixture noise is smaller than every between-fixture gap", () => {
    const means = FIXTURES.map(({ name }) => mean(requireScores(name)));
    const gaps = [means[0]! - means[1]!, means[1]! - means[2]!];
    const worstSpread = Math.max(
      ...FIXTURES.map(({ name }) => spread(requireScores(name))),
    );

    expect(worstSpread).toBeLessThan(Math.min(...gaps));
  });
});
