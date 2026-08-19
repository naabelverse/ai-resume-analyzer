import type { AnalysisResult, DimensionScores } from "@/lib/schema/analysis";

/**
 * The six rubric dimensions the model actually returns. Weighted by
 * `RUBRIC_WEIGHTS` these come to 72, which is what `validResult()` carries as
 * `overallScore` — the wire fixture and the result fixture therefore describe
 * the same analysis rather than two unrelated ones.
 */
export function validDimensions(
  overrides: Partial<DimensionScores> = {},
): DimensionScores {
  return {
    impact: 62,
    relevance: 78,
    clarity: 74,
    structure: 80,
    skills: 76,
    ats: 70,
    ...overrides,
  };
}

/**
 * A minimal analysis that satisfies every bound in `AnalysisResultSchema`.
 * Tests mutate a copy to violate exactly one rule at a time, so a failure
 * names the constraint that broke rather than the whole object.
 */
export function validResult(
  overrides: Partial<AnalysisResult> = {},
): AnalysisResult {
  return {
    scoreRationale:
      "Band 60-74: competent but generic, with only two bullets carrying a metric.",
    overallScore: 72,
    verdict: "good",
    summary: "Solid engineering background, but most bullets describe duties rather than outcomes.",
    sections: [
      { name: "contact", score: 92, status: "pass", note: "Email and phone parse cleanly." },
      { name: "summary", score: 58, status: "warn", note: "Opens with a generic phrase." },
      { name: "experience", score: 70, status: "warn", note: "Only two bullets carry a metric." },
      { name: "education", score: 85, status: "pass", note: "Degree and dates are clear." },
      { name: "skills", score: 76, status: "pass", note: "Specific and current." },
      { name: "formatting", score: 64, status: "warn", note: "Contact details sit in the header." },
    ],
    feedback: Array.from({ length: 5 }, (_, index) => ({
      status: "warn" as const,
      text: `Finding number ${index}`,
      detail: `Detail for finding number ${index}.`,
    })),
    bulletRewrites: [
      {
        original: "Responsible for maintaining the booking service.",
        improved: "Maintained a booking service handling [X] requests/day.",
        why: "Turns a duty into an outcome.",
      },
    ],
    keywordMatch: { matched: ["TypeScript"], missing: ["Kubernetes"], matchPercent: 50 },
    redFlags: [],
    ...overrides,
  };
}
