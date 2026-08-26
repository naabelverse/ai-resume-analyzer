import "server-only";

import OpenAI from "openai";

import { getEnv } from "@/lib/env";
import { AiCreditsExhaustedError, AiRateLimitedError } from "@/lib/errors";
import type {
  AnalysisProvider,
  ProviderCompletion,
  ProviderRequest,
} from "@/lib/ai/types";

/**
 * NVIDIA NIM transport, via the OpenAI-compatible endpoint at
 * integrate.api.nvidia.com.
 *
 * Three things here were established by probing the live API rather than read
 * off a doc page, because NIM is OpenAI-*compatible*, not OpenAI-identical, and
 * support varies by model and by whether you self-host:
 *
 *  1. `nvext.guided_json` — which NVIDIA's own NIM docs recommend for
 *     structured output — is REJECTED with a 400 on the hosted endpoint. The
 *     error enumerates what nvext accepts there (greed_sampling, use_raw_prompt,
 *     max_thinking_tokens, cache_salt, ...) and guided_json is not among them.
 *     Those docs describe self-hosted NIM containers.
 *  2. `response_format: {type: "json_schema", strict: true}` IS enforced. Probed
 *     with a schema whose enum values were deliberately meaningless ("zeta",
 *     "kappa", "omicron"); the model returned "omicron" and added no extra keys,
 *     which a model answering freely would never do.
 *  3. Reasoning arrives on a separate `reasoning_content` field, never inline in
 *     `content`. Thinking therefore cannot corrupt the JSON parse, which makes
 *     enable_thinking a quality/cost decision rather than a correctness one.
 *
 * Even so, the shared Zod validate-and-retry loop stays in front of this. Schema
 * enforcement constrains shape, not truthfulness or the bounds Zod checks, and
 * on an open-weight model it is the retry that earns its keep.
 */

/**
 * Params NIM accepts that the OpenAI SDK's TypeScript types do not know about.
 * The SDK passes unknown body fields through untouched; this type documents
 * them instead of reaching for `any`.
 */
interface NimExtras {
  chat_template_kwargs?: { enable_thinking?: boolean; low_effort?: boolean };
  reasoning_budget?: number;
}

/**
 * The slice of the OpenAI client this provider actually uses.
 *
 * Declared as an explicit dependency rather than reached for through a
 * module-level singleton: an internal `getNvidiaClient()` call cannot be
 * intercepted by mocking this module's exports, so a test could only have
 * replaced the whole provider — and then the request shaping below, which is
 * the part most worth testing, would never run.
 */
export interface NvidiaTransport {
  chat: {
    completions: {
      create(body: unknown): Promise<OpenAI.Chat.ChatCompletion>;
    };
  };
}

interface NimMessage {
  content?: string | null;
  /** Present only when thinking is enabled. Kept out of the parsed payload. */
  reasoning_content?: string | null;
}

let cached: OpenAI | null = null;

export function getNvidiaClient(): OpenAI {
  if (cached) return cached;

  const env = getEnv();
  cached = new OpenAI({
    apiKey: env.NVIDIA_API_KEY,
    baseURL: env.NVIDIA_BASE_URL,
    // Open-weight inference on shared free-tier capacity is markedly slower
    // than a frontier hosted model, and a long resume plus a large JSON payload
    // is the slow case, not the typical one.
    timeout: env.AI_TIMEOUT_MS,
    /**
     * Zero, deliberately, and this is the setting that used to break the route.
     *
     * The SDK's timeout is PER REQUEST and it retries on timeout, so
     * `maxRetries: 2` silently multiplied it: a 90s timeout became a 270s call.
     * Measured live at 203s and 205s with `attempts=1` — the analyze-level
     * retry had not even run. Against `maxDuration` 120s that is not a slow
     * response, it is a killed request, and the user gets a dead connection
     * instead of the degraded report the app exists to give them.
     *
     * A second attempt is still made, one layer up in `analyze.ts`, where it
     * carries the validator's complaint and is counted, bounded and logged.
     * The SDK's version was none of those things.
     */
    maxRetries: 0,
  });

  return cached;
}

/** Test seam: lets the suite install a mock without touching the SDK. */
export function resetNvidiaClient(): void {
  cached = null;
}

/**
 * Some fenced or prefixed output still slips through even with schema
 * enforcement on, particularly on the retry turn. Cheap to strip, and the
 * alternative is a validation failure that costs a whole extra request.
 */
export function stripToJson(raw: string): string {
  let text = raw.trim();

  // Defensive: reasoning normally arrives on its own field, but a chat template
  // change upstream could put it inline, and that must not break the parse.
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  // Trim any prose either side of the outermost JSON object.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) text = text.slice(first, last + 1);

  return text.trim();
}

/**
 * Maps transport failures onto the app's typed errors.
 *
 * Rate limiting and credit exhaustion are split apart deliberately: they look
 * similar on the wire but mean opposite things to the person running this.
 * "Wait a minute and retry" and "your free credits are gone" must never share a
 * message, because only one of them is worth waiting for.
 */
function mapError(cause: unknown): never {
  const status = (cause as { status?: number }).status;
  const haystack = String(
    (cause as { message?: string }).message ?? cause,
  ).toLowerCase();

  const looksLikeCredits =
    status === 402 ||
    haystack.includes("credit") ||
    haystack.includes("quota") ||
    haystack.includes("insufficient funds") ||
    haystack.includes("payment required");

  if (looksLikeCredits) throw new AiCreditsExhaustedError(cause);

  if (status === 429) {
    const retryAfter = Number(
      (cause as { headers?: Record<string, string> }).headers?.["retry-after"],
    );
    throw new AiRateLimitedError(
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
      cause,
    );
  }

  throw cause;
}

export function createNvidiaProvider(
  transport?: NvidiaTransport,
): AnalysisProvider {
  const env = getEnv();
  const client = () => transport ?? getNvidiaClient();

  return {
    name: "nvidia",
    model: env.AI_MODEL,

    async complete(request: ProviderRequest): Promise<ProviderCompletion> {
      const startedAt = Date.now();

      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming &
        NimExtras = {
        model: env.AI_MODEL,
        messages: [
          { role: "system", content: request.system },
          ...request.userTurns.map((content) => ({
            role: "user" as const,
            content,
          })),
        ],
        temperature: env.AI_TEMPERATURE,
        top_p: 0.95,
        max_tokens: env.AI_MAX_TOKENS,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "resume_analysis",
            schema: request.jsonSchema,
            strict: true,
          },
        },
        chat_template_kwargs: { enable_thinking: env.NVIDIA_ENABLE_THINKING },
      };

      if (env.NVIDIA_ENABLE_THINKING) {
        body.reasoning_budget = env.NVIDIA_REASONING_BUDGET;
      }

      let response: OpenAI.Chat.ChatCompletion;
      try {
        response = await client().chat.completions.create(body);
      } catch (cause) {
        mapError(cause);
      }

      const choice = response.choices[0];
      const message = (choice?.message ?? {}) as NimMessage;
      const elapsedMs = Date.now() - startedAt;
      const usage = {
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
      };
      const reasoning = message.reasoning_content?.trim() || null;
      // Before stripToJson, which slices to the last `}` and discards the
      // trailing whitespace a runaway is made of. This is the only place
      // the size of the actual generation is still visible.
      const rawChars = (message.content ?? "").length;

      if (choice?.finish_reason === "length") {
        return {
          text: stripToJson(message.content ?? ""),
          parsed: null,
          reasoning,
          outcome: "truncated",
          detail:
            "Response hit max_tokens before the JSON was complete. Raise AI_MAX_TOKENS or lower the reasoning budget.",
          elapsedMs,
          usage,
          rawChars,
        };
      }

      // Thinking on, but no visible answer: the model spent its whole budget
      // reasoning. Reported as truncation because the remedy is the same.
      if (!message.content?.trim()) {
        return {
          text: "",
          parsed: null,
          reasoning,
          outcome: "truncated",
          detail: reasoning
            ? "Model produced a reasoning trace but no answer — the reasoning budget consumed the response."
            : "Model returned an empty response.",
          elapsedMs,
          usage,
          rawChars,
        };
      }

      return {
        text: stripToJson(message.content),
        parsed: null,
        reasoning,
        outcome: "ok",
        detail: null,
        elapsedMs,
        usage,
        rawChars,
      };
    },
  };
}
