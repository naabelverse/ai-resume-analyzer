import { describe, expect, it } from "vitest";

import {
  AnalysisResultSchema,
  AnalysisWireSchema,
  RUBRIC_DIMENSIONS,
  RUBRIC_WEIGHTS,
  SECTION_COHERENCE_TOLERANCE,
  deriveOverallScore,
  deriveVerdict,
} from "@/lib/schema/analysis";
import { validDimensions, validResult } from "./helpers";

/** The wire shape: no verdict, no overallScore, sections keyed by name. */
function wireFrom(result = validResult()) {
  const {
    verdict: _verdict,
    overallScore: _overallScore,
    sections,
    ...rest
  } = result;

  return {
    ...rest,
    dimensions: validDimensions(),
    sections: Object.fromEntries(
      sections.map(({ name, ...body }) => [name, body]),
    ),
  };
}

describe("AnalysisResultSchema", () => {
  it("accepts a well-formed analysis", () => {
    expect(AnalysisResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it("accepts a null keywordMatch, which is the no-job-description case", () => {
    const parsed = AnalysisResultSchema.safeParse(
      validResult({ keywordMatch: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["a score above 100", { overallScore: 101 }],
    ["a negative score", { overallScore: -1 }],
    ["a fractional score", { overallScore: 72.5 }],
    ["a summary over 500 characters", { summary: "x".repeat(501) }],
    ["an empty summary", { summary: "" }],
    ["more than 5 bullet rewrites", { bulletRewrites: Array.from({ length: 6 }, () => ({ original: "a", improved: "b", why: "c" })) }],
    ["a matchPercent above 100", { keywordMatch: { matched: [], missing: [], matchPercent: 101 } }],
  ])("rejects %s", (_label, override) => {
    const parsed = AnalysisResultSchema.safeParse(
      validResult(override as Parameters<typeof validResult>[0]),
    );
    expect(parsed.success).toBe(false);
  });

  it("rejects fewer than 5 feedback items", () => {
    const short = validResult().feedback.slice(0, 4);
    expect(AnalysisResultSchema.safeParse(validResult({ feedback: short })).success).toBe(false);
  });

  it("rejects more than 8 feedback items", () => {
    const item = validResult().feedback[0]!;
    const long = Array.from({ length: 9 }, () => item);
    expect(AnalysisResultSchema.safeParse(validResult({ feedback: long })).success).toBe(false);
  });

  it("rejects feedback text over 90 characters", () => {
    const feedback = validResult().feedback.map((entry) => ({
      ...entry,
      text: "x".repeat(91),
    }));
    expect(AnalysisResultSchema.safeParse(validResult({ feedback })).success).toBe(false);
  });

  it("rejects a missing section", () => {
    const five = validResult().sections.slice(0, 5);
    expect(AnalysisResultSchema.safeParse(validResult({ sections: five })).success).toBe(false);
  });

  it("rejects a duplicated section name", () => {
    // Six entries, but "contact" twice — the length check alone would pass it.
    const sections = validResult().sections;
    const duplicated = [...sections.slice(0, 5), { ...sections[0]! }];
    expect(AnalysisResultSchema.safeParse(validResult({ sections: duplicated })).success).toBe(false);
  });

  it("rejects an unknown status value", () => {
    const feedback = validResult().feedback.map((entry) => ({
      ...entry,
      status: "excellent",
    }));
    expect(AnalysisResultSchema.safeParse(validResult({ feedback: feedback as never })).success).toBe(false);
  });
});

describe("AnalysisWireSchema", () => {
  it("accepts the wire shape", () => {
    expect(AnalysisWireSchema.safeParse(wireFrom()).success).toBe(true);
  });

  it.each(["verdict", "overallScore"])(
    "has no %s field — both are derived, never model-supplied",
    (field) => {
      expect(field in AnalysisWireSchema.shape).toBe(false);
    },
  );

  it("requires all six rubric dimensions", () => {
    for (const name of RUBRIC_DIMENSIONS) {
      const wire = wireFrom();
      delete (wire.dimensions as Record<string, unknown>)[name];
      expect(AnalysisWireSchema.safeParse(wire).success).toBe(false);
    }
  });

  it("makes a missing section structurally impossible", () => {
    // The whole reason sections is a keyed object: as an array the model could
    // omit one, repeat one, or invent a seventh — all three happened live.
    const wire = wireFrom();
    delete (wire.sections as Record<string, unknown>).skills;

    expect(AnalysisWireSchema.safeParse(wire).success).toBe(false);
  });

  it("still enforces structure, so a missing key fails", () => {
    const { redFlags: _redFlags, ...rest } = wireFrom();
    expect(AnalysisWireSchema.safeParse(rest).success).toBe(false);
  });
});

describe("deriveOverallScore", () => {
  it("weights sum to exactly 1, so the scale really does top out at 100", () => {
    const total = RUBRIC_DIMENSIONS.reduce(
      (sum, name) => sum + RUBRIC_WEIGHTS[name],
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  it.each([
    ["all zero", 0, 0],
    ["all one hundred", 100, 100],
    ["all fifty", 50, 50],
  ])("maps %s to %i", (_label, value, expected) => {
    const flat = Object.fromEntries(
      RUBRIC_DIMENSIONS.map((name) => [name, value]),
    ) as ReturnType<typeof validDimensions>;
    expect(deriveOverallScore(flat)).toBe(expected);
  });

  it("weights impact hardest, ats lightest", () => {
    const base = validDimensions({
      impact: 50,
      relevance: 50,
      clarity: 50,
      structure: 50,
      skills: 50,
      ats: 50,
    });

    const impactUp = deriveOverallScore({ ...base, impact: 100 });
    const atsUp = deriveOverallScore({ ...base, ats: 100 });

    expect(impactUp).toBeGreaterThan(atsUp);
    expect(impactUp - 50).toBe(15); // 50 points x 0.30
    expect(atsUp - 50).toBe(5); //     50 points x 0.10
  });

  /**
   * The regression this whole field exists for.
   *
   * Asked for one score, the model returned the midpoint of whichever anchor
   * band it had named, so a 0-100 gauge had five reachable values. Six
   * independent dimensions do not compose that way: even if every one of them
   * were snapped to its own band midpoint, the weighted totals stay distinct.
   */
  it("does not collapse distinct breakdowns onto the same score", () => {
    const scores = new Set(
      // Every value below is itself a band midpoint — the exact behaviour that
      // produced five reachable scores when one number was requested. Weighted
      // together they still come out 82, 69, 60 and 78.
      [
        [82, 82, 82, 82, 82, 82],
        [49, 82, 67, 67, 82, 95],
        [30, 49, 67, 82, 95, 95],
        [95, 95, 82, 67, 49, 30],
      ].map(([impact, relevance, clarity, structure, skills, ats]) =>
        deriveOverallScore({
          impact: impact!,
          relevance: relevance!,
          clarity: clarity!,
          structure: structure!,
          skills: skills!,
          ats: ats!,
        }),
      ),
    );

    expect(scores.size).toBe(4);
  });
});

describe("section-score coherence", () => {
  /**
   * The live failure this guards: a model returned the six section scores on a
   * 0-10 scale next to an ordinary overall score. Every value was a valid
   * integer in 0-100, so nothing rejected it, and the UI would have rendered a
   * catastrophic breakdown under a decent headline number.
   */
  it("rejects section scores emitted on the 0-10 scale", () => {
    const tenPointScale = validResult().sections.map((section, index) => ({
      ...section,
      score: [10, 5, 6, 8, 7, 9][index]!,
    }));

    const parsed = AnalysisResultSchema.safeParse(
      validResult({ overallScore: 68, sections: tenPointScale }),
    );

    expect(parsed.success).toBe(false);
  });

  it("accepts a breakdown that disagrees with the score by a normal amount", () => {
    // Sections average 74.2 against an overall of 72 in the fixture; widen the
    // gap to something real but explicable and it must still pass.
    const sections = validResult().sections.map((section) => ({
      ...section,
      score: Math.min(100, section.score + 20),
    }));

    expect(
      AnalysisResultSchema.safeParse(validResult({ sections })).success,
    ).toBe(true);
  });

  it("draws the line at the stated tolerance", () => {
    // Downwards from the fixture's overall score of 72, because upwards runs
    // out of scale before it runs out of tolerance.
    const at = validResult().sections.map((section) => ({
      ...section,
      score: 72 - SECTION_COHERENCE_TOLERANCE,
    }));
    const past = validResult().sections.map((section) => ({
      ...section,
      score: 72 - SECTION_COHERENCE_TOLERANCE - 1,
    }));

    expect(AnalysisResultSchema.safeParse(validResult({ sections: at })).success).toBe(true);
    expect(AnalysisResultSchema.safeParse(validResult({ sections: past })).success).toBe(false);
  });
});

describe("deriveVerdict", () => {
  it.each([
    [0, "needs-work"],
    [59, "needs-work"],
    [60, "good"],
    [84, "good"],
    [85, "great"],
    [100, "great"],
  ])("maps %i to %s", (score, expected) => {
    expect(deriveVerdict(score)).toBe(expected);
  });
});
