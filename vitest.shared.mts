import { fileURLToPath } from "node:url";

/**
 * The parts of the Vitest setup both configs need.
 *
 * There are two configs — `vitest.config.mts` for the offline suite and
 * `vitest.live.config.mts` for the two suites that call a real model — and
 * they must agree on exactly one thing: how modules resolve. A second copy of
 * the `server-only` alias would eventually drift, and the copy that drifted
 * would silently stop stubbing the guard, so the guarded modules would throw
 * on import and the failure would look like a broken test rather than a
 * broken config.
 *
 * A `.ts` file rather than `.mts` so both configs can import it by an
 * extensionless specifier under `moduleResolution: "bundler"`.
 */
export const RESOLVE = {
  // Native replacement for the vite-tsconfig-paths plugin: resolves the
  // "@/*" alias straight from tsconfig.json.
  tsconfigPaths: true,
  alias: {
    // `server-only` throws by design outside a React Server Components
    // graph. Stubbing it keeps the guarded modules testable without
    // weakening the guard in the build.
    "server-only": fileURLToPath(
      new URL("./tests/stubs/server-only.ts", import.meta.url),
    ),
  },
};

export const TEST_BASE = {
  // Node by default; component tests opt into jsdom with a
  // `@vitest-environment jsdom` docblock, so the fast library tests do not
  // pay for a DOM they never touch.
  environment: "node" as const,
  setupFiles: ["./vitest.setup.ts"],
  include: ["tests/**/*.test.{ts,tsx}"],
};
