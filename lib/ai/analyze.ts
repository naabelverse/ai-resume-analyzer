import "server-only";

import { z } from "zod";

import { AiSchemaError, AiUnavailableError, AppError } from "@/lib/errors";
import {
  AnalysisResultSchema,
  AnalysisWireSchema,
  DimensionScoresSchema,
  FIELD_CAPS,
  SECTION_NAMES,
  deriveOverallScore,
  deriveVerdict,
  type AnalysisResult,
  type DimensionScores,
} from "@/lib/schema/analysis";
import { buildRetryTurn, buildUserTurn, SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { getProvider } from "@/lib/ai/providers";
import { repairTruncation } from "@/lib/text";
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
      return {
        ok: false,
        reason: `Output was not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
        completion,
      };
    }
  }

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
  };
  const sections = wire.sections
    ? SECTION_NAMES.map((name) => ({
        name,
        ...wire.sections![name],
        note: repair(
          (wire.sections![name] as { note?: unknown }).note,
          FIELD_CAPS.sectionNote,
        ),
      }))
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
            detail: repair(entry.detail, FIELD_CAPS.feedbackDetail),
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
    sections,
    overallScore,
    verdict: deriveVerdict(overallScore),
  });

  if (!validated.success) {
    return { ok: false, reason: z.prettifyError(validated.error), completion };
  }

  return { ok: true, result: validated.data, completion, dimensions: dimensions.data };
}

/** Wraps transport failures, letting the app's own typed errors through. */
function rethrow(cause: unknown): never {
  if (cause instanceof AppError) throw cause;
  throw new AiUnavailableError(cause);
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
