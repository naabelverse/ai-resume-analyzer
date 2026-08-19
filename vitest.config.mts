import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { RESOLVE, TEST_BASE } from "./vitest.shared.mts";

/**
 * The default suite. Everything here is free and offline.
 *
 * The two suites that spend real API credits are excluded by name so CI can
 * never bill anyone, and they are run through `vitest.live.config.mts`
 * instead. They are NOT run by clearing this list from the CLI: on Vitest 4
 * `--exclude` appends to the configured patterns rather than replacing them,
 * so `--exclude ''` leaves the exclusions in place and the run finds no test
 * files at all — which looks exactly like a passing run if you only check for
 * the absence of failures.
 */
export default defineConfig({
  plugins: [react()],
  resolve: RESOLVE,
  test: {
    ...TEST_BASE,
    exclude: [
      "**/node_modules/**",
      "tests/live-verify.test.ts",
      "tests/quality-spread.test.ts",
    ],
  },
});
