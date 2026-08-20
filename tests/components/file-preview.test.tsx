// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FilePreview } from "@/components/upload/file-preview";
import { MAX_TEXT_CHARS, TRUNCATION_MARKER } from "@/lib/limits";
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

  /**
   * `truncateText` splices its marker into the middle of the string the model
   * reads. That is right for the model and wrong for a reader, who would get
   * the app's own words in the resume's face and colour — one more line to
   * scroll past rather than a cut to notice. These drive the real shape:
   * head + marker + tail, exactly as `lib/extract` builds it.
   */
  function truncatedAt(head: string, tail: string, droppedChars: number) {
    return {
      truncated: true,
      text: `${head}${TRUNCATION_MARKER}${tail}`,
      // The pre-truncation length. The marker is the app's own text and must
      // not count toward what the resume lost, so this is what was kept plus
      // what was dropped — never the rendered string's length.
      charCount: head.length + tail.length + droppedChars,
    };
  }

  it("renders the truncation marker as a band, not as resume text", () => {
    renderReady(truncatedAt("HEAD OF RESUME", "TAIL OF RESUME", 4_200));

    expect(screen.getByText(/4,200 characters cut from here/)).toBeInTheDocument();
    // The marker's own wording must be gone from the document entirely. If the
    // split ever stops matching, the component falls back to one plain block
    // and this phrase reappears inside the resume text — silently, which is
    // the failure this assertion exists to make loud.
    expect(screen.queryByText(/omitted for length/)).not.toBeInTheDocument();
  });

  it("splits the resume text into two blocks either side of the cut", () => {
    // A band that ate the tail would be worse than no band: the second half of
    // the resume is exactly what head+tail truncation exists to preserve.
    //
    // Asserting both strings are *present* is not enough — the fallback path
    // renders the whole string in one block and contains both, so that version
    // of this test passed with the band disabled. Distinct elements is the
    // claim that only holds when the split actually happened.
    renderReady(truncatedAt("HEAD OF RESUME", "TAIL OF RESUME", 4_200));

    const head = screen.getByText(/HEAD OF RESUME/);
    const tail = screen.getByText(/TAIL OF RESUME/);

    expect(head).toBeInTheDocument();
    expect(tail).toBeInTheDocument();
    expect(head).not.toBe(tail);
  });

  it("counts the dropped characters, not the rendered ones", () => {
    // The marker sits inside `text` but is not resume content. Counting it
    // would under-report the loss by its own length on every truncated file.
    renderReady(truncatedAt("A", "B", 10_000));

    expect(screen.getByText(/10,000 characters cut from here/)).toBeInTheDocument();
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
