import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FEEDBACK_MAX_CHARS } from "@/lib/limits";
import { HONEYPOT_FIELD } from "@/lib/feedback";
import type { FeedbackResponse } from "@/types";

/**
 * The feedback endpoint.
 *
 * Public, unauthenticated, and the one place in this app where saying "done"
 * without having done it is the worst available bug — a "Thanks" over a
 * discarded message is worse than having no form at all. So the tests that
 * matter most are the ones asserting `{ ok: true }` is unreachable without a
 * send that actually succeeded, and that neither the key nor the provider's
 * own wording ever reaches a response body.
 *
 * The `resend` package is mocked rather than `lib/mail.ts`, which is the
 * opposite of this repo's rule for the AI providers — and deliberate. There,
 * the retry loop, the validation and the degraded path all sit between the
 * seam and the SDK, so mocking the SDK would leave the interesting code
 * untested. Here there is nothing under `sendFeedbackEmail` but one HTTP call:
 * the subject, the body and the from/to/replyTo *are* the logic, so the mock
 * has to go below them to leave them real.
 */

const send = vi.hoisted(() => vi.fn());

/*
  A class, not `vi.fn(() => ({...}))`. `lib/mail.ts` calls `new Resend(key)`,
  and an arrow function is not constructable — the mock throws a TypeError that
  the route dutifully turns into a 502, so every test still "passes through"
  the failure path and only the assertions about success catch it.
*/
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
  },
}));

const SAVED = { ...process.env };

/** Resend's success envelope: `data` set, `error` null. */
function sent() {
  return { data: { id: "e1" }, error: null, headers: null };
}

interface Payload {
  [key: string]: unknown;
}

function request(body: Payload | string, ip = "203.0.113.1"): Request {
  return new Request("http://localhost/api/feedback", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
  });
}

/** A submission with nothing wrong with it, for tests about something else. */
function valid(overrides: Payload = {}): Payload {
  return {
    type: "bug",
    message: "The score gauge renders at 0 on Firefox.",
    ...overrides,
  };
}

async function loadRoute() {
  const [{ POST }, { resetRateLimits }, { resetResendClient }, { resetEnv }] =
    await Promise.all([
      import("@/app/api/feedback/route"),
      import("@/lib/rate-limit"),
      import("@/lib/mail"),
      import("@/lib/env"),
    ]);

  resetRateLimits();
  resetResendClient();
  resetEnv();
  return POST;
}

/** The one payload Resend was handed. Fails loudly if it was never called. */
function sentPayload() {
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  send.mockReset();
  send.mockResolvedValue(sent());

  process.env.RESEND_API_KEY = "re_test_key_do_not_echo";
  process.env.FEEDBACK_EMAIL = "owner@example.com";
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...SAVED };
});

describe("POST /api/feedback", () => {
  describe("a valid submission", () => {
    it("sends it and reports success", async () => {
      const POST = await loadRoute();

      const response = await POST(request(valid()));
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("sends from the sandbox address, to FEEDBACK_EMAIL", async () => {
      const POST = await loadRoute();
      await POST(request(valid()));

      const mail = sentPayload();
      // The account has no verified domain, so this is the only sender
      // available — and it delivers only to the account owner's own address.
      expect(mail.from).toBe("onboarding@resend.dev");
      expect(mail.to).toBe("owner@example.com");
    });

    it("carries the type and the analysis id in the subject", async () => {
      const POST = await loadRoute();
      await POST(request(valid({ analysisId: "a1b2c3" })));

      expect(sentPayload().subject).toBe(
        "[Bug] Resume Analyzer — analysis a1b2c3",
      );
    });

    it("leaves the analysis id out of the subject when there was none", async () => {
      const POST = await loadRoute();
      await POST(request(valid({ type: "suggestion" })));

      expect(sentPayload().subject).toBe("[Suggestion] Resume Analyzer");
    });

    it("sets replyTo when an address was given, so a reply reaches them", async () => {
      const POST = await loadRoute();
      await POST(request(valid({ email: "user@example.com" })));

      const mail = sentPayload();
      expect(mail.replyTo).toBe("user@example.com");
      expect(String(mail.text)).toContain("user@example.com");
    });

    it("omits replyTo entirely when no address was given", async () => {
      // Not defaulted to the sandbox sender: a reply-to that goes nowhere is
      // worse than none, because it looks like it works.
      const POST = await loadRoute();
      await POST(request(valid()));

      expect(sentPayload()).not.toHaveProperty("replyTo");
    });

    it("writes the type, message, id and a timestamp into the body", async () => {
      const POST = await loadRoute();
      await POST(
        request(
          valid({ type: "analysis", message: "Skills scored low", analysisId: "demo" }),
        ),
      );

      const text = String(sentPayload().text);
      expect(text).toContain("Type: Analysis");
      expect(text).toContain("Analysis: demo");
      expect(text).toContain("Skills scored low");
      // ISO 8601, so it sorts without anyone guessing a locale.
      expect(text).toMatch(/Sent: \d{4}-\d{2}-\d{2}T[\d:.]+Z/);
    });

    it("trims the message rather than sending the whitespace", async () => {
      const POST = await loadRoute();
      await POST(request(valid({ message: "   padded   " })));

      expect(String(sentPayload().text)).toContain("\npadded\n");
    });

    it("drops fields it has no business forwarding", async () => {
      /*
        The app promises the resume is never stored. A client that posts the
        extracted text or the filename alongside its message must not be able
        to get either into an email — the schema strips unknown keys, so the
        promise holds by construction rather than by the route remembering
        which fields to pick.
      */
      const POST = await loadRoute();
      await POST(
        request(
          valid({
            resumeText: "MUHAMMAD NABIL — Senior Engineer",
            fileName: "nabil-resume.pdf",
          }),
        ),
      );

      const serialised = JSON.stringify(sentPayload());
      expect(serialised).not.toContain("MUHAMMAD NABIL");
      expect(serialised).not.toContain("nabil-resume.pdf");
    });

    it("accepts an id only when it looks like one this app issued", async () => {
      const POST = await loadRoute();
      await POST(request(valid({ analysisId: "../../etc/passwd" })));

      // Dropped, not rejected: a silent field the user never typed and cannot
      // correct must never cost them their message.
      const mail = sentPayload();
      expect(mail.subject).toBe("[Bug] Resume Analyzer");
      expect(String(mail.text)).not.toContain("passwd");
    });
  });

  describe("validation", () => {
    it("refuses a message that is only whitespace", async () => {
      const POST = await loadRoute();

      const response = await POST(request(valid({ message: "   \n  " })));
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(400);
      expect(payload.ok === false && payload.error.code).toBe("FEEDBACK_EMPTY");
      expect(send).not.toHaveBeenCalled();
    });

    it("refuses a missing message", async () => {
      const POST = await loadRoute();

      const response = await POST(request({ type: "bug" }));

      expect(response.status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });

    it("refuses a message past the cap", async () => {
      const POST = await loadRoute();

      const response = await POST(
        request(valid({ message: "x".repeat(FEEDBACK_MAX_CHARS + 1) })),
      );
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(400);
      expect(payload.ok === false && payload.error.code).toBe("FEEDBACK_TOO_LONG");
      expect(send).not.toHaveBeenCalled();
    });

    it("accepts a message exactly at the cap", async () => {
      const POST = await loadRoute();

      const response = await POST(
        request(valid({ message: "x".repeat(FEEDBACK_MAX_CHARS) })),
      );

      expect(response.status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("refuses a malformed email address", async () => {
      const POST = await loadRoute();

      const response = await POST(request(valid({ email: "not-an-address" })));
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(400);
      expect(payload.ok === false && payload.error.code).toBe(
        "FEEDBACK_EMAIL_INVALID",
      );
      expect(send).not.toHaveBeenCalled();
    });

    it.each(["", "   ", undefined])(
      "treats an empty email (%p) as absent rather than as invalid",
      async (email) => {
        // The field is optional. Most people sending a bug report do not want
        // a reply, and that is the common case, not a validation failure.
        const POST = await loadRoute();

        const response = await POST(request(valid({ email })));

        expect(response.status).toBe(200);
        expect(sentPayload()).not.toHaveProperty("replyTo");
      },
    );

    it("refuses a type it does not recognise", async () => {
      const POST = await loadRoute();

      const response = await POST(request(valid({ type: "urgent" })));
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(400);
      expect(payload.ok === false && payload.error.code).toBe("FEEDBACK_INVALID");
      expect(send).not.toHaveBeenCalled();
    });

    it("refuses a body that is not JSON at all", async () => {
      const POST = await loadRoute();

      const response = await POST(request("this is not json"));

      expect(response.status).toBe(400);
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe("the honeypot", () => {
    it("reports success without sending anything", async () => {
      const POST = await loadRoute();

      const response = await POST(
        request(valid({ [HONEYPOT_FIELD]: "http://spam.example" })),
      );
      const payload = (await response.json()) as FeedbackResponse;

      // Indistinguishable from a real success on purpose. Every response a bot
      // can tell apart is a hint about how to get through next time.
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(send).not.toHaveBeenCalled();
    });

    it("is checked before validation, so a bot learns nothing from its junk", async () => {
      const POST = await loadRoute();

      const response = await POST(
        request({ type: "nonsense", message: "", [HONEYPOT_FIELD]: "x" }),
      );

      expect(response.status).toBe(200);
      expect(send).not.toHaveBeenCalled();
    });

    it("lets an empty honeypot through — that is what a person sends", async () => {
      const POST = await loadRoute();

      const response = await POST(request(valid({ [HONEYPOT_FIELD]: "" })));

      expect(response.status).toBe(200);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("rate limiting", () => {
    /*
      Two buckets, because the endpoint has two costs. The send bucket meters
      calls to a metered third party; the request bucket meters everything that
      reaches the route at all. The tests that matter are the ones proving the
      cheap path cannot spend the expensive path's allowance.
    */
    it("allows three sends in the window and refuses the fourth", async () => {
      const { MAX_FEEDBACK_SENDS } = await import("@/lib/rate-limit");
      const POST = await loadRoute();

      for (let attempt = 0; attempt < MAX_FEEDBACK_SENDS; attempt += 1) {
        const ok = await POST(request(valid(), "198.51.100.20"));
        expect(ok.status).toBe(200);
      }

      const blocked = await POST(request(valid(), "198.51.100.20"));
      const payload = (await blocked.json()) as FeedbackResponse;

      expect(blocked.status).toBe(429);
      expect(payload.ok === false && payload.error.code).toBe(
        "FEEDBACK_RATE_LIMITED",
      );
      expect(blocked.headers.get("retry-after")).toBeTruthy();
      expect(send).toHaveBeenCalledTimes(MAX_FEEDBACK_SENDS);
    });

    it("counts per IP rather than globally", async () => {
      const POST = await loadRoute();

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await POST(request(valid(), "198.51.100.21"));
      }

      const other = await POST(request(valid(), "198.51.100.22"));
      expect(other.status).toBe(200);
    });

    it("does not spend the analyse allowance", async () => {
      // Sending three bug reports must not leave someone unable to analyse a
      // resume. Separate buckets, not a shared counter.
      const { checkRateLimit } = await import("@/lib/rate-limit");
      const POST = await loadRoute();

      for (let attempt = 0; attempt < 4; attempt += 1) {
        await POST(request(valid(), "198.51.100.23"));
      }

      expect(checkRateLimit("198.51.100.23").allowed).toBe(true);
    });

    describe("the send bucket is charged only at the send", () => {
      it("does not charge a validation failure", async () => {
        // Someone who mistypes their address twice must still have all three
        // sends. This is the whole reason the two buckets exist.
        const { MAX_FEEDBACK_SENDS } = await import("@/lib/rate-limit");
        const POST = await loadRoute();

        for (let attempt = 0; attempt < 5; attempt += 1) {
          const refusal = await POST(
            request(valid({ email: "not-an-address" }), "198.51.100.30"),
          );
          expect(refusal.status).toBe(400);
        }

        for (let attempt = 0; attempt < MAX_FEEDBACK_SENDS; attempt += 1) {
          const ok = await POST(request(valid(), "198.51.100.30"));
          expect(ok.status).toBe(200);
        }
        expect(send).toHaveBeenCalledTimes(MAX_FEEDBACK_SENDS);
      });

      it("does not charge a honeypot hit", async () => {
        const { MAX_FEEDBACK_SENDS } = await import("@/lib/rate-limit");
        const POST = await loadRoute();

        for (let attempt = 0; attempt < 5; attempt += 1) {
          await POST(request(valid({ [HONEYPOT_FIELD]: "x" }), "198.51.100.31"));
        }

        for (let attempt = 0; attempt < MAX_FEEDBACK_SENDS; attempt += 1) {
          const ok = await POST(request(valid(), "198.51.100.31"));
          expect(ok.status).toBe(200);
        }
        expect(send).toHaveBeenCalledTimes(MAX_FEEDBACK_SENDS);
      });

      it("does not charge a body that was never JSON", async () => {
        const POST = await loadRoute();

        for (let attempt = 0; attempt < 5; attempt += 1) {
          await POST(request("not json at all", "198.51.100.32"));
        }

        expect((await POST(request(valid(), "198.51.100.32"))).status).toBe(200);
      });

      it("DOES charge a send that failed, because it cost a real API call", async () => {
        /*
          The literal reading of "reached the send". Making failures free would
          leave the expensive path unbounded during exactly the outage that
          attracts the most retries.
        */
        send.mockRejectedValue(new Error("socket hang up"));
        const { MAX_FEEDBACK_SENDS } = await import("@/lib/rate-limit");
        const POST = await loadRoute();

        for (let attempt = 0; attempt < MAX_FEEDBACK_SENDS; attempt += 1) {
          expect((await POST(request(valid(), "198.51.100.33"))).status).toBe(502);
        }

        const blocked = await POST(request(valid(), "198.51.100.33"));
        expect(blocked.status).toBe(429);
        // Charged, so the fourth never reached the provider at all.
        expect(send).toHaveBeenCalledTimes(MAX_FEEDBACK_SENDS);
      });
    });

    describe("the request bucket meters the cheap paths", () => {
      it("stops a bot hammering the honeypot, which the send bucket never sees", async () => {
        const { MAX_FEEDBACK_REQUESTS } = await import("@/lib/rate-limit");
        const POST = await loadRoute();

        for (let attempt = 0; attempt < MAX_FEEDBACK_REQUESTS; attempt += 1) {
          const ok = await POST(
            request(valid({ [HONEYPOT_FIELD]: "x" }), "198.51.100.40"),
          );
          expect(ok.status).toBe(200);
        }

        const blocked = await POST(
          request(valid({ [HONEYPOT_FIELD]: "x" }), "198.51.100.40"),
        );
        expect(blocked.status).toBe(429);
        expect(send).not.toHaveBeenCalled();
      });

      it("stops a bot hammering validation failures", async () => {
        const { MAX_FEEDBACK_REQUESTS } = await import("@/lib/rate-limit");
        const POST = await loadRoute();

        for (let attempt = 0; attempt < MAX_FEEDBACK_REQUESTS; attempt += 1) {
          await POST(request({ type: "junk" }, "198.51.100.41"));
        }

        expect((await POST(request({ type: "junk" }, "198.51.100.41"))).status).toBe(429);
      });

      it("is loose enough that a real session never reaches it", async () => {
        // Three sends plus every typo and rethink along the way is nowhere
        // near twenty.
        const { MAX_FEEDBACK_REQUESTS, MAX_FEEDBACK_SENDS } = await import(
          "@/lib/rate-limit"
        );

        expect(MAX_FEEDBACK_REQUESTS).toBeGreaterThan(MAX_FEEDBACK_SENDS * 3);
      });
    });
  });

  describe("when the send fails", () => {
    /** Resend's failure envelope, carrying a secret it must not leak onward. */
    function rejected() {
      return {
        data: null,
        error: {
          name: "validation_error",
          statusCode: 422,
          message: "The from address is not verified for re_live_SECRETVALUE",
        },
        headers: null,
      };
    }

    it("reports failure rather than success when Resend rejects", async () => {
      // Resend resolves rather than rejects on an API error, so the envelope
      // has to be read. Skipping that check is the exact bug this feature must
      // not ship: nothing throws, and the user is thanked for a message that
      // went nowhere.
      send.mockResolvedValue(rejected());
      const POST = await loadRoute();

      const response = await POST(request(valid()));
      const payload = (await response.json()) as FeedbackResponse;

      expect(response.status).toBe(502);
      expect(payload.ok).toBe(false);
    });

    it("reports failure when the SDK throws outright", async () => {
      send.mockRejectedValue(new Error("socket hang up"));
      const POST = await loadRoute();

      const response = await POST(request(valid()));

      expect(response.status).toBe(502);
      expect(((await response.json()) as FeedbackResponse).ok).toBe(false);
    });

    it("refuses to send at all when the mail configuration is missing", async () => {
      delete process.env.RESEND_API_KEY;
      const POST = await loadRoute();

      const response = await POST(request(valid()));

      expect(response.status).toBe(502);
      expect(((await response.json()) as FeedbackResponse).ok).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it("never puts the key or the provider's wording in the response", async () => {
      send.mockResolvedValue(rejected());
      const POST = await loadRoute();

      const body = await (await POST(request(valid()))).text();

      expect(body).not.toContain("re_test_key_do_not_echo");
      expect(body).not.toContain("re_live_SECRETVALUE");
      expect(body).not.toContain("validation_error");
      expect(body).not.toContain("owner@example.com");
      // What it does say is that nothing was sent, which is the fact the user
      // is owed.
      expect(body).toContain("hasn't reached anyone");
    });

    it("logs the real cause server-side, where only the operator sees it", async () => {
      send.mockResolvedValue({
        data: null,
        error: { name: "rate_limit_exceeded", statusCode: 429, message: "Too many" },
        headers: null,
      });
      const POST = await loadRoute();

      await POST(request(valid()));

      const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
      expect(logged).toContain("rate_limit_exceeded");
      expect(logged).toContain("429");
    });
  });

  it("never logs what the person wrote", async () => {
    // The email is where the message goes. A log is a second copy in a place
    // nobody agreed to — the same rule the extraction pipeline follows for
    // resume text.
    const POST = await loadRoute();

    await POST(
      request(
        valid({
          message: "My salary history is on page two",
          email: "user@example.com",
        }),
      ),
    );

    const logged = [
      ...vi.mocked(console.log).mock.calls,
      ...vi.mocked(console.error).mock.calls,
    ]
      .flat()
      .join(" ");

    expect(logged).not.toContain("salary history");
    expect(logged).not.toContain("user@example.com");
    // Counts and timings only.
    expect(logged).toContain("type=bug");
    expect(logged).toContain("reply=yes");
  });
});
