/**
 * Runs once per server start, before the first request is served.
 *
 * It logs and never throws. `register()` also runs during `next build`, so
 * throwing here would mean nobody could build the project without a live API
 * key — including CI, which has no business holding one. A missing key is a
 * loud warning at boot and a degraded report at request time, not a broken
 * build.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { describeEnvProblems } = await import("@/lib/env");

  let problems: string[];
  try {
    problems = describeEnvProblems();
  } catch (cause) {
    console.error(
      `\n  ✖ Environment configuration is invalid.\n    ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return;
  }

  if (problems.length === 0) return;

  console.warn(
    [
      "",
      "  ⚠ AI Resume Analyzer — configuration warnings",
      ...problems.map((problem) => `    • ${problem}`),
      "",
    ].join("\n"),
  );
}
