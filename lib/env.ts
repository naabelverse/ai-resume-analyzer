import "server-only";

import { z } from "zod";

/**
 * Boot-time environment validation.
 *
 * The provider's key is checked against the *selected* provider, not blanket
 * required: running on NVIDIA must not demand an Anthropic key, and vice versa.
 * A missing key for the provider you actually selected is a boot-time failure
 * with the variable named, never a 500 at request time.
 *
 * `describeEnvProblems()` reports; it never decides. `instrumentation.ts` logs
 * what it returns and does not throw, because `register()` also runs during
 * `next build`, and a build that cannot run without a live secret is a build CI
 * cannot run at all.
 */

/**
 * A blank line in a .env file (`ANTHROPIC_API_KEY=`) sets the variable to an
 * empty string, not to nothing. Without this, `.min(1).optional()` sees a
 * present-but-empty value, fails validation, and takes the whole app down at
 * boot over a placeholder line that .env.example itself ships with.
 */
const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const EnvSchema = z
  .object({
    AI_PROVIDER: z.enum(["nvidia", "anthropic"]).default("nvidia"),
    AI_MODEL: z.string().min(1).default("nvidia/nemotron-3-super-120b-a12b"),

    /**
     * 4000, and it is a bound on a failure mode rather than room for a big
     * answer.
     *
     * It was 16384, chosen as "generous" because nothing in the schema said
     * what a large valid response actually was — `redFlags`, `bulletRewrites`
     * strings and the keyword arrays were all unbounded, so there was no number
     * to derive. Those are bounded now (see `ARRAY_CAPS` in
     * `lib/schema/analysis.ts`) and the schema's own ceiling is about 12k
     * characters, roughly 3.2k tokens. Across fifteen successful live calls the
     * largest real response was 1,645 tokens.
     *
     * The reason it matters is not cost, it is the whitespace runaway. Guided
     * JSON decoding always permits more whitespace between structural tokens, so
     * a generation can latch onto it and emit nothing else until `max_tokens`
     * stops it — measured at 16,384 tokens of which 91.9% was trailing
     * whitespace, taking 96-187s. No schema bound can prevent that; only this
     * one can. At 4000 the same runaway costs ~25-45s and comes back as
     * `finish_reason: "length"`, which `analyze.ts` already handles as a
     * `truncated` outcome and retries — instead of blowing past AI_TIMEOUT_MS
     * and surfacing as an unexplained transport failure. See the README.
     *
     * Floored at 4000 rather than defaulted to it, so lowering this further
     * cannot start truncating legitimate responses.
     */
    AI_MAX_TOKENS: z.coerce.number().int().min(4_000).default(4_000),

    /**
     * Low for repeatability. Measured effect on this model is smaller than you
     * might expect — the rubric anchors and the injected measured counts do
     * more for score stability than temperature does — but it costs nothing.
     */
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),

    /**
     * 50s, and the number is load-bearing.
     *
     * It is picked from measured latency, not chosen for comfort. Across
     * eighteen live calls the slowest request that actually SUCCEEDED took
     * 43.6s; the second slowest took 25.1s. So 50s clears the worst real
     * success with 6.4s to spare and clears everything else twice over.
     *
     * The ceiling comes from the other side: the route is capped at
     * `maxDuration` 120s, and one request can make ANALYZE_MAX_ATTEMPTS calls.
     * 2 x 50s + NON_AI_BUDGET_MS = 105s, which fits with 15s of margin. Raise
     * this past ~57s and a slow request gets killed by the platform instead of
     * degrading — the user then gets a dead connection rather than the
     * structural report. `tests/api-analyze.test.ts` asserts the arithmetic.
     */
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(50_000),

    NVIDIA_API_KEY: optionalSecret,
    NVIDIA_BASE_URL: z.url().default("https://integrate.api.nvidia.com/v1"),

    /**
     * Off by default. Reasoning arrives on a separate `reasoning_content` field
     * so it cannot corrupt the JSON parse either way — this is a cost and
     * latency decision, not a correctness one. See the README for the evidence.
     */
    NVIDIA_ENABLE_THINKING: z
      .stringbool({ truthy: ["true", "1"], falsy: ["false", "0"] })
      .default(false),
    NVIDIA_REASONING_BUDGET: z.coerce.number().int().positive().default(4_096),

    ANTHROPIC_API_KEY: optionalSecret,
    ANTHROPIC_EFFORT: z
      .enum(["low", "medium", "high", "xhigh", "max"])
      .default("medium"),

    PERSISTENCE: z.enum(["session", "db"]).default("session"),
    DATABASE_URL: optionalSecret,
  })
  /**
   * Legacy shim: ANTHROPIC_MODEL predates AI_MODEL. Honoured when the provider
   * is Anthropic and AI_MODEL was left at its default, so an existing
   * .env.local keeps working across the provider split.
   */
  .transform((env) => {
    const legacy = process.env.ANTHROPIC_MODEL;
    if (env.AI_PROVIDER === "anthropic" && legacy && !process.env.AI_MODEL) {
      return { ...env, AI_MODEL: legacy };
    }
    if (env.AI_PROVIDER === "anthropic" && !process.env.AI_MODEL) {
      return { ...env, AI_MODEL: "claude-sonnet-5" };
    }
    return env;
  });

export type Env = z.infer<typeof EnvSchema>;

/** Which env var holds the key for a given provider. */
export const PROVIDER_KEY_VAR = {
  nvidia: "NVIDIA_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
} as const;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam: forces the next getEnv() to re-read process.env. */
export function resetEnv(): void {
  cached = null;
}

/** The key for the selected provider, or undefined when it is not set. */
export function providerKey(env: Env = getEnv()): string | undefined {
  return env.AI_PROVIDER === "nvidia"
    ? env.NVIDIA_API_KEY
    : env.ANTHROPIC_API_KEY;
}

/** True when a live call to the selected provider is worth attempting. */
export function isAiConfigured(): boolean {
  return Boolean(providerKey());
}

/**
 * Human-readable problems for the startup banner. Empty array means ready.
 * Never includes a secret's value — only whether one is present.
 */
export function describeEnvProblems(): string[] {
  const problems: string[] = [];
  const env = getEnv();

  if (!providerKey(env)) {
    const variable = PROVIDER_KEY_VAR[env.AI_PROVIDER];
    problems.push(
      `AI_PROVIDER is "${env.AI_PROVIDER}" but ${variable} is not set. Every ` +
        `analysis will fall back to the automated structural checks only. Set ` +
        `${variable} in .env.local, or switch AI_PROVIDER to a provider whose ` +
        `key you do have.`,
    );
  }

  if (env.PERSISTENCE === "db" && !env.DATABASE_URL) {
    problems.push(
      "PERSISTENCE=db but DATABASE_URL is not set. Saved analyses will fall " +
        "back to session-only storage.",
    );
  }

  return problems;
}
