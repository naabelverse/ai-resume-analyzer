import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Environment resolution.
 *
 * The rule these protect: the key is required for the provider you *selected*,
 * not blanket-required. Running on NVIDIA must never demand an Anthropic key,
 * and a missing key must be a named boot-time report rather than a 500 at
 * request time.
 */

const SAVED = { ...process.env };

beforeEach(() => {
  for (const key of [
    "AI_PROVIDER",
    "AI_MODEL",
    "NVIDIA_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL",
    "PERSISTENCE",
  ]) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...SAVED };
});

async function env() {
  const mod = await import("@/lib/env");
  mod.resetEnv();
  return mod;
}

describe("provider key resolution", () => {
  it("names the missing variable for the selected provider", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.NVIDIA_API_KEY = "nvapi-present-but-wrong-provider";

    const { describeEnvProblems, isAiConfigured } = await env();
    const problems = describeEnvProblems().join(" ");

    expect(isAiConfigured()).toBe(false);
    expect(problems).toContain("ANTHROPIC_API_KEY");
    // Never echo a secret's value, not even one belonging to another provider.
    expect(problems).not.toContain("nvapi-");
  });

  it("does not demand an Anthropic key when running on NVIDIA", async () => {
    process.env.AI_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "nvapi-fake";

    const { describeEnvProblems, isAiConfigured } = await env();

    expect(isAiConfigured()).toBe(true);
    expect(describeEnvProblems()).toEqual([]);
  });

  it("treats a blank value as absent rather than as invalid", async () => {
    // `ANTHROPIC_API_KEY=` in a .env file sets an empty string, not nothing.
    // Rejecting it took the whole app down at boot over a placeholder line
    // that .env.example itself ships with.
    process.env.AI_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "nvapi-fake";
    process.env.ANTHROPIC_API_KEY = "";

    const { getEnv } = await env();

    expect(() => getEnv()).not.toThrow();
    expect(getEnv().ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("defaults the model per provider and never hardcodes it in source", async () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "sk-ant-fake";

    expect((await env()).getEnv().AI_MODEL).toBe("claude-sonnet-5");

    process.env.AI_PROVIDER = "nvidia";
    process.env.AI_MODEL = "nvidia/some-other-model";

    expect((await env()).getEnv().AI_MODEL).toBe("nvidia/some-other-model");
  });

  it("floors max_tokens so a truncated JSON body cannot be configured in", async () => {
    process.env.AI_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "nvapi-fake";
    process.env.AI_MAX_TOKENS = "500";

    const { getEnv } = await env();
    expect(() => getEnv()).toThrow(/AI_MAX_TOKENS|Too small|>=4000/i);

    delete process.env.AI_MAX_TOKENS;
  });

  it("warns when db persistence is selected without a database url", async () => {
    process.env.AI_PROVIDER = "nvidia";
    process.env.NVIDIA_API_KEY = "nvapi-fake";
    process.env.PERSISTENCE = "db";

    const { describeEnvProblems } = await env();
    expect(describeEnvProblems().join(" ")).toContain("DATABASE_URL");
  });
});
