import "server-only";

import { z } from "zod";

import { AiSchemaError, AiUnavailableError, AppError } from "@/lib/errors";
import {
  ARRAY_CAPS,
  AnalysisResultSchema,
  AnalysisWireSchema,
  DimensionScoresSchema,
  FIELD_CAPS,
  SECTION_NAMES,
  deriveMatchPercent,
  deriveOverallScore,
  deriveVerdict,
  type AnalysisResult,
  type DimensionScores,
  type FeedbackItem,
  type Status,
} from "@/lib/schema/analysis";
import { buildRetryTurn, buildUserTurn, SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { getProvider } from "@/lib/ai/providers";
import { statusFor } from "@/lib/scoring";
import {
  clampToWord,
  markDanglingCut,
  maskNewFigures,
  normalisePlaceholders,
  repairTruncation,
  stripLeadingMarker,
  trimToSentence,
} from "@/lib/text";
import type { AnalysisProvider, ProviderCompletion } from "@/lib/ai/types";

/**
 * Provider-agnostic analysis.
 *
 * Everything that decides *quality* lives here and is shared: the schema, the
 * rubric, the system prompt, validation, the single retry, and the decision to
 * degrade. The provider supplies bytes; this file supplies judgement. Moving
 * between a frontier hosted model and an open-weight one changes which
 * implementation `getProvider()` returns and nothing else.
 *
 * The retry matters more here than it did on Claude alone. Constrained decoding
 * fixes shape, not the bounds Zod enforces or the instruction-following an
 * open-weight model is weaker at, so the second attempt — carrying the
 * validator's complaint and the model's own previous output — is what turns a
 * near-miss into a usable result instead of a degraded report.
 */

export interface AnalyzeInput {
  resumeText: string;
  jobDescription: string | null;
  truncated: boolean;
  /** Deterministic counts, so the model states them rather than estimating. */
  facts: string;
}

/** Diagnostics for the live-verification script and the server log. */
export interface AnalyzeDiagnostics {
  provider: string;
  model: string;
  attempts: number;
  /** True when the first attempt validated without a retry. */
  firstAttemptValid: boolean;
  elapsedMs: number;
  reasoning: string | null;
  rawText: string;
  usage: ProviderCompletion["usage"];
  /**
   * The six scores the overall score was computed from. Diagnostic only — the
   * finished report carries the total, not its parts — but without them a
   * surprising score is unexplainable after the fact.
   */
  dimensions: DimensionScores | null;
}

export interface AnalyzeOutcome {
  result: AnalysisResult;
  diagnostics: AnalyzeDiagnostics;
}

/**
 * JSON Schema for constrained decoding, derived from the same Zod object the
 * result is validated against. Two hand-maintained copies would drift, and the
 * drift would show up as a validation failure nobody could explain.
 */
function wireJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AnalysisWireSchema) as Record<string, unknown>;
}

interface Attempt {
  ok: boolean;
  result?: AnalysisResult;
  reason?: string;
  completion: ProviderCompletion;
  dimensions?: DimensionScores;
}

/**
 * Applies `repairTruncation` only to values that are actually strings.
 *
 * Anything else is passed through untouched so the validator still sees — and
 * still rejects — a field of the wrong type. Repairing before validation would
 * otherwise become a way to hide a malformed response.
 */
function repair(value: unknown, limit: number): unknown {
  return typeof value === "string" ? repairTruncation(value, limit) : value;
}

/**
 * Applies `markDanglingCut` only to values that are actually strings.
 *
 * Same shape as `repair` above, and for the same reason: the wire guards check
 * that the arrays ARE arrays, not what is inside them.
 */
function markCut(value: unknown): unknown {
  return typeof value === "string" ? markDanglingCut(value) : value;
}

/** `stripLeadingMarker`, guarded the same way and for the same reason. */
function stripMarker(value: unknown): unknown {
  return typeof value === "string" ? stripLeadingMarker(value) : value;
}

/**
 * `statusFor`, guarded the same way — and deliberately yielding `undefined`
 * rather than a default when the score is not a number.
 *
 * A section whose score is malformed has no status, and the validator should
 * say so. Substituting "fail" here would invent a grade for a response that
 * never gave one, which is the failure this derivation exists to prevent,
 * arriving from the other direction.
 */
function deriveStatus(score: unknown): unknown {
  return typeof score === "number" ? statusFor(score) : undefined;
}

/** `trimToSentence` at the note cap, guarded the same way as `repair`. */
function trimNote(value: unknown): unknown {
  return typeof value === "string"
    ? trimToSentence(value, FIELD_CAPS.sectionNote)
    : value;
}

const SEVERITY: Record<Status, number> = { pass: 0, warn: 1, fail: 2 };

/**
 * Merges feedback items that share a headline (trimmed, case-insensitive)
 * into one: the first item's place and headline, the most severe status, and
 * the details joined — clamped to the detail cap, because a saved record is
 * validated again by `/api/analyses`.
 *
 * A live run returned "Only 1 of 8 experience bullets contains a measurable
 * result" seven times, one per bullet. Each item was valid, so this is a
 * repair after validation rather than a rejection: a duplicate is a cosmetic
 * defect, and rejecting it could spend the retry and degrade the whole report.
 *
 * Left alone when merging would take the list below `ARRAY_CAPS.feedbackMin`,
 * so the repaired report still satisfies the schema it was validated against.
 */
export function mergeDuplicateFeedback(items: FeedbackItem[]): FeedbackItem[] {
  const groups = new Map<string, FeedbackItem[]>();
  for (const item of items) {
    const key = item.text.trim().toLowerCase();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  if (groups.size === items.length || groups.size < ARRAY_CAPS.feedbackMin) {
    return items;
  }

  return [...groups.values()].map(([first, ...rest]) => ({
    ...first,
    status: rest.reduce<Status>(
      (worst, { status }) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
      first.status,
    ),
    detail: clampToWord(
      [first, ...rest].map(({ detail }) => detail).join(" "),
      FIELD_CAPS.feedbackDetail,
    ),
  }));
}

/**
 * The repairs that run on a VALIDATED result. Each can only make a valid report
 * better, never invalid, so none of them can trigger the retry or the fallback.
 * Returns counts for the log line; never the text.
 */
function repairValidated(result: AnalysisResult): {
  result: AnalysisResult;
  merged: number;
  masked: number;
} {
  const feedback = mergeDuplicateFeedback(result.feedback);
  const placeholders = (text: string) => text.match(/\[X\]/g)?.length ?? 0;

  let masked = 0;
  const bulletRewrites = result.bulletRewrites.map((rewrite) => {
    const maskedText = maskNewFigures(rewrite.original, rewrite.improved);
    masked += placeholders(maskedText) - placeholders(rewrite.improved);
    const improved = normalisePlaceholders(maskedText);
    if (improved === rewrite.improved) return rewrite;
    // "[X]" is longer than most figures it replaces, so re-clamp to the cap.
    return { ...rewrite, improved: clampToWord(improved, FIELD_CAPS.rewriteImproved) };
  });

  return {
    result: { ...result, feedback, bulletRewrites },
    merged: result.feedback.length - feedback.length,
    masked,
  };
}

async function attempt(
  provider: AnalysisProvider,
  system: string,
  userTurns: string[],
): Promise<Attempt> {
  const completion = await provider.complete({
    system,
    userTurns,
    jsonSchema: wireJsonSchema(),
  });

  // A refusal is terminal: the same prompt will be refused again, so it goes
  // straight to the degraded path rather than burning a retry.
  if (completion.outcome === "refused") {
    throw new AiUnavailableError(new Error(completion.detail ?? "Model refused."));
  }

  if (completion.outcome === "truncated") {
    return {
      ok: false,
      reason:
        `${completion.detail ?? "Response was truncated."} Be significantly ` +
        "more concise: shorter notes, shorter details, fewer rewrites.",
      completion,
    };
  }

  let payload: unknown = completion.parsed;
  if (payload === null) {
    try {
      payload = JSON.parse(completion.text);
    } catch (cause) {
      // Position only. `JSON.parse` messages can quote a fragment of the
      // output, and this reason is logged.
      const at = /position \d+/.exec(String(cause))?.[0];
      return {
        ok: false,
        reason: `Output was not valid JSON${at ? ` (${at})` : ""}.`,
        completion,
      };
    }
  }

  // Narrow before deriving. `null` is the legitimate no-job-description case
  // and must pass straight through; anything else malformed is left alone so
  // `AnalysisResultSchema` below reports it, rather than being papered over
  // with a percentage computed from arrays that were not there.
  const isWireKeywordMatch = (
    value: unknown,
  ): value is { matched: string[]; missing: string[] } =>
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { matched?: unknown }).matched) &&
    Array.isArray((value as { missing?: unknown }).missing);

  // The wire format keys sections by name so all six are structurally
  // guaranteed; the UI wants them ordered, so flatten here.
  const wire = payload as {
    dimensions?: unknown;
    scoreRationale?: unknown;
    summary?: unknown;
    sections?: Record<string, object>;
    feedback?: unknown;
    bulletRewrites?: unknown;
    redFlags?: unknown;
    keywordMatch?: unknown;
  };
  let notesTrimmed = 0;
  const sections = wire.sections
    ? SECTION_NAMES.map((name) => {
        const body = wire.sections![name] as { score?: unknown; note?: unknown };
        const note = trimNote(body.note);
        if (note !== body.note) notesTrimmed += 1;
        return {
          name,
          ...body,
          // Derived, never taken from the model — the rule `verdict` follows,
          // for the reason `verdict` follows it. The spread comes first so a
          // `status` an older prompt or a stray response still supplies is
          // OVERWRITTEN rather than merged: a field the model fills and the
          // code discards is the next person's confusion.
          status: deriveStatus(body.score),
          // Back to the last complete sentence when the decoder cut it, which
          // reads better in a note than `repair`'s mid-thought ellipsis.
          note,
        };
      })
    : undefined;

  // The score is computed here, never read from the model — the same rule
  // `verdict` follows, and for the same reason. Validated separately from the
  // result because `AnalysisResultSchema` describes the finished report, and
  // that has no `dimensions` field: by the time it runs, the six numbers have
  // already become one.
  const dimensions = DimensionScoresSchema.safeParse(wire.dimensions);
  if (!dimensions.success) {
    return {
      ok: false,
      reason: `dimensions: ${z.prettifyError(dimensions.error)}`,
      completion,
    };
  }
  const overallScore = deriveOverallScore(dimensions.data);

  // Constrained decoding guaranteed the shape; this checks the bounds it cannot
  // enforce, and re-checks the ones it should have.
  const validated = AnalysisResultSchema.safeParse({
    ...wire,
    scoreRationale: repair(wire.scoreRationale, FIELD_CAPS.scoreRationale),
    summary: repair(wire.summary, FIELD_CAPS.summary),
    feedback: Array.isArray(wire.feedback)
      ? wire.feedback.map((item) => {
          const entry = item as { text?: unknown; detail?: unknown };
          return {
            ...entry,
            text: repair(entry.text, FIELD_CAPS.feedbackText),
            // Repair BEFORE stripping, not after. `repairTruncation` decides
            // "was this cut?" by how close the length sits to the cap, so it
            // has to see the string the decoder actually produced — strip
            // first and a marker's two characters could carry a cut detail out
            // of the suspicion window and lose its ellipsis. Stripping only
            // ever shortens, so this order is safe in the other direction.
            detail: stripMarker(repair(entry.detail, FIELD_CAPS.feedbackDetail)),
          };
        })
      : wire.feedback,
    // Bounded in the schema as of the runaway fix, so the decoder can now cut
    // them mid-word too — and a cut `original` that still claims to be the
    // candidate's bullet verbatim is the worst version of that. Marked, like
    // every other field the decoder can reach.
    bulletRewrites: Array.isArray(wire.bulletRewrites)
      ? wire.bulletRewrites.map((item) => {
          const entry = item as {
            original?: unknown;
            improved?: unknown;
            why?: unknown;
          };
          return {
            ...entry,
            original: repair(entry.original, FIELD_CAPS.rewriteOriginal),
            improved: repair(entry.improved, FIELD_CAPS.rewriteImproved),
            why: repair(entry.why, FIELD_CAPS.rewriteWhy),
          };
        })
      : wire.bulletRewrites,
    redFlags: Array.isArray(wire.redFlags)
      ? wire.redFlags.map((flag) => repair(flag, FIELD_CAPS.redFlag))
      : wire.redFlags,
    // Computed here for the reason `verdict` two lines down and the section
    // statuses above it are: it is a function of the two arrays, so asking the
    // model for it created a second source that could disagree — and did,
    // rendering a 5-of-11 match as 40%. The wire schema no longer carries the
    // field, so there is nothing left to disagree with.
    // Marked like every other field the decoder can reach, and this one was
    // the last that was not. `FIELD_CAPS.keyword` is on the wire schema, so a
    // strict decoder stops a long term at exactly 60 characters mid-word —
    // "Minimum 3 years post-registration experience in an acute inp" is a real
    // capture — and a pill has no `line-clamp` to hide behind, so what the
    // decoder cut is exactly what renders. Three of seven terms in the nursing
    // measurement arrived that way.
    //
    // This DOES occasionally shorten a term the decoder never cut, and the
    // case is measured rather than hypothetical: "Experience with electronic
    // medical records documentation" is 56 characters, complete, and comes
    // back as "Experience with electronic medical records…". `SUSPICION_WINDOW`
    // is an absolute 5 characters, which is 1.25% of `feedbackDetail` and 8.3%
    // of this cap — the heuristic was sized against fields three to seven times
    // longer. It is left shared anyway: a per-field window is new machinery for
    // one observed case, and at 56 characters that string is a copied
    // requirement whichever end of it you lose. Worth knowing before trusting a
    // keyword ellipsis to mean the model was cut off.
    //
    // `matchPercent` counts the arrays, so repairing before or after it makes
    // no difference to the number. It goes before anyway, so the two lists the
    // percentage describes are the two lists that render.
    keywordMatch: isWireKeywordMatch(wire.keywordMatch)
      ? {
          // `markCut` AFTER `repair`, and it is a second pass rather than a
          // wider suspicion window because the two answer different questions.
          // `repair` asks "did the decoder stop here?", which only length can
          // tell it. `markCut` asks "does this end mid-phrase?", which only the
          // words can. A term cut well short of the cap — 52 characters against
          // 60, dangling on "and" — is invisible to the first and obvious to
          // the second. Widening the window instead would start rewriting
          // complete short terms, which is the failure this pass avoids.
          //
          // After, not before, so `repair` sees the string the decoder actually
          // produced: an ellipsis added first would read as terminal
          // punctuation and stop the repair it was meant to follow.
          matched: wire.keywordMatch.matched.map((term) =>
            markCut(repair(term, FIELD_CAPS.keyword)),
          ),
          missing: wire.keywordMatch.missing.map((term) =>
            markCut(repair(term, FIELD_CAPS.keyword)),
          ),
          matchPercent: deriveMatchPercent(
            wire.keywordMatch.matched,
            wire.keywordMatch.missing,
          ),
        }
      : wire.keywordMatch,
    sections,
    overallScore,
    verdict: deriveVerdict(overallScore),
  });

  if (!validated.success) {
    return { ok: false, reason: z.prettifyError(validated.error), completion };
  }

  const repaired = repairValidated(validated.data);
  console.info(
    `[analyze] repairs: notesTrimmed=${notesTrimmed} duplicateHeadlinesMerged=${repaired.merged} figuresMasked=${repaired.masked}`,
  );

  return { ok: true, result: repaired.result, completion, dimensions: dimensions.data };
}

/** Wraps transport failures, letting the app's own typed errors through. */
function rethrow(cause: unknown): never {
  if (cause instanceof AppError) throw cause;
  throw new AiUnavailableError(cause);
}

/**
 * The terminal failure, logged with enough to diagnose it — and, like the rest
 * of this pipeline, never the model's response text.
 *
 * This path logs more than any other because it is the end of the line:
 * `AiSchemaError` degrades the report, and
 * the reason for the SECOND failure was previously never written down
 * anywhere. A production run degraded with `AI_SCHEMA` and left behind only
 * the code itself — enough to say validation failed twice, not enough to say
 * which field or why, and not enough to tell a schema mismatch apart from the
 * whitespace runaway that produces the same code. It cost a full session to
 * reproduce something one line of output would have answered.
 *
 * What it prints, and why each part earns its place:
 *
 *   - Both validator complaints, in FULL. Attempt 1's is already logged for
 *     the ordinary retry but sliced to 400 characters, which cuts exactly the
 *     field list you need when the retry then fails too.
 *   - Token counts and body lengths. These separate the two causes without
 *     reading the body at all: a runaway is thousands of tokens at roughly one
 *     character each, a schema mismatch is an ordinary-sized body with the
 *     wrong content in it.
 *
 * The raw body is NOT printed. It used to be, unsliced, and that leaked resume
 * content: `detail` is required to open with a verbatim quote, so the
 * candidate's own words reached the log. The validator complaints name the
 * fields that failed and the lengths separate a runaway from a mismatch, which
 * is what the body was there to tell apart. To read a body, reproduce the run
 * with `pnpm test:live`, which prints it locally.
 */
function logTerminalFailure(
  provider: AnalysisProvider,
  first: Attempt,
  second: Attempt,
): void {
  const shape = ({ completion }: Attempt) => {
    // Both lengths, always. `chars` is post-strip; `raw` is what the model
    // actually generated. Dividing `chars` by output tokens is the mistake
    // this line exists to prevent, and it was made the first time this
    // diagnostic printed anything: 1,632 chars against 4,000 tokens reads as
    // 0.41 chars/token — denser than any runaway on record — when the body
    // being counted had already had ~89.5% of itself stripped away.
    const stripped = completion.rawChars - completion.text.length;
    return (
      `outcome=${completion.outcome} chars=${completion.text.length} ` +
      `raw=${completion.rawChars} stripped=${stripped} ` +
      `tokens=${JSON.stringify(completion.usage)}`
    );
  };

  console.error(
    `[analyze] ${provider.name} failed validation twice — degrading.\n` +
      `  model    : ${provider.model}\n` +
      `  attempt 1: ${shape(first)}\n` +
      `             ${first.reason ?? "(no reason recorded)"}\n` +
      `  attempt 2: ${shape(second)}\n` +
      `             ${second.reason ?? "(no reason recorded)"}`,
  );
}

export async function analyzeResumeWithDiagnostics(
  input: AnalyzeInput,
): Promise<AnalyzeOutcome> {
  const provider = getProvider();
  const startedAt = Date.now();
  const firstTurn = buildUserTurn(input);

  let first: Attempt;
  try {
    first = await attempt(provider, SYSTEM_PROMPT, [firstTurn]);
  } catch (cause) {
    rethrow(cause);
  }

  const base = {
    provider: provider.name,
    model: provider.model,
    reasoning: first.completion.reasoning,
    rawText: first.completion.text,
    usage: first.completion.usage,
    dimensions: first.dimensions ?? null,
  };

  if (first.ok && first.result) {
    return {
      result: first.result,
      diagnostics: {
        ...base,
        attempts: 1,
        firstAttemptValid: true,
        elapsedMs: Date.now() - startedAt,
      },
    };
  }

  console.warn(
    `[analyze] ${provider.name} attempt 1 failed validation, retrying once: ${(first.reason ?? "").slice(0, 400)}`,
  );

  let second: Attempt;
  try {
    second = await attempt(provider, SYSTEM_PROMPT, [
      firstTurn,
      buildRetryTurn(first.reason ?? "", first.completion.text || null),
    ]);
  } catch (cause) {
    rethrow(cause);
  }

  if (!second.ok || !second.result) {
    logTerminalFailure(provider, first, second);
    throw new AiSchemaError(new Error(second.reason ?? "Validation failed twice."));
  }

  return {
    result: second.result,
    diagnostics: {
      ...base,
      reasoning: second.completion.reasoning,
      rawText: second.completion.text,
      usage: second.completion.usage,
      dimensions: second.dimensions ?? null,
      attempts: 2,
      firstAttemptValid: false,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

export async function analyzeResume(
  input: AnalyzeInput,
): Promise<AnalysisResult> {
  return (await analyzeResumeWithDiagnostics(input)).result;
}
