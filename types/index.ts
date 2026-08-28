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

/**
 * Maps `verdict` to the label shown under the gauge number.
 *
 * Rewritten when the gauge moved onto `STATUS_THRESHOLDS`. The old set was
 * calibrated for 85/60 and could not survive the move:
 *
 * - "Good work" for the middle band. That band now opens at 50, and the rubric
 *   calls 40-59 "a real weakness a reviewer would notice". Praising it is the
 *   overclaim the whole unification was meant to remove.
 * - "Needs work" for the BOTTOM band — while `STATUS_LABEL` in
 *   `<SectionBreakdown>` uses the identical phrase for its MIDDLE one. One
 *   phrase naming two different grades in one report is the same defect as two
 *   sets of thresholds, just spelled in words instead of numbers.
 *
 * So the rule here is: no word may name two bands. Different words for the
 * same band are fine — a badge on a section row and a headline addressed to a
 * candidate are allowed to differ in register — but "Strong", "Needs work" and
 * "Poor" each mean exactly one thing across the report. "Strong" is the
 * rubric's own word for 75-89, which is what the top band now is.
 */
export const VERDICT_LABEL: Record<Verdict, string> = {
  "needs-work": "Poor",
  good: "Needs work",
  great: "Strong",
};

/**
 * The gauge ring's stroke, keyed by the same `verdict` the label is.
 *
 * One lookup key for both means the colour and the words cannot disagree —
 * the failure `4a99c2e` fixed for section rows, arriving on a different
 * channel. Same green/amber/red as `BAR_TONE` in `<SectionBreakdown>`, because
 * the ring is reporting the same kind of fact.
 *
 * It carried a blue-purple brand gradient until this commit, which left the
 * one number the page exists to deliver as the only status in the report that
 * did not state its status in colour. The gradient is still right everywhere
 * it is decoration; here it was carrying information and saying nothing.
 */
export const VERDICT_TONE: Record<Verdict, string> = {
  "needs-work": "var(--danger)",
  good: "var(--warning)",
  great: "var(--success)",
};

/**
 * The dashboard score badge, keyed by the same `verdict` as the ring and the
 * label. A third entry on one key, for the reason the first two share: the
 * badge cannot disagree with the gauge about a score, because it decides
 * nothing — it looks up what `deriveVerdict` already decided.
 *
 * A separate map from `VERDICT_TONE` rather than a reuse of it, because the
 * two answer different questions. `VERDICT_TONE` is one raw colour for an SVG
 * stroke; this is a background/foreground PAIR whose foreground is deliberately
 * NOT the colour the ring strokes with. A status fill read as type on its own
 * tint measures 2.07:1 (success) and 3.30:1 (danger); the `*-ink` variants in
 * `globals.css` exist for exactly that, and the badge being replaced here was
 * already AA at 4.69:1. Making it informative must not make it unreadable.
 *
 * Why `deriveVerdict` and not `statusFor`: the boundaries are identical, both
 * being `STATUS_THRESHOLDS`, but `statusFor` lives in `lib/scoring.ts`, which
 * imports `lib/text.ts`, which is `server-only`. `<HistoryList>` is a client
 * component, so `deriveVerdict` is the one of the two that can cross that
 * boundary. Same numbers, same single source, importable from the client.
 */
export const VERDICT_BADGE: Record<Verdict, string> = {
  "needs-work": "bg-danger-tint text-danger-ink",
  good: "bg-warning-tint text-warning-ink",
  great: "bg-success-tint text-success-ink",
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

/**
 * The failure half of every JSON envelope in the app, not just the analyse
 * one. Two endpoints returning two differently-shaped failures would mean two
 * client-side branches for what is the same event: the server refused, and
 * `ERROR_COPY` already knows what to say about it.
 */
export interface ApiFailure {
  ok: false;
  error: { code: ErrorCode; message: string };
}

export type AnalyzeResponse = AnalyzeSuccess | ApiFailure;

/* -------------------------------------------------------------------------
   Extraction preview

   What `/api/extract` returns for the panel that replaces the drop target.
   It is the output of the same `extractResume` the analyse route runs — the
   text here is the text the model will be given, not an approximation of it,
   which is the only reason showing it is worth a round trip.
------------------------------------------------------------------------- */

export interface ExtractPreview {
  kind: "pdf" | "docx";
  /** Normalised and already truncated — exactly what would be sent. */
  text: string;
  /** Null for DOCX, which has no page count until something renders it. */
  pageCount: number | null;
  truncated: boolean;
  /**
   * Length after normalisation but BEFORE truncation, so the preview can say
   * how much was dropped rather than only that something was.
   */
  charCount: number;
}

export interface ExtractSuccess {
  ok: true;
  data: ExtractPreview;
}

export type ExtractResponse = ExtractSuccess | ApiFailure;

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
  /**
   * Whether the AI portion failed on this run, so `<HistoryList>` can stop the
   * row asserting a grade nothing earned.
   *
   * `95ae0c9` suppressed every grade on the report page when degraded; the
   * dashboard was still listing the same number one route over, in a
   * brand-tinted badge, with no banner beside it to explain — strictly worse
   * than the page it was fixed on, because there the number had context.
   *
   * Optional, and read defensively, because a summary is a CACHE of the record
   * rather than a second source for it. The session index was written without
   * this field until now, and an entry predating it must not read as a healthy
   * run: `undefined` means "not known", never "false". Both stores resolve it
   * from the record's own `meta`, which has carried `degraded` for as long as
   * the field has existed — so nothing stored needed migrating for this.
   */
  degraded?: boolean;
}

/* -------------------------------------------------------------------------
   Feedback

   `/api/feedback` returns no data — the whole result is whether the message
   was sent. It shares `ApiFailure` with the other two endpoints, so the form's
   failure branch is the same shape as the analyse form's and `ERROR_COPY`
   already knows what to say about every code it can carry.
------------------------------------------------------------------------- */

export interface FeedbackSuccess {
  ok: true;
}

export type FeedbackResponse = FeedbackSuccess | ApiFailure;
