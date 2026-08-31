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
 *   pnpm test:quality  twelve calls: nine for the score spread (three fixtures
 *                      x QUALITY_RUNS), plus one per JD in KEYWORD_JDS
 */
export default defineConfig({
  plugins: [react()],
  resolve: RESOLVE,
  test: {
    ...TEST_BASE,
    exclude: ["**/node_modules/**"],
    // A single analysis is bounded at ANALYZE_MAX_ATTEMPTS x AI_TIMEOUT_MS +
    // overhead, so ~245s, and the quality suite makes nine of them in one
    // beforeAll. 9 x 245s is 2205s, which the previous 1_800_000 hook budget
    // would have cut off mid-measurement — after the calls were paid for. The
    // per-test default of 5s is for the offline suite and would kill these
    // before the first response lands.
    testTimeout: 300_000,
    hookTimeout: 3_000_000,
  },
});
