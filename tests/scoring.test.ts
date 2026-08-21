import { describe, expect, it } from "vitest";

import { AnalysisResultSchema } from "@/lib/schema/analysis";
import {
  buildDegradedResult,
  runDeterministicChecks,
  summariseChecksForModel,
  type DeterministicChecks,
} from "@/lib/scoring";
import { RESUME_LINES } from "./fixtures/build-fixtures";

const RESUME = RESUME_LINES.join("\n");

describe("runDeterministicChecks", () => {
  const checks = runDeterministicChecks(RESUME, 2);

  it("finds the contact details", () => {
    expect(checks.hasEmail).toBe(true);
    expect(checks.hasPhone).toBe(true);
    expect(checks.hasLink).toBe(true);
  });

  it("counts bullet lines", () => {
    expect(checks.bulletCount).toBe(5);
  });

  it("recognises every section heading", () => {
    expect(checks.sectionsPresent).toEqual({
      summary: true,
      experience: true,
      education: true,
      skills: true,
    });
  });

  it("counts words and carries the page count through", () => {
    expect(checks.wordCount).toBeGreaterThan(50);
    expect(checks.pageCount).toBe(2);
  });

  it("detects passive-voice constructions", () => {
    // "Responsible for" is not passive; "was reduced" is.
    expect(runDeterministicChecks("Latency was reduced by the team.", null).passiveVoiceCount).toBe(1);
    expect(runDeterministicChecks("Cut latency by 80%.", null).passiveVoiceCount).toBe(0);
  });

  it("reports missing sections rather than guessing", () => {
    const sparse = runDeterministicChecks("Muhammad Nabil\nSome prose about work.", null);
    expect(sparse.sectionsPresent.education).toBe(false);
    expect(sparse.hasEmail).toBe(false);
  });

  it("accepts a DOCX with no page count", () => {
    expect(runDeterministicChecks(RESUME, null).pageCount).toBeNull();
  });
});

describe("summariseChecksForModel", () => {
  it("states the measured counts as facts for the prompt", () => {
    const summary = summariseChecksForModel(runDeterministicChecks(RESUME, 2));

    expect(summary).toContain("bullet lines: 5");
    expect(summary).toContain("pages: 2");
    expect(summary).toContain("all expected section headings found");
  });

  it("omits the page count for a DOCX rather than inventing one", () => {
    const summary = summariseChecksForModel(runDeterministicChecks(RESUME, null));
    expect(summary).not.toContain("pages:");
  });
});

describe("buildDegradedResult", () => {
  /** Corners chosen to exercise every branch in the feedback builder. */
  const cases: Array<[string, DeterministicChecks]> = [
    ["a complete resume", runDeterministicChecks(RESUME, 2)],
    ["a DOCX with no page count", runDeterministicChecks(RESUME, null)],
    ["a resume missing everything", runDeterministicChecks("nothing useful here at all", null)],
    [
      "extreme counts",
      {
        wordCount: 12_000,
        pageCount: 9,
        bulletCount: 0,
        passiveVoiceCount: 400,
        hasEmail: false,
        hasPhone: false,
        hasLink: false,
        sectionsPresent: { summary: false, experience: false, education: false, skills: false },
      },
    ],
  ];

  // The invariant that matters: the degraded path is the fallback for every
  // AI failure, so if it could emit an invalid result the app would have no
  // safety net left.
  it.each(cases)("produces a schema-valid result for %s", (_label, checks) => {
    const parsed = AnalysisResultSchema.safeParse(buildDegradedResult(checks));

    if (!parsed.success) console.error(parsed.error.issues);
    expect(parsed.success).toBe(true);
  });

  it("never claims a keyword match, because no job description was read", () => {
    expect(buildDegradedResult(cases[0]![1]).keywordMatch).toBeNull();
  });

  it("offers no bullet rewrites, which need the model", () => {
    expect(buildDegradedResult(cases[0]![1]).bulletRewrites).toEqual([]);
  });

  it("says in the summary that the score is structural only", () => {
    expect(buildDegradedResult(cases[0]![1]).summary).toContain("automated structural checks");
  });

  it("scores a complete resume above an empty one", () => {
    const complete = buildDegradedResult(runDeterministicChecks(RESUME, 2));
    const empty = buildDegradedResult(runDeterministicChecks("nothing useful here at all", null));

    expect(complete.overallScore).toBeGreaterThan(empty.overallScore);
  });
});
