import { describe, expect, it } from "vitest";

import {
  AnalysisResultSchema,
  AnalysisWireSchema,
  ARRAY_CAPS,
  RUBRIC_DIMENSIONS,
  RUBRIC_DIMENSION_LABELS,
  RUBRIC_WEIGHTS,
  SECTION_COHERENCE_TOLERANCE,
  SECTION_NAMES,
  STATUS_THRESHOLDS,
  deriveOverallScore,
  deriveVerdict,
} from "@/lib/schema/analysis";
import { z } from "zod";

import { SCORING_RUBRIC, SYSTEM_PROMPT } from "@/lib/ai/prompts";
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

  it("rejects fewer than 3 feedback items", () => {
    const short = validResult().feedback.slice(0, 2);
    expect(AnalysisResultSchema.safeParse(validResult({ feedback: short })).success).toBe(false);
  });

  // The floor moved from 5 to 3 so the decoder's minItems would stop
  // overriding RULE 1. Pinned in both directions: the old floor rejected this.
  it("accepts three feedback items, the floor RULE 1 needs", () => {
    const three = validResult().feedback.slice(0, 3);
    expect(AnalysisResultSchema.safeParse(validResult({ feedback: three })).success).toBe(true);
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

describe("the pass-item rule reaches the decoder", () => {
  /**
   * A run came back with all five feedback items marked "fail". The rule that
   * should prevent that lives in two places, and both have to survive a
   * refactor: the TONE section of the system prompt, and this description,
   * which z.toJSONSchema carries into the schema the model decodes against.
   * Dropping either one is silent — the output stays schema-valid, it just
   * stops being balanced.
   */
  it("carries the pass instruction on the feedback array", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: { feedback: { description?: string } };
    };

    expect(json.properties.feedback.description).toMatch(/pass/i);
    expect(json.properties.feedback.description).toMatch(/genuine strength/i);
  });

  it("keeps the rule in the system prompt too", () => {
    expect(SYSTEM_PROMPT).toMatch(/at least one feedback item must be a "pass"/);
  });
});

describe("the headline contract reaches the decoder", () => {
  /**
   * `feedback[].text` is what the UI renders as the headline, and it was the
   * one free-text field the system prompt never mentioned. RULE 1 governed
   * `detail` and gave it worked GOOD/BAD examples; `text` had eight words of
   * schema description and no example anywhere, so live runs filled it with
   * whatever taxonomy was nearest — six rubric headings verbatim in one case,
   * the schema's own key names in another.
   *
   * Both validated on the FIRST attempt, because the only constraint on `text`
   * is its length. So the contract lives in two places now, and a test pins
   * each: dropping either is otherwise silent.
   */
  it("tells the decoder a headline is a finding, not a topic", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        feedback: { items: { properties: { text: { description?: string } } } };
      };
    };
    const description =
      json.properties.feedback.items.properties.text.description ?? "";

    expect(description).toMatch(/finding, not a topic/i);
    expect(description).toMatch(/never a rubric heading/i);
  });

  it("gives the headline worked examples, as detail has", () => {
    expect(SYSTEM_PROMPT).toMatch(/a rubric heading, not a finding/);
    expect(SYSTEM_PROMPT).toMatch(/a schema key, not a finding/);
  });

  /**
   * The other half of the contract. Every detail in production opened by
   * repeating its own headline and then continuing, so expanding a row made
   * the reader read one sentence twice. RULE 1 had told `detail` to open with
   * a verbatim quote and never said it must not open with the headline again.
   */
  /**
   * Restating was forbidden before there was a cheap way out of it, and the
   * measured cost was empty `detail` fields: 2 such validation errors before
   * the rule, 5 after, across fifteen calls each. So the drop path is stated
   * first and the empty field is refused outright.
   */
  it("offers dropping the item before restructuring it", () => {
    const drop = SYSTEM_PROMPT.indexOf("DROP THE ITEM");
    // Fragment, not the full phrase: the prompt wraps after "make", so a
    // search spanning the break matches the source and not the built string.
    const restructure = SYSTEM_PROMPT.indexOf("the shorter claim");

    expect(drop).toBeGreaterThan(-1);
    expect(restructure).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(restructure);
  });

  it("refuses an empty detail outright", () => {
    expect(SYSTEM_PROMPT).toMatch(/NEVER leave .detail. empty/);
  });

  /** The floor is quoted to the model, so it must be the floor the schema sets. */
  it("states the floor the schema actually enforces", () => {
    expect(SYSTEM_PROMPT).toContain(`The floor is
${ARRAY_CAPS.feedbackMin} items`);
  });

  it("forbids the detail opening by restating the headline", () => {
    // Split rather than one phrase: the prompt wraps this sentence across a
    // line, so a regex spanning the break matches the source and not the string.
    expect(SYSTEM_PROMPT).toMatch(/must ADD to .text./);
    expect(SYSTEM_PROMPT).toMatch(/never repeat it/);
    expect(SYSTEM_PROMPT).toMatch(/opens by repeating the headline/);
    // The obvious evasion, named explicitly.
    expect(SYSTEM_PROMPT).toMatch(/reworded is still a repeat/);
  });

  /**
   * The live suite's leak detector checks headlines against
   * RUBRIC_DIMENSION_LABELS. Let those drift from what the rubric actually
   * says and it goes on looking for headings nobody states, catching nothing
   * while still reporting green.
   */
  it("states the same six dimension names the rubric does", () => {
    for (const label of Object.values(RUBRIC_DIMENSION_LABELS)) {
      expect(SCORING_RUBRIC).toContain(label);
    }
  });
});

describe("the status definition reaches the decoder", () => {
  /**
   * The enum shipped with no definition at all. Across nine live calls the
   * model emitted 8/8 "pass" on strong.txt and 8/8 "fail" on middling.txt and
   * never once used "warn" — it had been given three values, one rule about
   * one of them, and nothing else, so it used the field as a binary grade for
   * the whole resume rather than a judgement about each finding.
   *
   * Like the pass-item rule above, the fix lives in two places that must both
   * survive a refactor: the description carried into the JSON Schema, and the
   * system prompt. Losing either is silent — the output stays schema-valid, it
   * just goes back to being binary.
   */
  it("defines all three statuses on the feedback items", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        feedback: { items: { properties: { status: { description?: string } } } };
      };
    };

    const description = json.properties.feedback.items.properties.status.description;
    expect(description).toMatch(/pass =/);
    expect(description).toMatch(/warn =/);
    expect(description).toMatch(/fail =/);
  });

  it("defines them on the sections too, tied to the section score", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<string, { properties: { status: { description?: string } } }>;
        };
      };
    };

    for (const name of SECTION_NAMES) {
      const description =
        json.properties.sections.properties[name]!.properties.status.description;
      expect(description, `${name} status has no definition`).toMatch(/warn =/);
      expect(description, `${name} status is not tied to its score`).toMatch(
        /50 to 74/,
      );
    }
  });

  it("keeps the three-status rule in the system prompt too", () => {
    expect(SYSTEM_PROMPT).toMatch(/THREE STATUSES, NOT TWO/);
    expect(SYSTEM_PROMPT).toMatch(/"warn" is the ordinary case/);
  });

  /**
   * The boundaries the section description states are the ones `statusFor` in
   * `lib/scoring.ts` applies to the degraded path. They are not kept in step by
   * hand: both read `STATUS_THRESHOLDS`, and this asserts the description is
   * actually built from it rather than from a paraphrase that happens to match
   * today.
   */
  it("states the same boundaries the degraded path applies", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<string, { properties: { status: { description?: string } } }>;
        };
      };
    };
    const description =
      json.properties.sections.properties.contact!.properties.status.description ?? "";

    expect(description).toContain(`pass at ${STATUS_THRESHOLDS.pass} and above`);
    expect(description).toContain(`fail below ${STATUS_THRESHOLDS.warn}`);
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
