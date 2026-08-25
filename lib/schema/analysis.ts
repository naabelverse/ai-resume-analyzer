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

/**
 * Character caps for the free-text fields, in one place.
 *
 * They were previously written twice each — once in the wire schema so
 * `z.toJSONSchema` emits `maxLength` for the decoder, once in the result schema
 * so Zod enforces it — and a drifted pair would mean the decoder cutting at one
 * length while the validator rejected at another. `repairTruncation` needs the
 * same numbers to recognise a decoder cut, which would have made three copies.
 */
export const FIELD_CAPS = {
  scoreRationale: 220,
  summary: 500,
  /**
   * A hundred and ninety, up from 160, and the same lever as the headline cap
   * below: the model was running into it and the decoder was cutting mid-word.
   *
   * Measured across the six sections of the one captured analysis that carries
   * notes: 56, 86, 115, 116, 127, and **159 against a cap of 160**. Five of six
   * sit at or under 127; one hits the ceiling and is cut. Note which one —
   * `skills` bit on disk while the report from production was `formatting`,
   * which is what says this is the cap biting generally rather than one section
   * being verbose.
   *
   * 190 clears the observed clean maximum by 63 and the stated maximum by 40.
   * Six sections, so **each +1 character costs 6** against the ceiling; what is
   * left after this is in the arithmetic below.
   *
   * The description is untouched at "Aim for 120 characters, never exceed 150".
   * Backstop up, target alone — raising both is the 70-cap experiment in
   * reverse, and `feedbackText` below records how that went.
   */
  sectionNote: 190,
  /**
   * A hundred and twenty. It was 90, and before that 70 — see the README.
   *
   * Both earlier numbers were attempts to make the cap shape the sentence, and
   * neither worked. Dropping it to 70 did not shorten what the model writes:
   * across five runs per fixture the mean fell to ~62, but 47 of 59 headlines
   * came back cut mid-word by the decoder, against roughly one in five at 90.
   * The same sentence, truncated earlier. What that established is that the
   * model writes to a length it has already decided on, and the cap only
   * decides where the cut lands.
   *
   * 120 takes that finding seriously in the other direction. Measured
   * distribution against the 90 cap: mean 70.7 / 74.4, max 84. A ceiling of
   * 120 clears the whole observed range, so the cuts stop because the tail
   * fits — not because the model wrote anything different. The evidence they
   * were happening at all is a live capture where `text` arrived at exactly 90,
   * cut mid-token, ending on a stray character from another script.
   *
   * The prediction this ships on, and it is falsifiable from ordinary use:
   * **the mean stays at ~72-75 and headlines stop arriving cut.** If instead
   * the mean climbs toward 110, the model does anchor upward on the ceiling
   * and this belongs beside the 70 attempt as a lever that moved the wrong
   * thing.
   *
   * That prediction depends on the field description NOT moving with the cap.
   * It still says "Aim for 65 characters, never exceed 85": the description is
   * what the model aims at, the cap is only the backstop. Raising both would
   * be the 70 experiment run in reverse.
   *
   * Two things this does not change. The lever that holds the layout is still
   * `line-clamp-2` on the collapsed row, which is robust to any length and has
   * to be — the component cannot depend on the response behaving. And the
   * ceiling-is-the-lever reasoning that `ARRAY_CAPS.feedbackMin` records still
   * holds only for a bound the model can satisfy by making a different choice,
   * never for one it can satisfy only by writing a shorter sentence than it
   * has decided to write.
   */
  feedbackText: 120,
  /**
   * Four hundred, up from 300, for the reason above and one of its own.
   *
   * `detail` carries a verbatim quote AND the advice, and the prompt spends
   * real effort telling the model to keep the quote short so the advice fits.
   * At 300 a detail that obeyed that rule could still run out of room: the
   * measured distribution was mean 190.5 / 212.9 with a max of 298, i.e. the
   * tail was sitting on the cap and getting cut there.
   *
   * Same discipline as the headline: the description still says "Aim for 230
   * characters, never exceed 285", and it stays there. This raises the
   * backstop, not the target.
   */
  feedbackDetail: 400,
  rewriteOriginal: 300,
  rewriteImproved: 300,
  rewriteWhy: 200,
  redFlag: 200,
  keyword: 60,
} as const;

/**
 * Array length caps, for the same reason the character caps exist.
 *
 * `feedback` was bounded from the start. `bulletRewrites` capped its item count
 * but not the strings inside it, and `redFlags`, `keywordMatch.matched` and
 * `keywordMatch.missing` were unbounded arrays of unbounded strings. So there
 * was no computable ceiling on a valid response, and `AI_MAX_TOKENS` was
 * therefore set to a number nobody could derive rather than to one the schema
 * implies.
 *
 * With these the largest permitted response is arithmetic. Built and
 * serialized rather than estimated — every bound maxed, compact JSON — it is
 * **13.6k characters, roughly 3.6k tokens** at the ~3.75 chars/token this
 * endpoint runs at. (This read "about 12k characters, roughly 3.2k tokens"
 * until the figure was actually computed. The estimate was low.)
 * `AI_MAX_TOKENS` in `lib/env.ts` is chosen against that number and cites it.
 *
 * The margin is thinner than it looks, and it is what bounds the character
 * caps above. Multiplicity is the whole cost: `feedbackText` and
 * `feedbackDetail` sit inside an 8-item array, so **each +1 character costs
 * 8**; `sectionNote` sits in six sections, so **each +1 costs 6**.
 *
 * At the caps that ship the worst case is **14,829 characters, ~3,954 tokens:
 * it fits, with 46 tokens to spare.** The ceiling for `sectionNote` alone is
 * about 215 before the total goes over.
 *
 * That figure was wrong here once and the correction is worth keeping. This
 * read "14.8k characters, ~3.95k tokens... about 50 tokens to spare" for the
 * caps `bfdc0a1` shipped, which was a misreading of a row: the true worst case
 * there was 14,649 characters and 3,906 tokens, leaving 94 rather than 50. The
 * arithmetic is cheap to run and was not run — do that rather than reading a
 * number off a nearby line.
 *
 * **`redFlag` is unmeasured, and that is the thing to know before raising
 * anything else.** Every other capped field has been measured against captured
 * output; `redFlag` has **zero observations** — the runs on disk produced no
 * red flags at all — while carrying a 200 cap in a 6-item array, which is 6
 * characters per +1 of the 46 tokens that remain. Nothing says it is safe. It
 * is simply unseen, and it is the most likely field to bite next without
 * warning.
 *
 * There is no room for a further raise of consequence without moving
 * `AI_MAX_TOKENS`, and that is pinned from the other side — 4000 x the slow
 * per-token rate is already 107.6s against a 120s `AI_TIMEOUT_MS`.
 *
 * Note what this does NOT fix: the whitespace runaway documented in the README
 * happens BETWEEN structural tokens, where the JSON grammar always permits more
 * whitespace, so no array bound can stop it. Only `max_tokens` bounds that.
 */
export const ARRAY_CAPS = {
  /**
   * Three, not five.
   *
   * `z.toJSONSchema` emits this as `minItems` and NVIDIA's strict json_schema
   * enforces it while decoding, so a floor of five was a grammar that could not
   * stop before five items whatever the resume contained. That contradicts
   * RULE 1 outright: the prompt tells the model that if it cannot quote a
   * specific line it must not emit the item, and the grammar then refuses to
   * let it stop. Told to stop and forbidden to stop, it padded — one live run
   * returned exactly five items whose headlines were the schema's own key
   * names, and the production run that prompted this returned eight, six of
   * them rubric headings.
   *
   * Three is the smallest count that is still a review rather than a remark:
   * room for a strength and two problems, which is what the pass-item rule and
   * the three statuses together already imply. Note what this does NOT claim to
   * do — it does not stop the model reaching for the ceiling when it has eight
   * things to say. `26c7f3b` established that telling it not to pad changes
   * nothing. This only stops the schema *compelling* the padding.
   *
   * The ceiling is unchanged at eight, so the response-size arithmetic below
   * and the `AI_MAX_TOKENS` figure derived from it are untouched.
   */
  feedbackMin: 3,
  feedbackMax: 8,
  bulletRewrites: 5,
  redFlags: 6,
  keywords: 20,
} as const;

export const StatusSchema = z.enum(["pass", "warn", "fail"]);

/**
 * What the three statuses mean, stated once and attached to every field that
 * uses them.
 *
 * The enum shipped with no definition anywhere: not here, not in the system
 * prompt, which mentioned status exactly once — the rule that a genuine
 * strength must produce a "pass". A three-value enum with a rule attached to
 * one value reads as a binary, and the model duly used it as one. Measured
 * across nine live calls: strong.txt came back 8/8 "pass" and middling.txt 8/8
 * "fail", with "warn" never once emitted. The model was grading the RESUME and
 * stamping every item with that grade, which is how a resume could score 62,
 * render "Good work" on the gauge, and list eight red failures underneath it.
 *
 * `statusFor` in `lib/scoring.ts` already defined these thresholds for the
 * degraded path. Only the model was never told.
 */
/**
 * Where a score becomes a status. `lib/scoring.ts` routes the degraded path's
 * section scores through these, and the section `status` description below is
 * built from them, so the model is told the same boundaries the code applies
 * rather than a hand-copied paraphrase of them.
 */
export const STATUS_THRESHOLDS = { pass: 75, warn: 50 } as const;

export const STATUS_MEANING =
  "pass = this specific thing is done well and needs no change. " +
  "warn = this specific thing works but has a real weakness worth fixing. " +
  "fail = this specific thing is a concrete problem that costs interviews. " +
  "The status describes THAT ONE FINDING, not the resume overall: a strong " +
  "resume still has warn items and a weak one still has something that passes.";
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

/**
 * The prose name `SCORING_RUBRIC` gives each dimension.
 *
 * Carried here rather than only inside that template string so the live
 * quality suite can check feedback headlines against the same six names the
 * model is shown. A test asserts each still appears in the rubric, so the two
 * cannot drift into a detector looking for headings nobody states.
 *
 * They are here because they leaked: a live run returned all six as feedback
 * items, verbatim, in place of findings. See the headline contract on
 * `feedback[].text` below.
 */
export const RUBRIC_DIMENSION_LABELS: Record<RubricDimension, string> = {
  impact: "Impact and quantification",
  relevance: "Relevance to the target role",
  clarity: "Clarity and concision",
  structure: "Structure and completeness",
  skills: "Skills and technologies",
  ats: "ATS-friendliness",
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
  status: StatusSchema.describe(
    `${STATUS_MEANING} For a section this follows the score you just gave it: pass at ${STATUS_THRESHOLDS.pass} and above, warn from ${STATUS_THRESHOLDS.warn} to ${STATUS_THRESHOLDS.pass - 1}, fail below ${STATUS_THRESHOLDS.warn}.`,
  ),
  note: z
    .string()
    .max(FIELD_CAPS.sectionNote)
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
    .max(FIELD_CAPS.scoreRationale)
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
    .max(FIELD_CAPS.summary)
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
        status: StatusSchema.describe(STATUS_MEANING),
        text: z
          .string()
          .max(FIELD_CAPS.feedbackText)
          .describe(
            "ONE short sentence in your own words stating what you FOUND in this resume — a finding, not a topic. Never a rubric heading, a dimension name, or a schema field name ('impact', 'Skills and technologies', 'ATS-friendliness'): those name the subject without saying anything about this document. Never a bare quote either; the quote belongs in detail. Aim for 65 characters, never exceed 85.",
          ),
        detail: z
          .string()
          .max(FIELD_CAPS.feedbackDetail)
          .describe(
            'MUST open with the exact text you are criticising, copied verbatim from the resume, then explain why it matters and what to do. If you cannot quote a specific line, do not emit this item at all. Aim for 230 characters, never exceed 285.',
          ),
      }),
    )
    .min(ARRAY_CAPS.feedbackMin)
    .max(ARRAY_CAPS.feedbackMax)
    .describe(
      "Between 3 and 8 items. Include at least one 'pass' whenever the resume has a genuine strength.",
    ),
  bulletRewrites: z
    .array(
      z.object({
        original: z
          .string()
          .max(FIELD_CAPS.rewriteOriginal)
          .describe(
            "The bullet copied verbatim from the resume. Never exceed 280 characters; if a bullet is longer than that, rewrite a different one.",
          ),
        improved: z
          .string()
          .max(FIELD_CAPS.rewriteImproved)
          .describe("The rewrite. Aim for 200 characters, never exceed 280."),
        why: z
          .string()
          .max(FIELD_CAPS.rewriteWhy)
          .describe(
            "One sentence on what the rewrite changed and why. Aim for 140 characters, never exceed 185.",
          ),
      }),
    )
    .max(ARRAY_CAPS.bulletRewrites)
    .describe(
      "Between 0 and 5 rewrites, drawn only from bullets that actually appear in the resume.",
    ),
  keywordMatch: z
    .object({
      matched: z
        .array(z.string().max(FIELD_CAPS.keyword))
        .max(ARRAY_CAPS.keywords)
        .describe(
          "Skills from the job description the resume demonstrates. At most 20, each a short skill name rather than a sentence.",
        ),
      missing: z
        .array(z.string().max(FIELD_CAPS.keyword))
        .max(ARRAY_CAPS.keywords)
        .describe(
          "Skills from the job description the resume does not show. At most 20, each a short skill name rather than a sentence.",
        ),
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
    .array(z.string().max(FIELD_CAPS.redFlag))
    .max(ARRAY_CAPS.redFlags)
    .describe(
      "Concrete problems a recruiter would notice: unexplained gaps, typos, inconsistencies. At most 6, most serious first, and empty array if none. Group problems of the same kind into ONE entry — nine misspellings are one red flag about proofreading, not nine red flags. Aim for 150 characters each, never exceed 185.",
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
  note: z.string().min(1).max(FIELD_CAPS.sectionNote),
});

export const FeedbackItemSchema = z.object({
  status: StatusSchema,
  text: z.string().min(1).max(FIELD_CAPS.feedbackText),
  detail: z.string().min(1).max(FIELD_CAPS.feedbackDetail),
});

export const BulletRewriteSchema = z.object({
  original: z.string().min(1).max(FIELD_CAPS.rewriteOriginal),
  improved: z.string().min(1).max(FIELD_CAPS.rewriteImproved),
  why: z.string().min(1).max(FIELD_CAPS.rewriteWhy),
});

export const KeywordMatchSchema = z.object({
  matched: z.array(z.string().max(FIELD_CAPS.keyword)).max(ARRAY_CAPS.keywords),
  missing: z.array(z.string().max(FIELD_CAPS.keyword)).max(ARRAY_CAPS.keywords),
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
  scoreRationale: z.string().min(1).max(FIELD_CAPS.scoreRationale),
  overallScore: z.number().int().min(0).max(100),
  verdict: VerdictSchema,
  summary: z.string().min(1).max(FIELD_CAPS.summary),
  sections: z
    .array(SectionScoreSchema)
    .length(SECTION_NAMES.length)
    .refine(
      (sections) =>
        new Set(sections.map((section) => section.name)).size ===
        SECTION_NAMES.length,
      { message: "sections must cover each of the six section names exactly once" },
    ),
  feedback: z
    .array(FeedbackItemSchema)
    .min(ARRAY_CAPS.feedbackMin)
    .max(ARRAY_CAPS.feedbackMax),
  bulletRewrites: z.array(BulletRewriteSchema).max(ARRAY_CAPS.bulletRewrites),
  keywordMatch: KeywordMatchSchema.nullable(),
  redFlags: z.array(z.string().max(FIELD_CAPS.redFlag)).max(ARRAY_CAPS.redFlags),
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
