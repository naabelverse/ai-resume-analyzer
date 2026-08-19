import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { RESOLVE, TEST_BASE } from "./vitest.shared.mts";

/**
 * The configuration for the suites that call a real model.
 *
 * These exist as a separate config rather than as a CLI flag on the default
 * one because Vitest 4 *appends* `--exclude` patterns to whatever the config
 * already lists — it does not replace them. So `--exclude ''`, which reads
 * like "clear the exclusions", actually adds an empty pattern and leaves
 * `tests/live-verify.test.ts` excluded. The run then exits with "No test files
 * found", which is a failure that looks like a pass to anything only counting
 * failed assertions.
 *
 * Splitting the config makes the two modes structurally different rather than
 * differing by a flag: nothing run through `vitest.config.mts` can reach a
 * paid endpoint, and that is a property of the file, not of an argument
 * somebody has to remember.
 *
 *   pnpm test:live     one call, proves the transport works end to end
 *   pnpm test:quality  nine calls, proves the score discriminates
 */
export default defineConfig({
  plugins: [react()],
  resolve: RESOLVE,
  test: {
    ...TEST_BASE,
    exclude: ["**/node_modules/**"],
    // A single analysis can take ~90s (AI_TIMEOUT_MS), and the quality suite
    // makes nine of them in one hook. The per-test default of 5s is for the
    // offline suite and would kill these before the first response lands.
    testTimeout: 300_000,
    hookTimeout: 1_800_000,
  },
});
