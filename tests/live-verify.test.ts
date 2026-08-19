import { appendFileSync, writeFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { expect, it } from "vitest";

loadEnv({ path: ".env.local", quiet: true });

import { extractFromBuffer } from "@/lib/extract";
import { runDeterministicChecks, summariseChecksForModel } from "@/lib/scoring";
import { RESUME_LINES, sampleResumePdf } from "./fixtures/build-fixtures";

const OUT = "live-report.txt";
const say = (line: string) => appendFileSync(OUT, line + "\n");

const JD =
  "Backend engineer. Required: Node.js, TypeScript, PostgreSQL, REST APIs. " +
  "Preferred: Kubernetes, CI/CD, AWS, GraphQL.";

async function run(thinking: boolean) {
  process.env.NVIDIA_ENABLE_THINKING = thinking ? "true" : "false";
  const { resetEnv } = await import("@/lib/env");
  const { resetProvider } = await import("@/lib/ai/providers");
  resetEnv();
  resetProvider();

  const { analyzeResumeWithDiagnostics } = await import("@/lib/ai/analyze");

  const extracted = await extractFromBuffer(sampleResumePdf());
  const checks = runDeterministicChecks(extracted.text, extracted.pageCount);

  const outcome = await analyzeResumeWithDiagnostics({
    resumeText: extracted.text,
    jobDescription: JD,
    truncated: extracted.truncated,
    facts: summariseChecksForModel(checks),
  });

  const line = "=".repeat(72);
  say(`\n${line}\nenable_thinking = ${thinking}\n${line}`);
  say(`provider   : ${outcome.diagnostics.provider}`);
  say(`model      : ${outcome.diagnostics.model}`);
  say(`elapsed    : ${outcome.diagnostics.elapsedMs} ms`);
  say(`attempts   : ${outcome.diagnostics.attempts}`);
  say(
    `zod parse  : ${outcome.diagnostics.firstAttemptValid ? "PASSED on first attempt" : "FAILED first attempt, RETRIED"}`,
  );
  say(`tokens     : ${JSON.stringify(outcome.diagnostics.usage)}`);
  say(
    `reasoning  : ${outcome.diagnostics.reasoning ? `${outcome.diagnostics.reasoning.length} chars on reasoning_content` : "none"}`,
  );
  if (outcome.diagnostics.reasoning) {
    say(`  first 200: ${outcome.diagnostics.reasoning.slice(0, 200)}`);
  }
  say(`\n--- FULL RAW RESPONSE BODY (pre-parse) ---\n${outcome.diagnostics.rawText}`);
  say(`\n--- PARSED AnalysisResult ---\n${JSON.stringify(outcome.result, null, 2)}`);

  return outcome;
}

it("live: NVIDIA end to end", async () => {
  writeFileSync(OUT, "");
  const off = await run(false);
  expect(off.result.overallScore).toBeGreaterThanOrEqual(0);


  say(`\n${"=".repeat(72)}\nCOMPARISON\n${"=".repeat(72)}`);
  for (const [label, o] of [["thinking OFF", off]] as const) {
    const quoted = o.result.feedback.filter((f) =>
      RESUME_LINES.some((l) => l.replace(/^- /, "").length > 25 && f.detail.includes(l.replace(/^- /, "").slice(0, 40))),
    ).length;
    say(
      `${label}: score=${o.result.overallScore} | ${o.diagnostics.elapsedMs}ms | ` +
        `${o.diagnostics.usage?.outputTokens} out-tokens | ` +
        `${quoted}/${o.result.feedback.length} feedback items quote the resume | ` +
        `rewrites=${o.result.bulletRewrites.length} | ` +
        `matched=${o.result.keywordMatch?.matched.length ?? 0}/${(o.result.keywordMatch?.matched.length ?? 0) + (o.result.keywordMatch?.missing.length ?? 0)}`,
    );
  }
}, 300_000);
