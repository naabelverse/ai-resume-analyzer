import { z } from "zod";

/**
 * Two schemas, deliberately.
 *
 * Structured outputs constrain decoding against a JSON Schema, which
 * guarantees *shape* — keys, types, enums, nullability — but does not enforce
 * string `.max()` bounds or array length ranges. So:
 *
 *   AnalysisWireSchema   — shape only. This is what goes to `zodOutputFormat`.
 *   AnalysisResultSchema — the full contract, every bound. Validates what came
 *                          back before a single character reaches the UI.
 *
 * The bounds the wire schema can't enforce are carried in `.describe()` calls
 * instead: descriptions become part of the JSON Schema the model decodes
 * against, so it sees "at most 90 characters" while generating rather than
 * only hearing about it in a retry. That turns most would-be violations into
 * non-events and keeps the retry for the genuinely surprising cases.
 */

export const SECTION_NAMES = [
  "contact",
  "summary",
  "experience",
  "education",
  "skills",
  "formatting",
] as const;

export const StatusSchema = z.enum(["pass", "warn", "fail"]);
export const VerdictSchema = z.enum(["needs-work", "good", "great"]);
export const SectionNameSchema = z.enum(SECTION_NAMES);

/* -------------------------------------------------------------------------
   The rubric dimensions.

   `overallScore` is NOT one of the model's outputs. It is computed from these
   six, for the same reason `verdict` is computed from it: two sources for one
   number eventually disagree. Here they disagreed in a specific, measurable
   way. Asked for a single score directly, the model named a band from the
   rubric's anchors and then returned that band's midpoint — across a nine-run
   measurement every score landed within one point of the midpoint of the band
   its own rationale had just named (82, 82, 94, 68, 68, 50, 50, 50). The
   anchors were not being ignored; they were being followed so literally they
   had become the whole scale, and a 0-100 gauge with five reachable values is
   not a gauge.

   Six independent numbers have no single midpoint to fall into, and their
   weighted sum lands wherever the six actually put it.
------------------------------------------------------------------------- */

export const RUBRIC_DIMENSIONS = [
  "impact",
  "relevance",
  "clarity",
  "structure",
  "skills",
  "ats",
] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

/**
 * The weights from `SCORING_RUBRIC` in `lib/ai/prompts.ts`, as numbers. They
 * are stated to the model as percentages and applied here, so a test asserts
 * they sum to 1 — otherwise the two could drift into a scale whose maximum is
 * not 100 and nothing would say so.
 */
export const RUBRIC_WEIGHTS: Record<RubricDimension, number> = {
  impact: 0.3,
  relevance: 0.2,
  clarity: 0.15,
  structure: 0.15,
  skills: 0.1,
  ats: 0.1,
};

const dimension = (what: string) =>
  z.number().int().min(0).max(100).describe(`Integer 0-100. ${what}`);

export const DimensionScoresSchema = z.object({
  impact: dimension(
    "Do bullets report outcomes with numbers, or just list duties? Weighted 30%.",
  ),
  relevance: dimension(
    "Fit to the job description, or to the role the resume plainly targets when none is supplied. Weighted 20%.",
  ),
  clarity: dimension(
    "Is each bullet readable in one pass? Filler, hedging and buzzwords cost marks. Weighted 15%.",
  ),
  structure: dimension(
    "Expected sections present, sensibly ordered, consistent in tense and formatting. Weighted 15%.",
  ),
  skills: dimension("Specific and current, or vague and dated? Weighted 10%."),
  ats: dimension(
    "Will an automated parser extract this correctly? Weighted 10%.",
  ),
});

export type DimensionScores = z.infer<typeof DimensionScoresSchema>;

/**
 * The weighted total. Rounded once at the end — rounding each term first would
 * let six separate roundings drift the result by a couple of points.
 */
export function deriveOverallScore(scores: DimensionScores): number {
  const total = RUBRIC_DIMENSIONS.reduce(
    (sum, name) => sum + scores[name] * RUBRIC_WEIGHTS[name],
    0,
  );
  return Math.max(0, Math.min(100, Math.round(total)));
}

/* -------------------------------------------------------------------------
   Wire schema — what Claude decodes against.

   `verdict` is absent on purpose: it is a band derived from `overallScore`,
   so asking the model for it only creates a way for the gauge's number and
   its label to disagree. `deriveVerdict` computes it after parsing.
------------------------------------------------------------------------- */

const SectionBodySchema = z.object({
  score: z.number().int().min(0).max(100).describe("Integer 0-100."),
  status: StatusSchema,
  note: z
    .string()
    .max(160)
    .describe(
      "One sentence about THIS resume's version of this section, quoting it where possible. Aim for 120 characters, never exceed 150.",
    ),
});

export const AnalysisWireSchema = z.object({
  // Declared before `dimensions` on purpose. JSON object keys are generated in
  // order, so the model states its judgement *before* it commits to numbers —
  // reasoning first, answer second, rather than numbers rationalised after the
  // fact.
  scoreRationale: z
    .string()
    .max(220)
    .describe(
      "In ONE sentence, name the single biggest thing lifting or holding back this resume, citing something specific in it. Do not state an overall score: it is computed from your dimension scores. Aim for 170 characters, never exceed 210.",
    ),
  /**
   * Six dimensions rather than one score. See the note above
   * `RUBRIC_DIMENSIONS`: a single requested score collapsed onto the midpoint
   * of whichever anchor band the model named, leaving five reachable values on
   * a hundred-point gauge.
   */
  dimensions: DimensionScoresSchema.describe(
    "Score each rubric dimension 0-100 on its own merits. These are weighted into the overall score, which you do not supply. Do not make the six agree with each other: a resume can be 90 on ATS-friendliness and 20 on impact.",
  ),
  summary: z
    .string()
    .max(500)
    .describe(
      "YOUR VERDICT on the resume, written TO the candidate as 'you' — e.g. 'Your experience section is strong, but...'. This is NOT the resume's own summary or profile section: never copy that text here. Two or three sentences. Aim for 260 characters.",
    ),
  /**
   * A keyed object, not an array.
   *
   * As an array of {name, ...} the model could omit a section, repeat one, or
   * invent a seventh, and JSON Schema could not forbid it — every one of those
   * showed up in live testing and cost a retry. As an object with six required
   * keys the invalid states are simply unrepresentable, and the decoder
   * enforces it for free. Flattened to the array the UI expects after parsing.
   */
  sections: z
    .object({
      contact: SectionBodySchema,
      summary: SectionBodySchema,
      experience: SectionBodySchema,
      education: SectionBodySchema,
      skills: SectionBodySchema,
      formatting: SectionBodySchema,
    })
    .describe("One entry for each of the six sections. All six are required."),
  feedback: z
    .array(
      z.object({
        status: StatusSchema,
        text: z
          .string()
          .max(90)
          .describe("The headline finding. Aim for 65 characters, never exceed 85."),
        detail: z
          .string()
          .max(300)
          .describe(
            'MUST open with the exact text you are criticising, copied verbatim from the resume, then explain why it matters and what to do. If you cannot quote a specific line, do not emit this item at all. Aim for 230 characters, never exceed 285.',
          ),
      }),
    )
    .min(5)
    .max(8)
    .describe(
      "Between 5 and 8 items. Include at least one 'pass' whenever the resume has a genuine strength.",
    ),
  bulletRewrites: z
    .array(
      z.object({
        original: z
          .string()
          .describe("The bullet copied verbatim from the resume."),
        improved: z.string().describe("The rewrite."),
        why: z
          .string()
          .describe("One sentence on what the rewrite changed and why."),
      }),
    )
    .max(5)
    .describe(
      "Between 0 and 5 rewrites, drawn only from bullets that actually appear in the resume.",
    ),
  keywordMatch: z
    .object({
      matched: z
        .array(z.string())
        .describe("Skills from the job description the resume demonstrates."),
      missing: z
        .array(z.string())
        .describe("Skills from the job description the resume does not show."),
      matchPercent: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe("round(matched / (matched + missing) * 100)."),
    })
    .nullable()
    .describe("Null when no job description was supplied. Never invent one."),
  redFlags: z
    .array(z.string())
    .describe(
      "Concrete problems a recruiter would notice: unexplained gaps, typos, inconsistencies. Empty array if none.",
    ),
});

export type AnalysisWire = z.infer<typeof AnalysisWireSchema>;

/* -------------------------------------------------------------------------
   Result schema — the contract the UI is built against.
------------------------------------------------------------------------- */

export const SectionScoreSchema = z.object({
  name: SectionNameSchema,
  score: z.number().int().min(0).max(100),
  status: StatusSchema,
  note: z.string().min(1).max(160),
});

export const FeedbackItemSchema = z.object({
  status: StatusSchema,
  text: z.string().min(1).max(90),
  detail: z.string().min(1).max(300),
});

export const BulletRewriteSchema = z.object({
  original: z.string().min(1),
  improved: z.string().min(1),
  why: z.string().min(1),
});

export const KeywordMatchSchema = z.object({
  matched: z.array(z.string()),
  missing: z.array(z.string()),
  matchPercent: z.number().int().min(0).max(100),
});

/**
 * How far the six section scores may sit from the overall score.
 *
 * This exists because of a real failure. A model returned
 * `contact=10 summary=5 experience=6 education=8 skills=7 formatting=9` — the
 * 0-10 scale — alongside a perfectly ordinary overall score of 68. Every value
 * was a valid integer in 0-100, so nothing rejected it, and the UI would have
 * rendered a catastrophic breakdown underneath a decent headline number. A
 * wrong answer that looks right is worse than an error; this turns it into one,
 * which the retry then gets a chance to fix.
 *
 * A stated minimum was the other option and is the wrong tool: a resume with no
 * education section genuinely scores near zero there, so a floor would reject
 * honest output. What is never legitimate is the breakdown as a whole
 * disagreeing with the score. Legitimate gaps across a nine-run live
 * measurement peaked at 12.5 points; the scale error produced 60.5.
 */
export const SECTION_COHERENCE_TOLERANCE = 35;

export const AnalysisResultSchema = z.object({
  scoreRationale: z.string().min(1).max(220),
  overallScore: z.number().int().min(0).max(100),
  verdict: VerdictSchema,
  summary: z.string().min(1).max(500),
  sections: z
    .array(SectionScoreSchema)
    .length(SECTION_NAMES.length)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.name)).size ===
        SECTION_NAMES.length,
      { message: "sections must cover each of the six section names exactly once" },
    ),
  feedback: z.array(FeedbackItemSchema).min(5).max(8),
  bulletRewrites: z.array(BulletRewriteSchema).max(5),
  keywordMatch: KeywordMatchSchema.nullable(),
  redFlags: z.array(z.string()),
}).refine(
  ({ overallScore, sections }) => {
    const average =
      sections.reduce((total, section) => total + section.score, 0) /
      sections.length;
    return Math.abs(average - overallScore) <= SECTION_COHERENCE_TOLERANCE;
  },
  {
    path: ["sections"],
    message:
      `the six section scores must average within ${SECTION_COHERENCE_TOLERANCE} points of ` +
      "overallScore — check every section score is on the 0-100 scale, not 0-10",
  },
);

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type SectionScore = z.infer<typeof SectionScoreSchema>;
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;
export type BulletRewrite = z.infer<typeof BulletRewriteSchema>;
export type KeywordMatch = z.infer<typeof KeywordMatchSchema>;
export type Status = z.infer<typeof StatusSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type SectionName = z.infer<typeof SectionNameSchema>;

/**
 * The single place a score becomes a band. Derived rather than model-supplied
 * so the number on the gauge and the label under it can never contradict
 * each other. Boundaries follow the rubric anchors in `lib/ai/prompts.ts`.
 */
export function deriveVerdict(overallScore: number): Verdict {
  if (overallScore >= 85) return "great";
  if (overallScore >= 60) return "good";
  return "needs-work";
}
