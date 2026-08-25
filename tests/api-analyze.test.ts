import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sampleResumePdf, scannedPdf } from "./fixtures/build-fixtures";
import { validDimensions, validResult } from "./helpers";
import { FIELD_CAPS } from "@/lib/schema/analysis";
import type { AnalyzeResponse } from "@/types";

/**
 * A detail long enough to overrun any plausible `FIELD_CAPS.feedbackDetail`,
 * so slicing it at the cap reproduces a real mid-word decoder cut.
 */
const LONG_DETAIL =
  "Responsible for maintaining the booking service describes a duty rather than a result, and the same pattern repeats across the section. Say what changed and by how much, using the figures you already have to hand: the request volume the service carried, the incidents it avoided, or the size of the team that depended on it, so a reviewer can weigh the work instead of guessing at the scope of the migration.";

/**
 * Route tests, run against BOTH providers.
 *
 * The point of the provider split is that judgement — validation, the retry,
 * the degrade — is shared and only transport differs. A suite that exercised
 * one provider would not prove that; it would prove one path works. So the
 * behavioural block below is parameterised, and each provider supplies only a
 * way to fake its own wire format.
 *
 * Mocking happens at the SDK client, not at the provider module, so the
 * provider's own request-shaping and response-handling is real code under test.
 */

const anthropicParse = vi.fn();
const nvidiaCreate = vi.fn();

type Outcome = "ok" | "truncated" | "refused";

/**
 * Wire payload the model is supposed to return.
 *
 * Three differences from the finished result, all deliberate: no `verdict` and
 * no `overallScore` (both are derived, never model-supplied), `dimensions` in
 * the overall score's place, and `sections` keyed by name rather than an array
 * (so a missing or duplicated section is unrepresentable).
 */
function wire(overrides: Record<string, unknown> = {}) {
  const {
    verdict: _verdict,
    overallScore: _overallScore,
    sections,
    ...rest
  } = validResult();

  const keyed = Object.fromEntries(
    sections.map(({ name, ...body }) => [name, body]),
  );

  return {
    ...rest,
    dimensions: validDimensions(),
    sections: keyed,
    ...overrides,
  };
}

interface Harness {
  name: "anthropic" | "nvidia";
  mock: ReturnType<typeof vi.fn>;
  /** Queue one response in this provider's native shape. */
  reply(payload: object, outcome?: Outcome): void;
  /** Read the request body the provider actually sent. */
  sentBody(index?: number): Record<string, unknown>;
  /** The user-turn text of a sent request. */
  sentUserTurn(index?: number): string;
}

const HARNESSES: Harness[] = [
  {
    name: "anthropic",
    mock: anthropicParse,
    reply(payload, outcome = "ok") {
      anthropicParse.mockResolvedValueOnce({
        stop_reason:
          outcome === "refused" ? "refusal" : outcome === "truncated" ? "max_tokens" : "end_turn",
        stop_details: outcome === "refused" ? { type: "refusal", category: "cyber" } : null,
        content: [{ type: "text", text: JSON.stringify(payload) }],
        parsed_output: outcome === "ok" ? payload : null,
        usage: { input_tokens: 100, output_tokens: 200 },
      });
    },
    sentBody(index = 0) {
      return anthropicParse.mock.calls[index]![0] as Record<string, unknown>;
    },
    sentUserTurn(index = 0) {
      const body = anthropicParse.mock.calls[index]![0] as {
        messages: Array<{ content: string }>;
      };
      return body.messages.at(-1)!.content;
    },
  },
  {
    name: "nvidia",
    mock: nvidiaCreate,
    reply(payload, outcome = "ok") {
      nvidiaCreate.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: outcome === "truncated" ? "length" : "stop",
            message: {
              // NIM returns reasoning on its own field, never inline.
              content: outcome === "refused" ? "" : JSON.stringify(payload),
              reasoning_content: null,
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200 },
      });
    },
    sentBody(index = 0) {
      return nvidiaCreate.mock.calls[index]![0] as Record<string, unknown>;
    },
    sentUserTurn(index = 0) {
      const body = nvidiaCreate.mock.calls[index]![0] as {
        messages: Array<{ role: string; content: string }>;
      };
      return body.messages.filter((m) => m.role === "user").at(-1)!.content;
    },
  },
];

function request(bytes: Uint8Array, jobDescription?: string, ip = "203.0.113.1") {
  const body = new FormData();
  body.set("file", new File([bytes as BlobPart], "resume.pdf", { type: "application/pdf" }));
  if (jobDescription) body.set("jobDescription", jobDescription);

  return new Request("http://localhost/api/analyze", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": ip },
  });
}

/**
 * Loads the route and installs a provider whose transport is fake but whose
 * request shaping and response handling are the real implementation — so the
 * part most worth testing actually runs.
 */
async function loadRoute(provider: "anthropic" | "nvidia") {
  const [
    { POST },
    { resetRateLimits },
    { resetEnv },
    { setTestProvider, createAnthropicProvider, createNvidiaProvider },
  ] = await Promise.all([
    import("@/app/api/analyze/route"),
    import("@/lib/rate-limit"),
    import("@/lib/env"),
    import("@/lib/ai/providers"),
  ]);

  resetRateLimits();
  resetEnv();
  setTestProvider(
    provider === "anthropic"
      ? createAnthropicProvider({ messages: { parse: anthropicParse } })
      : createNvidiaProvider({
          chat: { completions: { create: nvidiaCreate } },
        }),
  );

  return POST;
}

beforeEach(() => {
  anthropicParse.mockReset();
  nvidiaCreate.mockReset();
  process.env.NVIDIA_API_KEY = "nvapi-test-key-not-real";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-not-real";
  process.env.AI_MODEL = "test-model";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  (await import("@/lib/ai/providers")).resetProvider();
  vi.restoreAllMocks();
  delete process.env.AI_PROVIDER;
  delete process.env.AI_MODEL;
});

describe.each(HARNESSES)("POST /api/analyze [$name]", (harness) => {
  beforeEach(() => {
    process.env.AI_PROVIDER = harness.name;
  });

  it("returns a validated analysis on the happy path", async () => {
    harness.reply(wire());
    const POST = await loadRoute(harness.name);

    const response = await POST(request(sampleResumePdf()));
    const payload = (await response.json()) as AnalyzeResponse;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    expect(payload.data.overallScore).toBe(72);
    expect(payload.meta.degraded).toBe(false);
    expect(payload.meta.degradedReason).toBeNull();
    expect(harness.mock).toHaveBeenCalledTimes(1);
  });

  it("derives the verdict rather than trusting the model for it", async () => {
    // 93 weighted, which lands in the "great" band. The model never sends a
    // verdict or a score; both are computed from these six numbers.
    harness.reply(wire({ dimensions: validDimensions({ impact: 90, relevance: 95, clarity: 95, structure: 95, skills: 95, ats: 95 }) }));
    const POST = await loadRoute(harness.name);

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok && payload.data.verdict).toBe("great");
  });

  it("retries once when validation fails, then succeeds", async () => {
    harness.reply(wire({ summary: "x".repeat(501) }));
    harness.reply(wire());
    const POST = await loadRoute(harness.name);

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(harness.mock).toHaveBeenCalledTimes(2);
    expect(payload.ok && payload.meta.degraded).toBe(false);
  });

  it("feeds the validator's complaint back into the retry turn", async () => {
    harness.reply(wire({ summary: "x".repeat(501) }));
    harness.reply(wire());
    const POST = await loadRoute(harness.name);
    await POST(request(sampleResumePdf()));

    // A bare "try again" would just resample the same distribution.
    const retryTurn = harness.sentUserTurn(1);
    expect(retryTurn).toContain("did not satisfy the required constraints");
    expect(retryTurn).toContain("summary");
  });

  /**
   * The bound, and the reason it exists.
   *
   * A timeout is not an error the user should ever see: the deterministic
   * report is still worth returning, and the whole degrade-don't-fail design
   * says so. What made this unreachable was not the degrade logic but the
   * clock — `maxRetries: 2` on the SDK client turned one 90s timeout into a
   * 270s call, and the platform killed the function at 120s before anything
   * could degrade. These three tests pin all of it.
   */
  it("returns the structural report when the model call times out", async () => {
    // Shaped like the SDK's own timeout rejection.
    const timedOut = Object.assign(new Error("Request timed out."), {
      name: "APIConnectionTimeoutError",
    });
    harness.mock.mockRejectedValueOnce(timedOut);

    const POST = await loadRoute(harness.name);
    const response = await POST(request(sampleResumePdf()));
    const payload = (await response.json()) as AnalyzeResponse;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    expect(payload.meta.degraded).toBe(true);
    expect(payload.meta.degradedReason).toBe("AI_UNAVAILABLE");

    // "Useful" means a real report, not an empty shell: a computed score, all
    // six sections, and the full complement of feedback items.
    expect(payload.data.overallScore).toBeGreaterThan(0);
    expect(payload.data.sections).toHaveLength(6);
    expect(payload.data.feedback.length).toBeGreaterThanOrEqual(5);
    expect(payload.data.summary).toContain("AI review is unavailable");
  });

  it("spends only one request on a timeout, so the clock cannot multiply", async () => {
    const timedOut = Object.assign(new Error("Request timed out."), {
      name: "APIConnectionTimeoutError",
    });
    harness.mock.mockRejectedValue(timedOut);

    const POST = await loadRoute(harness.name);
    await POST(request(sampleResumePdf()));

    // A transport failure is terminal — the retry in analyze.ts is for
    // validation failures, where a second sample can actually help. Retrying a
    // timeout just spends the budget twice and arrives at the same place.
    expect(harness.mock).toHaveBeenCalledTimes(1);
  });

  /**
   * Constrained decoding enforces maxLength by stopping mid-word, with no
   * marker. What reached the UI was a sentence that simply stopped.
   */
  it("marks feedback the decoder cut mid-word", async () => {
    // Prose that runs past the cap and is sliced at it, which is what a
    // decoder cut actually produces. It was once padded to the cap with a run
    // of "x", and that made the last space fall below `BOUNDARY_FLOOR` — a
    // 174-character "word" is exactly the case the floor exists to refuse, so
    // the fixture was testing the fallback rather than the repair.
    const cutAtCap = LONG_DETAIL.slice(0, FIELD_CAPS.feedbackDetail);

    const feedback = validResult().feedback.map((item, index) =>
      index === 0 ? { ...item, detail: cutAtCap } : item,
    );
    harness.reply(wire({ feedback }));

    const POST = await loadRoute(harness.name);
    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    const detail = payload.data.feedback[0]!.detail;
    expect(detail.endsWith("…")).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(FIELD_CAPS.feedbackDetail);
    // The ellipsis replaces the cut fragment rather than being bolted onto it:
    // what survives is a prefix of the original ending on a word boundary.
    // Stated structurally so it holds at whatever `feedbackDetail` becomes.
    const kept = detail.slice(0, -1);
    expect(LONG_DETAIL.startsWith(kept)).toBe(true);
    expect(LONG_DETAIL[kept.length]).toBe(" ");
  });

  /**
   * The prompt tells the model not to carry the resume's list marker into the
   * quote; this is the net for when it does anyway. Asserted at the route
   * rather than on the function alone, because the value that matters is the
   * one that reaches the store and the UI.
   */
  it("strips a list marker the model carried into the detail", async () => {
    const quoted = "Responsible for maintaining the booking service.";
    // A glyph needs no space after it; an ambiguous marker does, which is what
    // keeps a quote opening on "-15%" intact. Both shapes are exercised here.
    const carried = ["• ", "- ", "* ", "·"];
    const feedback = validResult().feedback.map((item, index) => ({
      ...item,
      detail: `${carried[index % carried.length]}${quoted} That bullet names a duty.`,
    }));
    harness.reply(wire({ feedback }));

    const POST = await loadRoute(harness.name);
    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    for (const item of payload.data.feedback) {
      expect(item.detail.startsWith(quoted)).toBe(true);
    }
  });

  /** A dash doing real work mid-sentence is punctuation, and must survive. */
  it("leaves a dash inside the detail alone", async () => {
    const kept = "That bullet — the booking one — names a duty, not a result.";
    const feedback = validResult().feedback.map((item) => ({
      ...item,
      detail: kept,
    }));
    harness.reply(wire({ feedback }));

    const POST = await loadRoute(harness.name);
    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok && payload.data.feedback[0]!.detail).toBe(kept);
  });

  it("leaves a complete sentence at the cap untouched", async () => {
    const complete = "A finished sentence that happens to run right up to the cap.".padStart(
      FIELD_CAPS.feedbackDetail,
      "y ",
    );
    const feedback = validResult().feedback.map((item, index) =>
      index === 0 ? { ...item, detail: complete } : item,
    );
    harness.reply(wire({ feedback }));

    const POST = await loadRoute(harness.name);
    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok && payload.data.feedback[0]!.detail).toBe(complete);
  });

  it("sends the pass-item rule to the model", async () => {
    harness.reply(wire());
    const POST = await loadRoute(harness.name);
    await POST(request(sampleResumePdf()));

    // Both providers shape the request differently; the rule has to survive
    // whichever shaping runs. Matched without the surrounding quotes so the
    // assertion does not depend on how the body was serialised.
    const sent = JSON.stringify(harness.sentBody(0));
    expect(sent).toContain("at least one feedback item must be a");
    expect(sent).toContain("a review that is nothing but criticism gets dismissed");
  });

  it("degrades after two validation failures rather than erroring", async () => {
    harness.reply(wire({ summary: "x".repeat(501) }));
    harness.reply(wire({ summary: "x".repeat(501) }));
    const POST = await loadRoute(harness.name);

    const response = await POST(request(sampleResumePdf()));
    const payload = (await response.json()) as AnalyzeResponse;

    expect(response.status).toBe(200);
    expect(harness.mock).toHaveBeenCalledTimes(2);
    expect(payload.ok && payload.meta.degraded).toBe(true);
    expect(payload.ok && payload.meta.degradedReason).toBe("AI_SCHEMA");
    expect(payload.ok && payload.data.feedback.length).toBeGreaterThanOrEqual(5);
  });

  it("retries a truncated response, then degrades", async () => {
    harness.reply(wire(), "truncated");
    harness.reply(wire(), "truncated");
    const POST = await loadRoute(harness.name);

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(harness.mock).toHaveBeenCalledTimes(2);
    expect(payload.ok && payload.meta.degraded).toBe(true);
  });

  it("degrades when the API call throws", async () => {
    harness.mock.mockRejectedValue(new Error("Request timed out."));
    const POST = await loadRoute(harness.name);

    const response = await POST(request(sampleResumePdf()));
    const payload = (await response.json()) as AnalyzeResponse;

    expect(response.status).toBe(200);
    expect(payload.ok && payload.meta.degraded).toBe(true);
  });

  it("degrades without calling the API when this provider's key is missing", async () => {
    delete process.env[
      harness.name === "nvidia" ? "NVIDIA_API_KEY" : "ANTHROPIC_API_KEY"
    ];
    const POST = await loadRoute(harness.name);

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(harness.mock).not.toHaveBeenCalled();
    expect(payload.ok && payload.meta.degraded).toBe(true);
  });

  it("wraps untrusted input in delimiters and states the measured counts", async () => {
    harness.reply(wire());
    const POST = await loadRoute(harness.name);
    await POST(request(sampleResumePdf(), "We need TypeScript and Postgres."));

    const turn = harness.sentUserTurn();
    expect(turn).toContain("<resume>");
    expect(turn).toContain("<job_description>");
    expect(turn).toContain("Postgres");
    expect(turn).toContain("measured directly from the document");
    expect(turn).toContain("bullet lines: 5");
  });

  it("rejects a scanned PDF before spending a request", async () => {
    const POST = await loadRoute(harness.name);

    const payload = (await (
      await POST(request(scannedPdf()))
    ).json()) as AnalyzeResponse;

    expect(!payload.ok && payload.error.code).toBe("EMPTY_RESUME");
    expect(harness.mock).not.toHaveBeenCalled();
  });

  it("keeps the resume text out of the server log", async () => {
    harness.reply(wire());
    const POST = await loadRoute(harness.name);
    await POST(request(sampleResumePdf()));

    const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(logged).toContain("chars");
    expect(logged).toContain(harness.name);
    expect(logged).not.toContain("MUHAMMAD NABIL");
    expect(logged).not.toContain("muhammad.nabil@example.com");
  });
});

describe("provider-specific request shaping", () => {
  it("anthropic: never sends sampling params claude-sonnet-5 rejects", async () => {
    process.env.AI_PROVIDER = "anthropic";
    HARNESSES[0]!.reply(wire());
    const POST = await loadRoute("anthropic");
    await POST(request(sampleResumePdf()));

    const sent = HARNESSES[0]!.sentBody();
    // Each of these is a 400 on that model, and the failure would surface as
    // "the AI is unavailable" rather than as the mistake it actually is.
    expect(sent).not.toHaveProperty("temperature");
    expect(sent).not.toHaveProperty("top_p");
    expect(sent).not.toHaveProperty("top_k");
    expect(sent).not.toHaveProperty("thinking");
  });

  it("nvidia: sends enforced json_schema, low temperature, and thinking config", async () => {
    process.env.AI_PROVIDER = "nvidia";
    process.env.AI_TEMPERATURE = "0.2";
    HARNESSES[1]!.reply(wire());
    const POST = await loadRoute("nvidia");
    await POST(request(sampleResumePdf()));

    const sent = HARNESSES[1]!.sentBody() as {
      temperature: number;
      max_tokens: number;
      response_format: { type: string; json_schema: { strict: boolean; schema: object } };
      chat_template_kwargs: { enable_thinking: boolean };
      nvext?: unknown;
    };

    expect(sent.temperature).toBe(0.2);
    expect(sent.max_tokens).toBeGreaterThanOrEqual(4000);
    expect(sent.response_format.type).toBe("json_schema");
    expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent.response_format.json_schema.schema).toHaveProperty("properties");
    expect(sent.chat_template_kwargs).toHaveProperty("enable_thinking");
    // guided_json is rejected with a 400 on the hosted endpoint — verified
    // against the live API. Sending it would fail every request.
    expect(sent.nvext).toBeUndefined();

    delete process.env.AI_TEMPERATURE;
  });

  it("nvidia: maps a 429 to its own code, not to a generic failure", async () => {
    process.env.AI_PROVIDER = "nvidia";
    nvidiaCreate.mockRejectedValue(
      Object.assign(new Error("Too Many Requests"), {
        status: 429,
        headers: { "retry-after": "42" },
      }),
    );
    const POST = await loadRoute("nvidia");

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok && payload.meta.degradedReason).toBe("AI_RATE_LIMITED");
  });

  it("nvidia: maps exhausted credits to a distinct code, not AI_UNAVAILABLE", async () => {
    process.env.AI_PROVIDER = "nvidia";
    nvidiaCreate.mockRejectedValue(
      Object.assign(new Error("Insufficient credits for this request"), { status: 402 }),
    );
    const POST = await loadRoute("nvidia");

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    // "Wait a moment and retry" is actively wrong advice when credits are gone.
    expect(payload.ok && payload.meta.degradedReason).toBe("AI_CREDITS_EXHAUSTED");
    expect(payload.ok && payload.meta.degradedReason).not.toBe("AI_UNAVAILABLE");
  });

  it("nvidia: ignores the reasoning trace when thinking is enabled", async () => {
    process.env.AI_PROVIDER = "nvidia";
    nvidiaCreate.mockResolvedValueOnce({
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify(wire()),
            // Reasoning arrives on its own field and must never reach the parser.
            reasoning_content: "Let me think about whether this resume is good...",
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    const POST = await loadRoute("nvidia");

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok).toBe(true);
    expect(payload.ok && payload.data.overallScore).toBe(72);
  });

  it("nvidia: reports an empty answer as truncation rather than parsing ''", async () => {
    process.env.AI_PROVIDER = "nvidia";
    for (let i = 0; i < 2; i += 1) {
      nvidiaCreate.mockResolvedValueOnce({
        choices: [
          {
            finish_reason: "stop",
            message: { content: "", reasoning_content: "thinking forever" },
          },
        ],
        usage: null,
      });
    }
    const POST = await loadRoute("nvidia");

    const payload = (await (
      await POST(request(sampleResumePdf()))
    ).json()) as AnalyzeResponse;

    expect(payload.ok && payload.meta.degraded).toBe(true);
  });
});

describe("stripToJson", () => {
  it("unwraps a markdown fence", async () => {
    const { stripToJson } = await import("@/lib/ai/providers/nvidia");
    expect(stripToJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("removes an inline think block if a chat template ever emits one", async () => {
    const { stripToJson } = await import("@/lib/ai/providers/nvidia");
    expect(stripToJson('<think>hmm</think>{"a":1}')).toBe('{"a":1}');
  });

  it("trims prose either side of the object", async () => {
    const { stripToJson } = await import("@/lib/ai/providers/nvidia");
    expect(stripToJson('Here you go: {"a":1} Hope that helps!')).toBe('{"a":1}');
  });

  it("leaves clean JSON untouched", async () => {
    const { stripToJson } = await import("@/lib/ai/providers/nvidia");
    expect(stripToJson('{"a":1}')).toBe('{"a":1}');
  });
});

/**
 * The timeout budget, asserted rather than commented.
 *
 * `maxDuration` is a literal in the route because Next requires route segment
 * config to be statically analysable, so it cannot be computed from these
 * constants. This test is what keeps the two in agreement: raise
 * AI_TIMEOUT_MS past what the platform allows and the suite fails here rather
 * than in production, where the symptom is a dead connection.
 */
describe("request duration budget", () => {
  it("bounds the worst case inside the platform's maxDuration", async () => {
    const [{ maxDuration }, { getEnv, resetEnv }, limits] = await Promise.all([
      import("@/app/api/analyze/route"),
      import("@/lib/env"),
      import("@/lib/limits"),
    ]);

    resetEnv();
    const worstCaseMs =
      limits.ANALYZE_MAX_ATTEMPTS * getEnv().AI_TIMEOUT_MS +
      limits.NON_AI_BUDGET_MS;

    expect(worstCaseMs).toBeLessThan(maxDuration * 1000);
  });

  it("leaves the slowest measured successful call inside one attempt", async () => {
    const { getEnv, resetEnv } = await import("@/lib/env");
    resetEnv();

    // The slowest request that actually returned a usable response across
    // eighteen live calls. A timeout below this would cut off work that was
    // going to succeed.
    const SLOWEST_MEASURED_SUCCESS_MS = 43_568;
    expect(getEnv().AI_TIMEOUT_MS).toBeGreaterThan(SLOWEST_MEASURED_SUCCESS_MS);
  });

  it.each(["nvidia", "anthropic"] as const)(
    "builds the %s client with no silent SDK retry",
    async (provider) => {
      const { resetEnv } = await import("@/lib/env");
      process.env.AI_PROVIDER = provider;
      resetEnv();

      const client =
        provider === "nvidia"
          ? await import("@/lib/ai/providers/nvidia").then((m) => {
              m.resetNvidiaClient();
              return m.getNvidiaClient();
            })
          : await import("@/lib/ai/providers/anthropic").then((m) => {
              m.resetAnthropicClient();
              return m.getAnthropicClient();
            });

      // The SDK timeout is per request and both SDKs retry on timeout, so a
      // non-zero maxRetries multiplies the bound asserted above.
      expect(client.maxRetries).toBe(0);
      expect(client.timeout).toBe(Number(process.env.AI_TIMEOUT_MS ?? 120_000));
    },
  );
});
