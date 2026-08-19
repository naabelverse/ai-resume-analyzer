import "server-only";

import { getEnv } from "@/lib/env";
import type { AnalysisProvider } from "@/lib/ai/types";
import { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
import { createNvidiaProvider } from "@/lib/ai/providers/nvidia";

export { createAnthropicProvider } from "@/lib/ai/providers/anthropic";
export { createNvidiaProvider } from "@/lib/ai/providers/nvidia";

/**
 * Runtime selection from AI_PROVIDER. Neither the model id nor the endpoint is
 * hardcoded anywhere — both come from env, so switching providers is a config
 * change and a restart, not a deploy of different code.
 */
let cached: AnalysisProvider | null = null;
let injected: AnalysisProvider | null = null;

/**
 * Test seam. Never called by application code.
 *
 * An explicit hook rather than module mocking: `analyze.ts` binds `getProvider`
 * at import time, and intercepting that binding through the module registry is
 * fragile enough that a mis-resolved mock silently sends real HTTP requests
 * with a fake key — which is exactly the failure this replaced. One obvious
 * function is worth more than a clever one that works most of the time.
 */
export function setTestProvider(provider: AnalysisProvider | null): void {
  injected = provider;
  cached = null;
}

export function getProvider(): AnalysisProvider {
  if (injected) return injected;
  if (cached) return cached;

  cached = getEnv().AI_PROVIDER === "anthropic"
    ? createAnthropicProvider()
    : createNvidiaProvider();

  return cached;
}

/** Test seam. Never called by application code. */
export function resetProvider(): void {
  cached = null;
  injected = null;
}
