import { beforeEach, describe, expect, it } from "vitest";

import {
  MAX_REQUESTS,
  WINDOW_MS,
  checkRateLimit,
  clientKeyFrom,
  resetRateLimits,
} from "@/lib/rate-limit";

beforeEach(resetRateLimits);

describe("checkRateLimit", () => {
  it("allows exactly MAX_REQUESTS in a window", () => {
    for (let attempt = 0; attempt < MAX_REQUESTS; attempt += 1) {
      expect(checkRateLimit("ip").allowed).toBe(true);
    }
    expect(checkRateLimit("ip").allowed).toBe(false);
  });

  it("counts down the remaining allowance", () => {
    expect(checkRateLimit("ip").remaining).toBe(MAX_REQUESTS - 1);
    expect(checkRateLimit("ip").remaining).toBe(MAX_REQUESTS - 2);
  });

  it("reports how long to wait, so the UI can say something specific", () => {
    const now = Date.now();
    for (let attempt = 0; attempt < MAX_REQUESTS; attempt += 1) {
      checkRateLimit("ip", now);
    }

    const blocked = checkRateLimit("ip", now + 60_000);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.retryAfterSeconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
  });

  it("lets the window expire", () => {
    const now = Date.now();
    for (let attempt = 0; attempt < MAX_REQUESTS; attempt += 1) {
      checkRateLimit("ip", now);
    }

    expect(checkRateLimit("ip", now).allowed).toBe(false);
    expect(checkRateLimit("ip", now + WINDOW_MS + 1).allowed).toBe(true);
  });

  it("keeps separate buckets per key", () => {
    for (let attempt = 0; attempt < MAX_REQUESTS; attempt += 1) {
      checkRateLimit("first");
    }

    expect(checkRateLimit("first").allowed).toBe(false);
    expect(checkRateLimit("second").allowed).toBe(true);
  });
});

describe("clientKeyFrom", () => {
  function withHeaders(headers: Record<string, string>) {
    return new Request("http://localhost/", { headers });
  }

  it("takes the client from the front of the x-forwarded-for chain", () => {
    // The chain is client, proxy1, proxy2 — keying on the last entry would put
    // every user behind one proxy into a single shared bucket.
    expect(
      clientKeyFrom(withHeaders({ "x-forwarded-for": "203.0.113.1, 70.41.3.18" })),
    ).toBe("203.0.113.1");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKeyFrom(withHeaders({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
  });

  it("falls back to a shared bucket rather than to no limit at all", () => {
    expect(clientKeyFrom(withHeaders({}))).toBe("unknown");
  });
});
