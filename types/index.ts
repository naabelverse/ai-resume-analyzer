/**
 * The view-model types the UI is built against.
 *
 * These are no longer hand-written: they are `z.infer` re-exports of the Zod
 * schemas in `lib/schema/analysis.ts`, so the shape the model is validated
 * against and the shape the components render are the same declaration. A
 * change to the contract cannot drift from a change to the UI's idea of it.
 */

import type { ErrorCode } from "@/lib/errors";

export type {
  AnalysisResult,
  BulletRewrite,
  FeedbackItem,
  KeywordMatch,
  SectionName,
  SectionScore,
  Status,
  Verdict,
} from "@/lib/schema/analysis";

export { SECTION_NAMES, deriveVerdict } from "@/lib/schema/analysis";

import type { AnalysisResult, Status, Verdict } from "@/lib/schema/analysis";

/** Maps `verdict` to the label shown under the gauge number. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  "needs-work": "Needs work",
  good: "Good work",
  great: "Great job",
};

/** Severity order for the feedback list: actionable items first. */
export const SEVERITY_ORDER: Record<Status, number> = {
  fail: 0,
  warn: 1,
  pass: 2,
};

/** Human labels for the six fixed section names. */
export const SECTION_LABEL: Record<string, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  formatting: "Formatting",
};

/* -------------------------------------------------------------------------
   API envelope

   `meta` sits alongside `data` rather than inside it. Degradation and
   truncation are facts about how this request went, not fields of the
   analysis contract — folding them in would mean the model's schema and the
   transport's schema were the same thing, and they are not.
------------------------------------------------------------------------- */

export interface AnalysisMeta {
  /** True when the AI portion failed and only deterministic checks ran. */
  degraded: boolean;
  /**
   * Why it degraded. Null when it did not. Carried separately from `degraded`
   * so the banner can name the actual cause: "your credits ran out" and "try
   * again in a moment" are opposite instructions, and collapsing them into one
   * generic message would have someone retrying a wall.
   */
  degradedReason: ErrorCode | null;
  /** True when the resume exceeded the character cap and was clipped. */
  truncated: boolean;
  /** Per-stage wall-clock milliseconds, for the server log and the health view. */
  timings: Record<string, number>;
  pageCount: number | null;
  wordCount: number;
}

export interface AnalyzeSuccess {
  ok: true;
  data: AnalysisResult;
  meta: AnalysisMeta;
}

export interface AnalyzeFailure {
  ok: false;
  error: { code: ErrorCode; message: string };
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeFailure;

/** What the store persists. `id` is the `/analyze/[id]` route segment. */
export interface AnalysisRecord {
  id: string;
  fileName: string;
  /** ISO 8601. */
  createdAt: string;
  data: AnalysisResult;
  meta: AnalysisMeta;
}

/** Row shape for the dashboard list — no full result payload. */
export interface AnalysisSummary {
  id: string;
  fileName: string;
  createdAt: string;
  overallScore: number;
}
