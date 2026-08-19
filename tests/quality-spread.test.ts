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
import { runDeterministicChecks, summariseChecksForModel } from "@/lib/scoring";
import type { AnalyzeOutcome } from "@/lib/ai/analyze";

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
   * Feedback statuses, counted. A run once came back with every item marked
   * "fail"; the model is told that a resume with a genuine strength must get at
   * least one "pass", and strong.txt is the fixture where that rule has no
   * excuse not to fire.
   */
  statuses: Record<string, number>;
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

  it("does not mark every item the same status", () => {
    for (const { name } of FIXTURES) {
      for (const run of results.get(name)!.runs) {
        const distinct = Object.keys(run.statuses).length;
        expect(distinct, `${name} returned a single status for every item`)
          .toBeGreaterThan(1);
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
