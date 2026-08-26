/**
 * The provider seam.
 *
 * Everything above this line is shared: the Zod schemas, the scoring rubric,
 * the system prompt, the retry loop, and the degraded path. Everything below it
 * is transport — how bytes get to a model and back. Swapping a frontier hosted
 * model for an open-weight one is a change of implementation here and nothing
 * else.
 *
 * The interface deliberately does NOT return a validated `AnalysisResult`.
 * Validation and the retry-once loop live in `analyze.ts` so both providers get
 * exactly the same treatment — if each provider validated its own output, the
 * two would drift, and the retry semantics that matter most on a weaker model
 * would be the ones most likely to be reimplemented subtly differently.
 */

export type ProviderName = "anthropic" | "nvidia";

/** Why a completion could not be used. `ok` means the text is worth parsing. */
export type CompletionOutcome =
  /** Model finished normally. */
  | "ok"
  /** Hit the token ceiling mid-output; the JSON is incomplete. */
  | "truncated"
  /** Model declined the request outright. Retrying the same prompt won't help. */
  | "refused";

export interface ProviderRequest {
  system: string;
  /**
   * User turns in order. The retry appends a second turn carrying the
   * validator's complaint and the model's own previous output.
   */
  userTurns: string[];
  /** JSON Schema for constrained decoding, derived from `AnalysisWireSchema`. */
  jsonSchema: Record<string, unknown>;
}

export interface ProviderCompletion {
  /** Assistant text with any reasoning block already separated out. */
  text: string;
  /**
   * Pre-parsed object when the provider hands back structured data directly.
   * Preferred over re-parsing `text` when present.
   */
  parsed: unknown | null;
  /**
   * The model's reasoning trace, when it emitted one and the API exposes it
   * separately. Never fed back into the conversation — kept for diagnostics.
   */
  reasoning: string | null;
  outcome: CompletionOutcome;
  /** Human-readable detail for the `truncated` / `refused` cases. */
  detail: string | null;
  elapsedMs: number;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  /**
   * Length of the assistant text BEFORE the provider trimmed it, in characters.
   *
   * `text` above is what survived `stripToJson`, which slices from the first
   * `{` to the LAST `}` and discards everything after — including the trailing
   * whitespace a runaway generation is made of. So `text.length` measured
   * against `usage.outputTokens` is a ratio between two different bodies, and
   * it reads as though the runaway were far denser than it is: one capture
   * logged 1,632 characters against 4,000 tokens, which invites the conclusion
   * "0.41 chars/token, worse than the 1.06 on record" when the true figure is
   * ~89.5% whitespace at the same rate the README already documents.
   *
   * Carrying the raw length makes the subtraction available at the point of
   * diagnosis rather than requiring it to be reasoned about afterwards.
   */
  rawChars: number;
}

export interface AnalysisProvider {
  readonly name: ProviderName;
  readonly model: string;
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
}
