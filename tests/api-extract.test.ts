import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  makeLegacyDoc,
  oversizeResumePdf,
  sampleResumeDocx,
  sampleResumePdf,
  scannedPdf,
} from "./fixtures/build-fixtures";
import { MAX_FILE_BYTES, MAX_TEXT_CHARS } from "@/lib/limits";
import type { ExtractResponse } from "@/types";

/**
 * The preview endpoint.
 *
 * Its whole reason to exist is that the text it returns is the text the model
 * will be given — so these tests care about the *sameness*, not just the
 * shape. It runs the identical `extractResume` the analyze route runs, and it
 * must reach no provider, spend no credits, and log no resume text doing it.
 */

function request(
  bytes: Uint8Array,
  fileName = "resume.pdf",
  ip = "203.0.113.1",
): Request {
  const body = new FormData();
  body.set("file", new File([bytes as BlobPart], fileName));

  return new Request("http://localhost/api/extract", {
    method: "POST",
    body,
    headers: { "x-forwarded-for": ip },
  });
}

async function loadRoute() {
  const [{ POST }, { resetRateLimits }] = await Promise.all([
    import("@/app/api/extract/route"),
    import("@/lib/rate-limit"),
  ]);

  resetRateLimits();
  return POST;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/extract", () => {
  it("returns the extracted text, page count and character count for a PDF", async () => {
    const POST = await loadRoute();

    const response = await POST(request(sampleResumePdf()));
    const payload = (await response.json()) as ExtractResponse;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    expect(payload.data.kind).toBe("pdf");
    expect(payload.data.pageCount).toBe(1);
    expect(payload.data.text).toContain("MUHAMMAD NABIL");
    expect(payload.data.text).toContain("BSc Computer Science");
    expect(payload.data.charCount).toBe(payload.data.text.length);
    expect(payload.data.truncated).toBe(false);
  });

  it("returns a null page count for a DOCX rather than inventing one", async () => {
    const POST = await loadRoute();

    const payload = (await (
      await POST(request(sampleResumeDocx(), "resume.docx"))
    ).json()) as ExtractResponse;

    expect(payload.ok && payload.data.kind).toBe("docx");
    expect(payload.ok && payload.data.pageCount).toBeNull();
    expect(payload.ok && payload.data.text).toContain("MUHAMMAD NABIL");
  });

  it("reports truncation and returns the clamped text, not the original", async () => {
    // The point of showing this before an analysis is spent: the user can see
    // that the middle of their resume will not reach the model.
    const POST = await loadRoute();

    const payload = (await (
      await POST(request(oversizeResumePdf()))
    ).json()) as ExtractResponse;

    expect(payload.ok).toBe(true);
    if (!payload.ok) return;

    expect(payload.data.truncated).toBe(true);
    expect(payload.data.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    // charCount is the pre-truncation length, so the UI can say how much was
    // dropped rather than only that something was.
    expect(payload.data.charCount).toBeGreaterThan(MAX_TEXT_CHARS);
    expect(payload.data.text).toContain("[... middle of resume omitted");
  });

  it("rejects a scanned PDF with the code the UI already has copy for", async () => {
    const POST = await loadRoute();

    const response = await POST(request(scannedPdf()));
    const payload = (await response.json()) as ExtractResponse;

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    if (payload.ok) return;
    expect(payload.error.code).toBe("EMPTY_RESUME");
  });

  it("rejects a legacy .doc on its magic bytes, not its name", async () => {
    const POST = await loadRoute();

    const response = await POST(request(makeLegacyDoc(), "resume.pdf"));
    const payload = (await response.json()) as ExtractResponse;

    expect(response.status).toBe(415);
    expect(payload.ok === false && payload.error.code).toBe("LEGACY_DOC");
  });

  it("rejects a file over the size cap", async () => {
    const POST = await loadRoute();

    const response = await POST(request(new Uint8Array(MAX_FILE_BYTES + 1)));

    expect(response.status).toBe(413);
    expect(((await response.json()) as ExtractResponse).ok).toBe(false);
  });

  it("rejects a body with no file at all", async () => {
    const { POST } = await import("@/app/api/extract/route");
    (await import("@/lib/rate-limit")).resetRateLimits();

    const response = await POST(
      new Request("http://localhost/api/extract", {
        method: "POST",
        body: new FormData(),
        headers: { "x-forwarded-for": "203.0.113.9" },
      }),
    );

    expect(response.status).toBe(415);
  });

  it("works with no AI provider configured, because it never calls one", async () => {
    // A preview costs a parse, not a credit. If this ever needed a key, the
    // endpoint would have grown a responsibility that belongs to /api/analyze.
    delete process.env.NVIDIA_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const POST = await loadRoute();

    const response = await POST(request(sampleResumePdf()));

    expect(response.status).toBe(200);
  });

  it("never logs the resume text — counts and timings only", async () => {
    const POST = await loadRoute();

    await POST(request(sampleResumePdf()));

    const logged = vi.mocked(console.log).mock.calls.flat().join(" ");
    expect(logged).not.toContain("MUHAMMAD NABIL");
    expect(logged).not.toContain("muhammad.nabil@example.com");
  });

  describe("rate limiting", () => {
    it("does not spend the analyse allowance", async () => {
      // Previewing five files must not leave the user unable to analyse any of
      // them. Separate buckets, not a shared counter.
      const { MAX_REQUESTS, checkRateLimit, resetRateLimits } = await import(
        "@/lib/rate-limit"
      );
      const { POST } = await import("@/app/api/extract/route");
      resetRateLimits();

      for (let attempt = 0; attempt < MAX_REQUESTS + 1; attempt += 1) {
        await POST(request(sampleResumePdf(), "resume.pdf", "198.51.100.7"));
      }

      expect(checkRateLimit("198.51.100.7").allowed).toBe(true);
    });

    it("has its own ceiling, and returns 429 past it", async () => {
      const { MAX_PREVIEW_REQUESTS } = await import("@/lib/rate-limit");
      const POST = await loadRoute();

      for (let attempt = 0; attempt < MAX_PREVIEW_REQUESTS; attempt += 1) {
        const ok = await POST(
          request(sampleResumePdf(), "resume.pdf", "198.51.100.8"),
        );
        expect(ok.status).toBe(200);
      }

      const blocked = await POST(
        request(sampleResumePdf(), "resume.pdf", "198.51.100.8"),
      );

      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBeTruthy();
    });

    it("allows more previews than analyses, because a preview is cheaper", async () => {
      const { MAX_PREVIEW_REQUESTS, MAX_REQUESTS } = await import(
        "@/lib/rate-limit"
      );

      expect(MAX_PREVIEW_REQUESTS).toBeGreaterThan(MAX_REQUESTS);
    });
  });
});
