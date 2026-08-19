import { describeEnvProblems, getEnv, isAiConfigured } from "@/lib/env";

/**
 * Readiness, not liveness. Reports whether the pieces the analyze route
 * depends on are configured, without ever echoing a secret — `aiConfigured`
 * says a key is present, never which one.
 */
export async function GET(): Promise<Response> {
  const env = getEnv();

  return Response.json({
    ok: true,
    aiConfigured: isAiConfigured(),
    provider: env.AI_PROVIDER,
    model: env.AI_MODEL,
    maxTokens: env.AI_MAX_TOKENS,
    temperature: env.AI_TEMPERATURE,
    timeoutMs: env.AI_TIMEOUT_MS,
    thinking: env.AI_PROVIDER === "nvidia" ? env.NVIDIA_ENABLE_THINKING : "adaptive",
    persistence: env.PERSISTENCE,
    problems: describeEnvProblems(),
  });
}
