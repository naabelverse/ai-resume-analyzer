import {
  RUBRIC_DIMENSIONS,
  RUBRIC_DIMENSION_LABELS,
  SECTION_NAMES,
} from "@/lib/schema/analysis";
import type { AnalysisResult, DimensionScores } from "@/lib/schema/analysis";
/* ------------------------------------------------------ headline leakage -- */

/**
 * A feedback headline that names a category instead of stating a finding.
 *
 * `feedback[].text` is what the UI renders as the headline, and it was the one
 * free-text field the system prompt never mentioned: RULE 1 governed `detail`
 * and gave it worked GOOD/BAD examples, while `text` had eight words of schema
 * description and no example anywhere. Live runs filled it with whatever
 * taxonomy was nearest — the six rubric headings verbatim in one run, the
 * schema's own key names ("impact", "relevance", "clarity") in another, with
 * `detail` reduced to a bare quote.
 *
 * Nothing caught it. Those runs validated on the FIRST attempt, because the
 * only constraint on `text` is its length, and the live metric of the day read
 * `detail` alone: it reported "5/5 feedback items quote the resume" on a run
 * whose every headline was a JSON key.
 *
 * This lives here rather than in the live suite so it can be unit-tested
 * offline. A detector that quietly stops detecting is the exact failure it was
 * written to catch.
 */

/**
 * Letters and digits only, with "the" dropped.
 *
 * The leak is not always verbatim. The production run that prompted this
 * returned "Relevance to target role" where the rubric says "Relevance to the
 * target role", and an exact comparison would have missed it. Equality after
 * normalising is still a tight test: every forbidden term is under 30
 * characters, while a real headline is asked to run to about 65.
 */
function normaliseHeadline(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0 && word !== "the")
    .join("");
}

/** Every name in front of the model that is a topic rather than a finding. */
const FORBIDDEN_HEADLINES = new Set(
  [
    ...SECTION_NAMES,
    ...RUBRIC_DIMENSIONS,
    ...Object.values(RUBRIC_DIMENSION_LABELS),
    // The wire schema's own field names, which is what one run reached for:
    // they are generated immediately before `feedback`, so they are the
    // freshest list in context when the first headline has to be written.
    "scoreRationale",
    "dimensions",
    "summary",
    "sections",
    "feedback",
    "bulletRewrites",
    "keywordMatch",
    "redFlags",
    "status",
    "text",
    "detail",
  ].map(normaliseHeadline),
);

/** The subset of `texts` that name a category instead of stating a finding. */
export function leakedHeadlines(texts: string[]): string[] {
  return texts.filter((text) => FORBIDDEN_HEADLINES.has(normaliseHeadline(text)));
}
/* --------------------------------------------------- headline restatement -- */

/**
 * How much of the shorter string's vocabulary the longer one repeats.
 *
 * A `detail` that restates its own headline wastes the only two fields an item
 * has, and the expanded row then says nothing the collapsed row did not. This
 * is deliberately crude — a set overlap of content words, order ignored —
 * because it is a screening statistic printed beside a distribution, not a
 * judgement about writing quality.
 *
 * Words of three characters or fewer are dropped so that "the", "and" and "of"
 * do not manufacture agreement between two unrelated sentences. Dividing by the
 * SMALLER set matters: `detail` is allowed to be four times longer than `text`,
 * and dividing by the union would score a genuine restatement low simply
 * because the detail went on to add advice.
 */
export function restatementOverlap(text: string, detail: string): number {
  const words = (value: string) =>
    new Set(
      value
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, " ")
        .split(/\s+/)
        .filter((word) => word.length > 3),
    );

  const a = words(text);
  const b = words(detail);
  if (a.size === 0 || b.size === 0) return 0;

  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

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
