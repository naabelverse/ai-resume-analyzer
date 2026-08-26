import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { getEnv } from "@/lib/env";
import { AnalysisWireSchema } from "@/lib/schema/analysis";
import type {
  AnalysisProvider,
  ProviderCompletion,
  ProviderRequest,
} from "@/lib/ai/types";

/**
 * Anthropic transport — unchanged in behaviour from before the provider split.
 *
 * Kept working even though the app currently runs on NVIDIA: this is the
 * implementation that proves the seam is real. If it had been deleted "since
 * we're not using it", the interface would quietly become a single-provider
 * wrapper and the abstraction would rot within a week.
 *
 * Uses `messages.parse` with `zodOutputFormat`, which constrains decoding
 * against the wire schema and returns a typed object — so `parsed` is populated
 * and the shared layer never has to re-parse a string.
 */

/**
 * The slice of the Anthropic client this provider uses. Injected for the same
 * reason as the NVIDIA one — see the note there.
 */
export interface AnthropicTransport {
  messages: {
    parse(body: unknown): Promise<{
      stop_reason?: string | null;
      stop_details?: { category?: string | null } | null;
      content: Array<{ type: string; text?: string }>;
      parsed_output?: unknown;
      usage?: { input_tokens?: number; output_tokens?: number } | null;
    }>;
  };
}

let cached: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (cached) return cached;

  cached = new Anthropic({
    apiKey: getEnv().ANTHROPIC_API_KEY,
    // Milliseconds in the TypeScript SDK — seconds in the Python one.
    timeout: getEnv().AI_TIMEOUT_MS,
    // Zero for the same reason as NVIDIA: the SDK retries on timeout, which
    // turns a bounded per-request timeout into an unbounded call. Both
    // providers share AI_TIMEOUT_MS, so both shared the bug. Retrying is
    // `analyze.ts`'s job, where it is counted and bounded.
    maxRetries: 0,
  });

  return cached;
}

/** Test seam: lets the suite install a mock without touching the SDK. */
export function resetAnthropicClient(): void {
  cached = null;
}

export function createAnthropicProvider(
  transport?: AnthropicTransport,
): AnalysisProvider {
  const env = getEnv();
  const client = (): AnthropicTransport => transport ?? getAnthropicClient();

  return {
    name: "anthropic",
    model: env.AI_MODEL,

    async complete(request: ProviderRequest): Promise<ProviderCompletion> {
      const startedAt = Date.now();

      const response = await client().messages.parse({
        model: env.AI_MODEL,
        max_tokens: env.AI_MAX_TOKENS,
        system: request.system,
        output_config: {
          effort: env.ANTHROPIC_EFFORT,
          // The wire schema, not the JSON Schema the request carries: the
          // Anthropic SDK wants the Zod object itself.
          format: (
            await import("@anthropic-ai/sdk/helpers/zod")
          ).zodOutputFormat(AnalysisWireSchema),
        },
        messages: request.userTurns.map((content) => ({
          role: "user" as const,
          content,
        })),
        // Never send temperature, top_p, top_k, or thinking.budget_tokens on
        // claude-sonnet-5 — each one is a 400. Thinking is adaptive by default
        // and its tokens count against max_tokens.
      });

      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      const elapsedMs = Date.now() - startedAt;
      const usage = {
        inputTokens: response.usage?.input_tokens ?? null,
        outputTokens: response.usage?.output_tokens ?? null,
      };

      if (response.stop_reason === "refusal") {
        return {
          text: "",
          parsed: null,
          reasoning: null,
          outcome: "refused",
          detail: `Model declined the request (${response.stop_details?.category ?? "unspecified"}).`,
          elapsedMs,
          usage,
          // This transport does not strip, so raw and post-strip agree. Still
          // populated rather than made optional: a diagnostic present on one
          // provider and absent on the other is one nobody trusts on either.
          rawChars: text.length,
        };
      }

      if (response.stop_reason === "max_tokens") {
        return {
          text,
          parsed: null,
          reasoning: null,
          outcome: "truncated",
          detail: "Response hit the token ceiling before the JSON was complete.",
          elapsedMs,
          usage,
          // This transport does not strip, so raw and post-strip agree. Still
          // populated rather than made optional: a diagnostic present on one
          // provider and absent on the other is one nobody trusts on either.
          rawChars: text.length,
        };
      }

      return {
        text,
        parsed: response.parsed_output ?? null,
        reasoning: null,
        outcome: "ok",
        detail: null,
        elapsedMs,
        usage,
        // This transport does not strip, so raw and post-strip agree. Still
        // populated rather than made optional: a diagnostic present on one
        // provider and absent on the other is one nobody trusts on either.
        rawChars: text.length,
      };
    },
  };
}
