import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { normaliseText } from "@/lib/extract";
import { MIN_TEXT_CHARS } from "@/lib/limits";
import { buildDegradedResult, runDeterministicChecks } from "@/lib/scoring";
import { EVAL_CASES, EVAL_ROLES } from "./fixtures/eval/cases";

/**
 * The offline half of the eval set: the fixtures the live suite pays to score
 * are checked here for free, so a broken one fails `pnpm test` rather than a
 * twelve-call run.
 */

const read = (file: string) => normaliseText(readFileSync(file, "utf8"));

const structuralScore = (role: string, tier: string) => {
  const c = EVAL_CASES.find(({ id }) => id === `${role}/${tier}`)!;
  return buildDegradedResult(runDeterministicChecks(read(c.file), null)).overallScore;
};

describe("eval set fixtures", () => {
  it("covers every role at every tier", () => {
    expect(EVAL_CASES).toHaveLength(EVAL_ROLES.length * 3);
  });

  it.each(EVAL_CASES)("$id is long enough to analyse", ({ file }) => {
    expect(read(file).length).toBeGreaterThanOrEqual(MIN_TEXT_CHARS);
  });

  // The structural checks cannot judge writing, but they do catch two
  // fixtures swapped or one gutted: a strong resume that loses to its weak
  // sibling on contact details, headings and bullets alone is not strong.
  it.each(EVAL_ROLES.map(({ role }) => role))(
    "%s strong outscores weak on structure alone",
    (role) => {
      expect(structuralScore(role, "strong")).toBeGreaterThan(
        structuralScore(role, "weak"),
      );
    },
  );
});
