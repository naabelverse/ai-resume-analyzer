// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilePreview } from "@/components/upload/file-preview";
import { MAX_TEXT_CHARS } from "@/lib/limits";
import type { ExtractPreview } from "@/types";

/**
 * What replaces the drop target once a file is held.
 *
 * The thing it must get right is honesty: it shows the extracted text, which
 * is what the model reads, rather than a rendering of the document, which is
 * not. Everything it claims about page count and truncation has to come from
 * the extraction rather than from the file's name or size.
 */

function preview(overrides: Partial<ExtractPreview> = {}): ExtractPreview {
  return {
    kind: "pdf",
    text: "JORDAN BLAKE\njordan.blake@example.com\n\nSUMMARY\nBackend engineer.",
    pageCount: 1,
    charCount: 64,
    truncated: false,
    ...overrides,
  };
}

function fileOf(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name);
}

function renderReady(
  overrides: Partial<ExtractPreview> = {},
  file = fileOf("resume.pdf", 84 * 1024),
) {
  const onRemove = vi.fn();
  render(
    <FilePreview
      file={file}
      preview={preview(overrides)}
      status="ready"
      errorCode={null}
      onRemove={onRemove}
    />,
  );
  return onRemove;
}

describe("FilePreview", () => {
  it("names the file and its size", () => {
    renderReady();

    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText(/84 KB/)).toBeInTheDocument();
  });

  it("reports the page count the extraction actually found", () => {
    renderReady({ pageCount: 3 });

    expect(screen.getByText(/3 pages/)).toBeInTheDocument();
  });

  it("says one page, not one pages", () => {
    renderReady({ pageCount: 1 });

    expect(screen.getByText(/1 page(?!s)/)).toBeInTheDocument();
  });

  it("omits the page count for a DOCX rather than guessing at one", () => {
    // DOCX has no pagination until something renders it. Showing "1 page"
    // here would be a number the app invented.
    renderReady({ kind: "docx", pageCount: null }, fileOf("resume.docx", 41_000));

    expect(screen.queryByText(/\d+ pages?/)).not.toBeInTheDocument();
    expect(screen.getByText(/DOCX/)).toBeInTheDocument();
  });

  it("shows the extracted text", () => {
    renderReady();

    expect(screen.getByText(/Backend engineer\./)).toBeInTheDocument();
  });

  it("says the text is what gets analysed, not a rendering of the file", () => {
    // Without this line the panel reads as a broken document viewer rather
    // than as an accurate view of the model's input.
    renderReady();

    expect(screen.getByText(/not a rendering of your file/i)).toBeInTheDocument();
  });

  it("flags truncation with both the cap and what was extracted", () => {
    renderReady({ truncated: true, charCount: 18_432 });

    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("15,000");
    expect(notice).toHaveTextContent("18,432");
  });

  it("says nothing about truncation when nothing was truncated", () => {
    renderReady({ truncated: false, charCount: MAX_TEXT_CHARS - 1 });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("removes the file when the remove control is used", async () => {
    const onRemove = renderReady();

    await userEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows the failure instead of the text for a rejected file", () => {
    const onRemove = vi.fn();
    render(
      <FilePreview
        file={fileOf("scan.pdf", 900_000)}
        preview={null}
        status="rejected"
        errorCode="EMPTY_RESUME"
        onRemove={onRemove}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(/looks like a scanned image/i);
    expect(screen.queryByText(/not a rendering of your file/i)).not.toBeInTheDocument();
  });

  it("keeps the remove control in the failure state", async () => {
    // Otherwise the only way out of a bad file is a page reload.
    const onRemove = vi.fn();
    render(
      <FilePreview
        file={fileOf("resume.doc", 12_000)}
        preview={null}
        status="rejected"
        errorCode="LEGACY_DOC"
        onRemove={onRemove}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /remove/i }));

    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("shows progress while extracting, and no text yet", () => {
    const onRemove = vi.fn();
    render(
      <FilePreview
        file={fileOf("resume.pdf", 84 * 1024)}
        preview={null}
        status="extracting"
        errorCode={null}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("resume.pdf")).toBeInTheDocument();
    expect(screen.getByText(/reading the file/i)).toBeInTheDocument();
    expect(screen.queryByText(/not a rendering of your file/i)).not.toBeInTheDocument();
  });

  it("gives the text region an accessible name so it is reachable by keyboard", () => {
    // A scrollable region that cannot be focused cannot be scrolled without a
    // mouse, and one without a name gives a screen reader nothing to announce.
    renderReady();

    const region = screen.getByRole("region", { name: /extracted text/i });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
