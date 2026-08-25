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
/* ------------------------------------------------- detail ends at quote -- */

/**
 * A `detail` that quotes the resume and then stops.
 *
 * RULE 1 asks `detail` to begin at the quote and go on to the evidence, what it
 * costs the candidate, and what to change. On a warn or a fail the model does
 * the first half and stops, so the headline says something should change and
 * the field underneath it does not say to what. From production, on a warn:
 *
 *   text:   "Your summary could open with your most impressive metric to grab
 *            attention faster."
 *   detail: "Backend engineer with six years building payment and settlement
 *            systems for high-volume marketplaces in Southeast Asia."
 *
 * `restatementOverlap` cannot see this. That pair scores 0.14 — the detail and
 * the headline share one content word, because the detail is not the headline
 * again, it is the RESUME again. The two failures look alike in the UI and are
 * opposite in the data, which is why this needs its own detector rather than a
 * lower threshold on the old one.
 *
 * On a `pass` item the same shape is correct: there the quote IS the evidence,
 * and a strength does not need a fix appended to it. Callers must filter to
 * warn and fail BEFORE calling `endsAtQuote` — the predicate deliberately does
 * not know the status, so that the one place the exception lives is the caller
 * where it can be seen.
 */

/** Lowercase, alphanumeric, single-spaced. Applied identically to both sides. */
function contentWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 0);
}

/**
 * How many consecutive words must match before a run counts as a quotation.
 *
 * Below four, ordinary English collides: "the team", "and the", "for the" all
 * appear in any resume, and crediting them as quoted would eat the model's own
 * advice and report a clean detail as a bare quote. A detail shorter than this
 * is exempted (see `minRun` below) so that a two-word field lifted verbatim
 * still scores zero rather than escaping through the floor.
 */
const MIN_QUOTE_RUN = 4;

/**
 * How many words of its own a `detail` may have and still count as stopping at
 * the quote.
 *
 * Not zero. The production case is the whole field lifted verbatim, which
 * scores zero — but `Your summary reads "..."` is the same failure with a
 * three-word lead-in, and an equality test would wave it through. Three is also
 * the most that normalisation slop can account for on its own: a curly
 * apostrophe, the decoder's `…`, a word the model re-cased or pluralised.
 *
 * It is well short of a clause. "Say what changed and by how much" is seven
 * words; "Lead with the settlement volume instead" is six. Nothing that carries
 * an instruction fits in three.
 *
 * What this therefore UNDER-counts, stated so nobody reads a low number as a
 * clean one: a bare quote behind a four-word lead-in — "Your summary currently
 * reads ..." — escapes. Raising the allowance to catch it would start admitting
 * real advice ("Name the volume instead" is four words), and a detector that
 * fires on good output stops being run. Measured against middling.txt the
 * three-word lead-in lands at exactly three, so this boundary is tight rather
 * than comfortable, and the number it produces is a floor on the true rate.
 */
const MAX_OWN_WORDS = 3;

/**
 * Splits a `detail` into what the resume accounts for and what the model wrote.
 *
 * Walks the detail once, and at each position takes the LONGEST run of
 * consecutive words the resume contains verbatim. Runs are contiguous by
 * construction, which is the property that matters: advice reusing a word from
 * the resume — "settlement", "latency" — is scattered rather than consecutive,
 * so it stays counted as the model's own and does not deflate the number.
 *
 * Greedy across the whole field rather than one quote at a time, so a detail
 * that quotes twice and says nothing between is still recognised. A single
 * longest-run subtraction would have credited one quote, counted the other as
 * original prose, and reported the item clean.
 */
export function quoteCoverage(
  detail: string,
  resumeText: string,
): { fromResume: number; ownWords: number } {
  const words = contentWords(detail);
  if (words.length === 0) return { fromResume: 0, ownWords: 0 };

  // Padded with spaces at both ends so `includes` matches whole words only:
  // without them "six years" would match inside "sixty yearsend".
  const haystack = ` ${contentWords(resumeText).join(" ")} `;
  const minRun = Math.min(MIN_QUOTE_RUN, words.length);

  let fromResume = 0;
  let ownWords = 0;
  let index = 0;

  while (index < words.length) {
    let end = index;
    while (
      end < words.length &&
      haystack.includes(` ${words.slice(index, end + 1).join(" ")} `)
    ) {
      end += 1;
    }

    if (end - index >= minRun) {
      fromResume += end - index;
      index = end;
    } else {
      ownWords += 1;
      index += 1;
    }
  }

  return { fromResume, ownWords };
}

/**
 * Whether this `detail` quotes the resume and then stops.
 *
 * Requires that a quote was actually FOUND, not merely that little original
 * prose is present. Without that clause "Add more detail." scores three own
 * words and would be counted here — but that is generic advice with no quote at
 * all, a different failure that RULE 1's last paragraph governs and that this
 * number would silently absorb.
 */
export function endsAtQuote(detail: string, resumeText: string): boolean {
  const { fromResume, ownWords } = quoteCoverage(detail, resumeText);
  return fromResume > 0 && ownWords <= MAX_OWN_WORDS;
}
/* -------------------------------------------------------------- fixtures -- */

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
