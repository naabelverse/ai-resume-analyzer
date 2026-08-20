// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFilePreview } from "@/components/upload/use-file-preview";
import { MAX_FILE_BYTES } from "@/lib/limits";
import type { ExtractPreview } from "@/types";

/**
 * The selection state machine behind the preview.
 *
 * Most of what is worth testing here is what happens when the user is faster
 * than the network: picking a second file while the first is still extracting
 * must never leave the first file's text sitting under the second file's name.
 * Abort handles the common case; the generation guard handles the one abort
 * cannot, where the response was already in hand when the second pick landed.
 */

interface PendingRequest {
  signal: AbortSignal | undefined;
  settle(payload: unknown): void;
  fail(cause: unknown): void;
}

let pending: PendingRequest[] = [];

/**
 * Resolves nothing until a test says so, and — deliberately — does not reject
 * on abort. Real `fetch` does, but the race worth defending against is the one
 * where the response had already arrived, so the mock reproduces that and lets
 * each test decide when to settle.
 */
function stubFetch() {
  pending = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: { signal?: AbortSignal }) => {
      return new Promise((resolve, reject) => {
        pending.push({
          signal: init?.signal,
          settle: (payload) => resolve({ json: async () => payload }),
          fail: reject,
        });
      });
    }),
  );
}

function preview(overrides: Partial<ExtractPreview> = {}): ExtractPreview {
  return {
    kind: "pdf",
    text: "JORDAN BLAKE\nBackend engineer.",
    pageCount: 1,
    charCount: 29,
    truncated: false,
    ...overrides,
  };
}

function pdf(name: string): File {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name);
}

beforeEach(stubFetch);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useFilePreview", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useFilePreview());

    expect(result.current.status).toBe("empty");
    expect(result.current.file).toBeNull();
    expect(result.current.preview).toBeNull();
    expect(result.current.errorCode).toBeNull();
  });

  it("holds the file while extracting, then exposes the extracted text", async () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.pdf")));

    // The filename is visible immediately — the user should not stare at an
    // empty zone while the round trip happens.
    expect(result.current.file?.name).toBe("resume.pdf");
    expect(result.current.status).toBe("extracting");

    await act(async () => {
      pending[0]!.settle({ ok: true, data: preview() });
    });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.preview?.text).toContain("JORDAN BLAKE");
    expect(result.current.errorCode).toBeNull();
  });

  it("aborts the in-flight request when a second file is selected", () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("first.pdf")));
    expect(pending[0]!.signal?.aborted).toBe(false);

    act(() => result.current.select(pdf("second.pdf")));

    expect(pending[0]!.signal?.aborted).toBe(true);
    expect(pending[1]!.signal?.aborted).toBe(false);
    expect(result.current.file?.name).toBe("second.pdf");
  });

  it("never shows the first file's text under the second file's name", async () => {
    // The race abort alone cannot close: the first response was already in
    // hand when the second pick landed. Settled out of order on purpose.
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("first.pdf")));
    act(() => result.current.select(pdf("second.pdf")));

    await act(async () => {
      pending[1]!.settle({ ok: true, data: preview({ text: "SECOND FILE" }) });
    });
    await act(async () => {
      pending[0]!.settle({ ok: true, data: preview({ text: "FIRST FILE" }) });
    });

    expect(result.current.file?.name).toBe("second.pdf");
    expect(result.current.preview?.text).toBe("SECOND FILE");
  });

  it("stays quiet when an aborted request rejects", async () => {
    // An abort is this app cancelling its own request. Reporting it as a
    // network failure would blame the user for their own second click.
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("first.pdf")));
    act(() => result.current.select(pdf("second.pdf")));

    await act(async () => {
      pending[0]!.fail(new DOMException("Aborted", "AbortError"));
    });

    expect(result.current.errorCode).toBeNull();
    expect(result.current.status).toBe("extracting");
  });

  it("surfaces the server's error code for a rejected file", async () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("scan.pdf")));
    await act(async () => {
      pending[0]!.settle({
        ok: false,
        error: { code: "EMPTY_RESUME", message: "No text found." },
      });
    });

    await waitFor(() => expect(result.current.status).toBe("rejected"));
    expect(result.current.errorCode).toBe("EMPTY_RESUME");
    expect(result.current.preview).toBeNull();
    // Still held: a zone that silently discards what you gave it is worse.
    expect(result.current.file?.name).toBe("scan.pdf");
  });

  it("maps a transport failure to NETWORK", async () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.pdf")));
    await act(async () => {
      pending[0]!.fail(new TypeError("Failed to fetch"));
    });

    await waitFor(() => expect(result.current.errorCode).toBe("NETWORK"));
    expect(result.current.status).toBe("rejected");
  });

  it("rejects an oversize file without spending a round trip on it", () => {
    const { result } = renderHook(() => useFilePreview());

    act(() =>
      result.current.select(
        new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.pdf"),
      ),
    );

    expect(result.current.errorCode).toBe("FILE_TOO_LARGE");
    expect(result.current.status).toBe("rejected");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a legacy .doc without spending a round trip on it", () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.doc")));

    expect(result.current.errorCode).toBe("LEGACY_DOC");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears a rejected file back to the empty state", () => {
    // The remove control has to work in the failure state too, or the only way
    // out of a bad file is a page reload.
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.doc")));
    expect(result.current.errorCode).toBe("LEGACY_DOC");

    act(() => result.current.clear());

    expect(result.current.status).toBe("empty");
    expect(result.current.file).toBeNull();
    expect(result.current.errorCode).toBeNull();
    expect(result.current.preview).toBeNull();
  });

  it("cancels an in-flight extraction when cleared", async () => {
    const { result } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.pdf")));
    act(() => result.current.clear());

    expect(pending[0]!.signal?.aborted).toBe(true);

    // And a response that lands anyway must not repopulate a cleared preview.
    await act(async () => {
      pending[0]!.settle({ ok: true, data: preview() });
    });

    expect(result.current.status).toBe("empty");
    expect(result.current.preview).toBeNull();
  });

  it("cancels the in-flight request when the component unmounts", () => {
    const { result, unmount } = renderHook(() => useFilePreview());

    act(() => result.current.select(pdf("resume.pdf")));
    unmount();

    expect(pending[0]!.signal?.aborted).toBe(true);
  });
});
