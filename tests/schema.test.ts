import { describe, expect, it } from "vitest";

import {
  AnalysisResultSchema,
  AnalysisWireSchema,
  ARRAY_CAPS,
  FIELD_CAPS,
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
import { statusFor } from "@/lib/scoring";
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

  it("rejects feedback text over the headline cap", () => {
    const feedback = validResult().feedback.map((entry) => ({
      ...entry,
      text: "x".repeat(FIELD_CAPS.feedbackText + 1),
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

describe("the non-empty contract reaches the decoder", () => {
  /**
   * This is the production failure of 2026-08-26, and it is the whole reason
   * the two schemas have to be kept in step by a test rather than by care.
   *
   * `AnalysisResultSchema` requires `.min(1)` on every free-text field. The
   * wire schema carried only `.max()`, so `z.toJSONSchema` emitted a
   * `maxLength` and no `minLength` — and an empty string was a LEGAL DECODE
   * that the validator then rejected. Both attempts produced
   * `feedback[].detail: ""`, and the run degraded with `AI_SCHEMA` in 24s,
   * which is far too fast to be the whitespace runaway that looks like it in
   * the log.
   *
   * The prompt already forbade an empty `detail` in prose ("NEVER leave
   * `detail` empty ... it fails validation"). Prose is not a grammar. What
   * makes it unrepresentable is `minLength`, for the same reason `sections` is
   * a keyed object rather than an array.
   *
   * So: every field the RESULT schema requires a character of, the WIRE schema
   * must forbid the decoder from leaving empty. Adding a `.min(1)` to one side
   * only is exactly the drift this pins.
   */
  interface StringNode {
    minLength?: number;
    maxLength?: number;
  }
  interface WireProperties {
    scoreRationale: StringNode;
    summary: StringNode;
    sections: {
      properties: Record<string, { properties: { note: StringNode } }>;
    };
    feedback: {
      items: { properties: { text: StringNode; detail: StringNode } };
    };
    bulletRewrites: {
      items: {
        properties: {
          original: StringNode;
          improved: StringNode;
          why: StringNode;
        };
      };
    };
  }

  const properties = () =>
    (z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: WireProperties;
    }).properties;

  type Pick = (p: WireProperties) => StringNode;

  const NON_EMPTY_PATHS: ReadonlyArray<readonly [string, Pick]> = [
    ["scoreRationale", (p) => p.scoreRationale],
    ["summary", (p) => p.summary],
    ...SECTION_NAMES.map(
      (name) =>
        [
          `sections.${name}.note`,
          (p: WireProperties) => p.sections.properties[name].properties.note,
        ] as const,
    ),
    ["feedback[].text", (p) => p.feedback.items.properties.text],
    ["feedback[].detail", (p) => p.feedback.items.properties.detail],
    ["bulletRewrites[].original", (p) => p.bulletRewrites.items.properties.original],
    ["bulletRewrites[].improved", (p) => p.bulletRewrites.items.properties.improved],
    ["bulletRewrites[].why", (p) => p.bulletRewrites.items.properties.why],
  ];

  it.each(NON_EMPTY_PATHS)(
    "emits minLength on %s, so the decoder cannot produce an empty string",
    (_label, pick) => {
      expect(pick(properties()).minLength).toBe(1);
    },
  );

  it("rejects an empty detail — the exact response that reached production", () => {
    const wire = wireFrom();
    (wire.feedback as Array<{ detail: string }>)[0].detail = "";

    expect(AnalysisWireSchema.safeParse(wire).success).toBe(false);
  });

  it.each(["scoreRationale", "summary"] as const)(
    "rejects an empty %s",
    (field) => {
      const wire = { ...wireFrom(), [field]: "" };
      expect(AnalysisWireSchema.safeParse(wire).success).toBe(false);
    },
  );

  /**
   * The bound the wire schema must NOT gain. `redFlags` is legitimately empty
   * — "no red flags" is an answer, and the description says so — and the
   * result schema puts no `.min(1)` on its items either. Pinned because the
   * obvious over-application of the fix above is to add `.min(1)` everywhere.
   */
  it("still accepts an empty redFlags array", () => {
    const wire = { ...wireFrom(), redFlags: [] };
    expect(AnalysisWireSchema.safeParse(wire).success).toBe(true);
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

  /**
   * The inverse of the assertion this replaces.
   *
   * Sections used to be ASKED for a status, with a description telling the
   * model to follow the score it had just given — advice that nothing
   * enforced, and a section duly came back scoring 85 marked "warn" above one
   * scoring 80 marked "pass". It is derived from the score now, so the field
   * must not reach the decoder at all: a field the model fills and the code
   * discards is worse than either, because it looks load-bearing.
   */
  it("does not ask the model for a section status at all", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<
            string,
            { properties: Record<string, unknown>; required?: string[] }
          >;
        };
      };
    };

    for (const name of SECTION_NAMES) {
      const section = json.properties.sections.properties[name]!;
      expect(
        Object.keys(section.properties),
        `${name} still offers the model a status field`,
      ).not.toContain("status");
      expect(section.required ?? []).not.toContain("status");
    }
  });

  it("keeps the three-status rule in the system prompt too", () => {
    expect(SYSTEM_PROMPT).toMatch(/THREE STATUSES, NOT TWO/);
    expect(SYSTEM_PROMPT).toMatch(/"warn" is the ordinary case/);
  });

  /**
   * `STATUS_THRESHOLDS` used to be pinned by being interpolated into the
   * section description sent to the model. Nothing sends it now — the model is
   * not asked for a section status — so the constant would sit unasserted, and
   * an unasserted constant is one somebody edits believing it is inert.
   *
   * It is load-bearing in exactly one place instead: `statusFor`, which both
   * the degraded path in `lib/scoring.ts` and the AI path's derivation in
   * `lib/ai/analyze.ts` route section scores through. Pinned at the boundaries
   * rather than at a paraphrase of them.
   */
  it("bands statusFor at the thresholds, on both sides of each boundary", () => {
    expect(statusFor(STATUS_THRESHOLDS.pass)).toBe("pass");
    expect(statusFor(STATUS_THRESHOLDS.pass - 1)).toBe("warn");
    expect(statusFor(STATUS_THRESHOLDS.warn)).toBe("warn");
    expect(statusFor(STATUS_THRESHOLDS.warn - 1)).toBe("fail");
    expect(statusFor(100)).toBe("pass");
    expect(statusFor(0)).toBe("fail");
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
  /*
    Boundaries read from `STATUS_THRESHOLDS` rather than restated, for the same
    reason the `statusFor` case above reads them: a literal here is a second
    copy that can drift. These were 85/60 until the score header was unified.
  */
  it.each([
    [0, "needs-work"],
    [STATUS_THRESHOLDS.warn - 1, "needs-work"],
    [STATUS_THRESHOLDS.warn, "good"],
    [STATUS_THRESHOLDS.pass - 1, "good"],
    [STATUS_THRESHOLDS.pass, "great"],
    [100, "great"],
  ])("maps %i to %s", (score, expected) => {
    expect(deriveVerdict(score)).toBe(expected);
  });

  /*
    The actual guard, and the reason this file is worth reading twice.

    The two banding systems disagreed for a long time — 85/60 on the gauge,
    75/50 on the six sections — so a resume scoring 72 was labelled "good"
    above a breakdown that labelled the same number "warn". Pinning the two
    boundary sets separately is what let that happen: both suites passed the
    whole time, because neither ever asked whether they AGREED.

    So this asserts the relationship, not the numbers. Any future edit that
    moves one banding system without the other fails here, at every score in
    between, rather than shipping as two green suites and one contradictory
    screen.
  */
  it("bands every score exactly as statusFor bands a section", () => {
    const SAME_RANK = {
      fail: "needs-work",
      warn: "good",
      pass: "great",
    } as const;

    for (let score = 0; score <= 100; score += 1) {
      expect(deriveVerdict(score), `score ${score}`).toBe(
        SAME_RANK[statusFor(score)],
      );
    }
  });
});

describe("the prompt does not ask for a derived field", () => {
  /**
   * `status` was removed from the wire section object in `2b44aaf` so it could
   * be derived from the section score, but RULE 4 went on telling the model
   * that "every section carries a status" for four commits afterwards. The
   * grammar made that harmless — `additionalProperties: false` meant the field
   * could not be emitted — so nothing failed and nothing said so.
   *
   * Harmless is not the same as correct: it is an instruction to produce a
   * field the schema forbids, and the next person to read the prompt has to
   * work out which of the two is lying. `verdict` and `overallScore` are the
   * same shape of rule and RULE 3 already states them correctly.
   */
  it("asks for a status on feedback items only", () => {
    expect(SYSTEM_PROMPT).toMatch(/Every feedback item carries a status/);
    expect(SYSTEM_PROMPT).not.toMatch(/every section carries a status/i);
  });

  it.each(["status", "verdict", "overallScore"])(
    "keeps %s out of the wire section object, where it is derived",
    (field) => {
      const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
        properties: { sections: { properties: Record<string, { required: string[] }> } };
      };

      for (const name of SECTION_NAMES) {
        expect(json.properties.sections.properties[name].required).not.toContain(
          field,
        );
      }
    },
  );
});

/**
 * One `=== HEADER ===` section of the system prompt, from its header to the
 * next one.
 *
 * The two scoping tests below are about where a paragraph SITS, not about how
 * it is worded, and matching against the whole of `SYSTEM_PROMPT` cannot tell
 * "inside RULE 1" from "anywhere in the prompt". That distinction is the
 * entire fix, so the assertion has to be able to see it.
 */
function ruleText(header: string): string {
  const start = SYSTEM_PROMPT.indexOf(header);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = SYSTEM_PROMPT.indexOf("\n=== ", start + 1);
  return SYSTEM_PROMPT.slice(start, next === -1 ? undefined : next);
}

describe("the section note is not the detail contract", () => {
  /**
   * A live analysis returned section notes cut mid-word at the 190 cap while
   * the description still asked for 120 and forbade 150. The target was not
   * holding, and the reason was not verbosity.
   *
   * RULE 1 ended with "The same applies to sections[].note and to redFlags."
   * That sentence is unchanged since `d7d36f6`, when RULE 1 was 736 characters
   * and said one thing: quote real text or drop the item. Applied to a note
   * that is a CONSTRAINT — it makes the output shorter and more specific.
   *
   * RULE 1 is now 8,694 characters. What the note had come to inherit was the
   * whole `detail` contract: open with a verbatim quote, carry on past it, say
   * what it costs and what to change, in a new sentence with its own subject.
   * That is a three-clause structure asked of a field with a 120-character
   * target, against a rule titled "the most important rule here". The louder
   * instruction won, which is why both live examples read as observation ->
   * problem -> next step.
   *
   * The failure mode is general and worth naming: a blanket "the same applies
   * to X" inherits whatever the referenced rule LATER becomes. The first fix
   * replaced that sentence with "Everything above it", which is the same
   * defect in a narrower word: a boundary drawn at a POSITION still inherits
   * whatever is later written on the near side of it. One commit later,
   * something was.
   *
   * So the boundary names the two fields it governs instead. `text` and
   * `detail` do not move when a paragraph is added; "above" does.
   *
   * The adjective in the last assertion is load-bearing and it is new. A note
   * may now close with one clause of prescription, so the boundary is no
   * longer "a note never advises" — it is that a note does not inherit the
   * FULL three-clause structure. Quote, cost, and fix with its own subject is
   * still `detail`'s job. What this pins is that the boundary is drawn at all.
   */
  it("scopes RULE 1 by naming its fields, not by position", () => {
    const rule = ruleText("=== RULE 1:");
    expect(rule).toMatch(/RULE 1 governs two fields/);
    expect(rule).toContain("a feedback item's `text`");
    expect(rule).toContain("`detail`");
    expect(rule).toContain("does NOT carry the full quote-then-advise structure");
    // Both positional forms, pinned dead. Either one re-opens the same hole.
    expect(SYSTEM_PROMPT).not.toMatch(/Everything above it/);
    expect(SYSTEM_PROMPT).not.toMatch(/The same applies to sections\[\]\.note/);
  });

  /**
   * The other half of the same fix: the note's own contract no longer sits
   * INSIDE the rule it must not inherit from.
   *
   * The count block was added at the tail of RULE 1 one commit after the
   * boundary was drawn — on the near side of it, and past the sentence saying
   * everything on that side governed `text` and `detail`. Nothing was wrong
   * with the four lines themselves. What was wrong is that a note's contract
   * sat inside a 9,624-character rule addressed to two other fields, which is
   * the arrangement that has now produced two inheritance bugs. It has its own
   * section, and this fails if it is ever moved back.
   */
  it("keeps the note's own contract outside RULE 1", () => {
    expect(SYSTEM_PROMPT).toContain("=== SECTION NOTES ===");
    expect(ruleText("=== RULE 1:")).not.toContain("A note names ONE thing");
    expect(ruleText("=== SECTION NOTES ===")).toContain(
      "A note names ONE thing",
    );
  });

  /**
   * This used to assert the opposite — "do NOT say what to change" — and it
   * was right to, for as long as the note's contract forbade prescription.
   * The prohibition lost three rounds: the round that read the nine longest
   * notes rather than only counting them found four of them prescribing
   * anyway, which is what `FIELD_CAPS.sectionNote` now records at length.
   *
   * So the boundary pinned here is no longer "a note never prescribes". It is
   * the one that survived: a note may close with ONE clause of prescription,
   * and the quote-then-explain treatment stays in `feedback[].detail`. That is
   * the line whose erasure caused the inheritance bug, and it still earns a
   * test.
   */
  it("lets a note prescribe in one clause, and no further", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<string, { properties: { note: { description?: string } } }>;
        };
      };
    };

    for (const name of SECTION_NAMES) {
      const description =
        json.properties.sections.properties[name].properties.note.description ??
        "";
      expect(description).toMatch(/ONE clause naming what to do about it/);
      expect(description).toMatch(/feedback\[\]\.detail/);
      // The prohibition is gone on purpose, not by accident.
      expect(description).not.toMatch(/do NOT say what to change/);
      expect(description).toMatch(/Aim for 150 characters, never exceed 190/);
    }
  });
});

describe("the note names one thing, counted rather than measured", () => {
  /**
   * The first note contract held on middling (mean 112.2, 1/30 over the stated
   * max) and weak (120.6, 5/24) and failed on strong: mean 138.8, 9 of 24 over
   * 150, 4 at the cap. Pooled by section, `summary` and `skills` ran at 139
   * while `contact` sat at 96 — and contact is the section with exactly one
   * thing to say about it.
   *
   * So the fault is not verbosity. A richer resume gives the model more to
   * observe per section and it observes all of it: the measured failure is an
   * ENUMERATION comma-spliced into a field sized for one finding.
   *
   * Hence a count, not a length. This repo has twice established that the model
   * writes to a length it has already decided on and the cap only chooses where
   * the cut lands — `FIELD_CAPS.feedbackText` records both attempts. "One
   * observation, at most one quotation" is checkable while writing in a way
   * "aim for 120 characters" demonstrably is not.
   *
   * Pinned in both places for the reason the headline contract is: `f485f05`
   * found that eight words of schema description with no worked example
   * anywhere lost to whatever taxonomy was nearest.
   */
  it("states the count in the description the decoder reads", () => {
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<string, { properties: { note: { description?: string } } }>;
        };
      };
    };

    for (const name of SECTION_NAMES) {
      const description =
        json.properties.sections.properties[name].properties.note.description ??
        "";
      expect(description).toMatch(/one thing, not a list/);
      expect(description).toMatch(/at most one quotation/);
      expect(description).toMatch(/name the most important and stop/);
    }
  });

  it("gives the note worked examples, as the headline and detail have", () => {
    expect(SYSTEM_PROMPT).toMatch(/A note names ONE thing\. Count, not length/);
    expect(SYSTEM_PROMPT).toMatch(/four findings in a field sized for one/);
  });

  /**
   * The lever that WAS eventually pulled. This test used to be called "moves
   * neither the target nor the cap" and pinned 190/120/150 so a later reader
   * would not assume the numbers had moved when only a competing instruction
   * had been removed. Its own comment named the condition for revisiting them:
   * "if the mean still sits near 139 afterwards then the length is intrinsic
   * to what those sections have to say and the TARGET is what deserves
   * revisiting — with the arithmetic re-run first."
   *
   * That is what happened. `weak` came back at 153.9 with 11/30 cut mid-word,
   * the arithmetic was re-run against the maxed wire object (see the budget
   * test below), and target and cap moved together — 120/150/190 becomes
   * 150/190/230. Pinned again at the new numbers, for the same reason.
   */
  it("moves the target and the cap together", () => {
    expect(FIELD_CAPS.sectionNote).toBe(230);
    const json = z.toJSONSchema(AnalysisWireSchema) as unknown as {
      properties: {
        sections: {
          properties: Record<string, { properties: { note: { description?: string } } }>;
        };
      };
    };
    expect(
      json.properties.sections.properties.contact.properties.note.description,
    ).toMatch(/Aim for 150 characters, never exceed 190/);
  });
});

/**
 * The response budget, as a test rather than as a comment.
 *
 * `ARRAY_CAPS` carries a long derivation of the largest response the schema
 * permits, and the number in it has now been wrong twice: once read off a
 * neighbouring row ("about 50 tokens to spare" for a case that had 94), and
 * once as a `sectionNote` ceiling of "about 215" that re-derivation put at
 * 234. Both times the comment said the arithmetic was cheap to run, and both
 * times nobody ran it.
 *
 * So it runs here, every time. Build the maxed wire object, PARSE it — a legal
 * response, not merely a large object, which is the step an estimate always
 * skips — serialize, divide.
 *
 * The rate is the conservative pairing of the two the comment records: compact
 * characters at 3.75 chars/token. The other pairing (as-emitted pretty at
 * 4.067) is more generous by ~40 characters of `sectionNote`, and is not used,
 * because it rests on a single live capture and one capture is not a rate.
 */
describe("the largest permitted response fits in AI_MAX_TOKENS", () => {
  const AI_MAX_TOKENS = 4_000;
  const CHARS_PER_TOKEN = 3.75;
  const fill = (n: number) => "x".repeat(n);

  /** Every bound maxed. `keywordMatch` present, since its null case is smaller. */
  // Annotated `number` rather than inferred: `FIELD_CAPS` is `as const`, so an
  // inferred default narrows this to the literal 230 and every call with a
  // different cap — which is the entire point of the helper — is a type error.
  function maxedWire(noteCap: number = FIELD_CAPS.sectionNote) {
    return {
      scoreRationale: fill(FIELD_CAPS.scoreRationale),
      dimensions: Object.fromEntries(RUBRIC_DIMENSIONS.map((d) => [d, 100])),
      summary: fill(FIELD_CAPS.summary),
      sections: Object.fromEntries(
        SECTION_NAMES.map((s) => [s, { score: 100, note: fill(noteCap) }]),
      ),
      feedback: Array.from({ length: ARRAY_CAPS.feedbackMax }, () => ({
        status: "fail",
        text: fill(FIELD_CAPS.feedbackText),
        detail: fill(FIELD_CAPS.feedbackDetail),
      })),
      bulletRewrites: Array.from({ length: ARRAY_CAPS.bulletRewrites }, () => ({
        original: fill(FIELD_CAPS.rewriteOriginal),
        improved: fill(FIELD_CAPS.rewriteImproved),
        why: fill(FIELD_CAPS.rewriteWhy),
      })),
      keywordMatch: {
        matched: Array.from({ length: ARRAY_CAPS.keywords }, () =>
          fill(FIELD_CAPS.keyword),
        ),
        missing: Array.from({ length: ARRAY_CAPS.keywords }, () =>
          fill(FIELD_CAPS.keyword),
        ),
        matchPercent: 100,
      },
      redFlags: Array.from({ length: ARRAY_CAPS.redFlags }, () =>
        fill(FIELD_CAPS.redFlag),
      ),
    };
  }

  const tokensFor = (obj: unknown) =>
    JSON.stringify(obj).length / CHARS_PER_TOKEN;

  it("is a legal response, so the bound is real and not a shape nobody accepts", () => {
    expect(AnalysisWireSchema.safeParse(maxedWire()).success).toBe(true);
  });

  it("fits, at the caps that ship", () => {
    expect(tokensFor(maxedWire())).toBeLessThanOrEqual(AI_MAX_TOKENS);
  });

  /**
   * The margin is 7 tokens. That is deliberate and it is documented in
   * `ARRAY_CAPS` — `sectionNote` spent the room that was being held against
   * `redFlag`, a field with zero live observations.
   *
   * This asserts the ceiling rather than the margin, so that raising any cap
   * fails HERE, with the arithmetic in front of you, rather than in production
   * as a response truncated at `max_tokens`.
   */
  it("puts the sectionNote ceiling at 234, with 230 shipping", () => {
    expect(FIELD_CAPS.sectionNote).toBe(230);
    expect(tokensFor(maxedWire(234))).toBeLessThanOrEqual(AI_MAX_TOKENS);
    expect(tokensFor(maxedWire(235))).toBeGreaterThan(AI_MAX_TOKENS);
    // 250 was asked for in the round that raised this to 230. It does not fit.
    expect(tokensFor(maxedWire(250))).toBeGreaterThan(AI_MAX_TOKENS);
  });
});
