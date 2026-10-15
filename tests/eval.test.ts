/**
 * The eval set, run live: twelve resumes across four roles, each asserted
 * against the band it was written for, and each role's three asserted to rank
 * in the order they were written in.
 *
 * What it is for is a prompt or model change. Before this, "the scores spread
 * sensibly" was a judgement made by reading one backend trio, and that does
 * not survive an edit. The summary line at the foot of the report is the
 * number to compare between two runs.
 *
 * Spends real credits — 12 calls x EVAL_RUNS, default 3 — so it is excluded
 * from `pnpm test` like the other live suites. Run it explicitly:
 *
 *   pnpm test:eval
 */

import { readFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { beforeAll, describe, expect, it } from "vitest";

loadEnv({ path: ".env.local", quiet: true });

import { AppError } from "@/lib/errors";
import { normaliseText } from "@/lib/extract";
import { runDeterministicChecks, summariseChecksForModel } from "@/lib/scoring";
import { EVAL_CASES, EVAL_ROLES, TIERS, type EvalCase } from "./fixtures/eval/cases";

const OUT = "eval-report.txt";

/**
 * Three by default, and the bands are asserted on the MEAN of the three.
 *
 * One run was the default and it could not be trusted to go green: on
 * byte-identical text the model's `ats` dimension swung 55-95, which moves an
 * overall score ~4 points, and four of twelve cases sit within that of an
 * edge. A single run therefore failed on noise. `EVAL_RUNS=1` is still there
 * for a cheap look; it is not a verdict.
 */
const RUNS = Number(process.env.EVAL_RUNS ?? 3);

/**
 * `EVAL_ONLY=design/strong` scores only the named cases (comma-separated): one
 * call instead of twelve when the question is about a single fixture. A role
 * is ranked only when all three of its tiers are in the run.
 */
const ONLY = (process.env.EVAL_ONLY ?? "").split(",").map((id) => id.trim()).filter(Boolean);
const CASES = ONLY.length > 0 ? EVAL_CASES.filter(({ id }) => ONLY.includes(id)) : EVAL_CASES;
const ROLES = EVAL_ROLES.filter(({ role }) =>
  TIERS.every((tier) => CASES.some(({ id }) => id === `${role}/${tier}`)),
);

interface CaseResult {
  scores: number[];
  failures: string[];
}

const results = new Map<string, CaseResult>(
  CASES.map((c) => [c.id, { scores: [], failures: [] }]),
);

/** Buffered and written once, for the EBUSY reason `quality-spread` gives. */
const lines: string[] = [];
const say = (line = "") => lines.push(line);

const mean = (values: number[]) =>
  values.reduce((total, value) => total + value, 0) / values.length;

function meanOf(id: string): number | null {
  const { scores } = results.get(id)!;
  return scores.length > 0 ? mean(scores) : null;
}

function inBand({ id, min, max }: EvalCase): boolean {
  const value = meanOf(id);
  return value !== null && value >= min && value <= max;
}

function ranked(role: string): boolean {
  const [strong, middling, weak] = TIERS.map((tier) => meanOf(`${role}/${tier}`));
  return (
    strong != null && middling != null && weak != null &&
    strong > middling && middling > weak
  );
}

async function measure(): Promise<void> {
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

  // Same preparation a real upload gets, minus PDF parsing: the deterministic
  // facts are injected into the prompt, so skipping them would score these
  // resumes on a different input than production sees.
  const inputs = new Map(
    CASES.map((c) => {
      const text = normaliseText(readFileSync(c.file, "utf8"));
      const facts = summariseChecksForModel(runDeterministicChecks(text, null));
      return [c.id, { text, facts }];
    }),
  );

  say(`provider : ${env.AI_PROVIDER}`);
  say(`model    : ${env.AI_MODEL}`);
  say(`runs     : ${RUNS} per case`);
  say(`started  : ${new Date().toISOString()}`);
  say();

  // Round-major, for the reason `quality-spread` gives: an endpoint that
  // starts struggling costs one round across every case, not every run of
  // whichever role happened to be last.
  for (let round = 1; round <= RUNS; round += 1) {
    for (const c of CASES) {
      const { text, facts } = inputs.get(c.id)!;
      const result = results.get(c.id)!;
      /*
        One retry, for transport failures only. The hosted endpoint drops
        roughly one call in twenty-five with AI_UNAVAILABLE and no response at
        all — measured three times in fifty calls — which at 36 calls a run
        failed the suite on infrastructure about as often as it passed. That
        is no measurement of the prompt. AI_SCHEMA is NOT retried: the model
        failing validation twice IS a measurement, and retrying it away would
        hide exactly what this suite exists to catch. Each dropped call is
        still printed, so the endpoint's flakiness stays visible.
      */
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const outcome = await analyzeResumeWithDiagnostics({
            resumeText: text,
            jobDescription: c.jd,
            truncated: false,
            facts,
          });
          const dims = outcome.diagnostics.dimensions;
          result.scores.push(outcome.result.overallScore);
          say(
            `[${c.id} round ${round}] score=${outcome.result.overallScore} ` +
              `${outcome.diagnostics.elapsedMs}ms ` +
              `dims: ${dims ? Object.entries(dims).map(([k, v]) => `${k}=${v}`).join(" ") : "none"}`,
          );
          break;
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          const transient =
            cause instanceof AppError &&
            (cause.code === "AI_UNAVAILABLE" || cause.code === "AI_RATE_LIMITED");
          if (transient && attempt === 1) {
            say(`[${c.id} round ${round}] dropped, retrying: ${message}`);
            continue;
          }
          result.failures.push(`round ${round}: ${message}`);
          say(`[${c.id} round ${round}] FAILED: ${message}`);
          break;
        }
      }
    }
  }

  say();
  say(`${"case".padEnd(17)} | ${"band".padEnd(6)} | ${"scores".padEnd(14)} | mean  |`);
  say("-".repeat(52));
  for (const c of CASES) {
    const { scores } = results.get(c.id)!;
    const value = meanOf(c.id);
    say(
      `${c.id.padEnd(17)} | ${`${c.min}-${c.max}`.padEnd(6)} | ` +
        `${(scores.join(" ") || "-").padEnd(14)} | ` +
        `${(value === null ? "-" : value.toFixed(1)).padStart(5)} | ` +
        `${inBand(c) ? "IN" : "OUT"}`,
    );
  }

  say();
  for (const { role } of ROLES) {
    say(`  ${role.padEnd(8)} strong > middling > weak: ${ranked(role) ? "yes" : "NO"}`);
  }

  say();
  say(
    `in band ${CASES.filter(inBand).length}/${CASES.length}` +
      ` | roles ranked ${ROLES.filter(({ role }) => ranked(role)).length}/${ROLES.length}` +
      "   <- compare this line between runs",
  );
  say(`finished : ${new Date().toISOString()}`);
}

beforeAll(async () => {
  try {
    await measure();
  } finally {
    // The calls are paid for by the time anything can throw; keep the report.
    const report = `${lines.join("\n")}\n`;
    writeFileSync(OUT, report);
    console.log(report);
  }
}, 3_000_000);

describe("eval set", () => {
  it("produced a live score for every case", () => {
    for (const c of CASES) {
      const { scores, failures } = results.get(c.id)!;
      expect(failures, `${c.id} had failed calls`).toEqual([]);
      expect(scores, `${c.id} produced no scores`).toHaveLength(RUNS);
    }
  });

  it.each(CASES)("$id scores inside its band ($min to $max)", (c) => {
    const value = meanOf(c.id);
    expect(value, `${c.id}: no data`).not.toBeNull();
    expect(value!).toBeGreaterThanOrEqual(c.min);
    expect(value!).toBeLessThanOrEqual(c.max);
  });

  it.each(ROLES.map(({ role }) => role))(
    "%s ranks strong above middling above weak",
    (role) => {
      const means = TIERS.map((tier) => meanOf(`${role}/${tier}`));
      expect(ranked(role), `${role} means: ${means.join(" / ")}`).toBe(true);
    },
  );
});
