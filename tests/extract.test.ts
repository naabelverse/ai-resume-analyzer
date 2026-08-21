import { describe, expect, it } from "vitest";

import {
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  extractFromBuffer,
  normaliseText,
  sniff,
  truncateText,
} from "@/lib/extract";
import { AppError } from "@/lib/errors";
import {
  RESUME_LINES,
  makeDocx,
  makeLegacyDoc,
  makePdf,
  oversizeResumePdf,
  sampleResumeDocx,
  sampleResumePdf,
  scannedPdf,
} from "./fixtures/build-fixtures";

/** Asserts the promise rejects with a specific AppError code. */
async function expectCode(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => error instanceof AppError && error.code === code,
    `an AppError with code ${code}`,
  );
}

describe("sniff", () => {
  it("identifies a PDF by its header", () => {
    expect(sniff(sampleResumePdf())).toBe("pdf");
  });

  it("identifies a DOCX by its ZIP header plus the word/ entry", () => {
    expect(sniff(sampleResumeDocx())).toBe("docx");
  });

  it("identifies a legacy .doc by its OLE2 header", () => {
    expect(sniff(makeLegacyDoc())).toBe("doc");
  });

  it("rejects a ZIP that is not a Word document", () => {
    // A bare ZIP header is not enough — an XLSX and a JAR share it.
    const zipButNotDocx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(sniff(zipButNotDocx)).toBe("unknown");
  });

  it("rejects arbitrary bytes", () => {
    expect(sniff(new TextEncoder().encode("just some text"))).toBe("unknown");
  });
});

describe("extractFromBuffer", () => {
  it("reads text and a page count from a PDF", async () => {
    const result = await extractFromBuffer(sampleResumePdf());

    expect(result.kind).toBe("pdf");
    expect(result.pageCount).toBe(1);
    expect(result.text).toContain("MUHAMMAD NABIL");
    expect(result.text).toContain("muhammad.nabil@example.com");
    expect(result.truncated).toBe(false);
  });

  it("reads text from a DOCX and reports no page count", async () => {
    const result = await extractFromBuffer(sampleResumeDocx());

    expect(result.kind).toBe("docx");
    expect(result.pageCount).toBeNull();
    expect(result.text).toContain("Migrated the booking service");
  });

  it("counts multiple PDF pages", async () => {
    const result = await extractFromBuffer(
      makePdf([RESUME_LINES, ["Second page", "More content here"]]),
    );

    expect(result.pageCount).toBe(2);
    expect(result.text).toContain("Second page");
  });

  it("rejects a PDF that has been renamed .docx", async () => {
    // The whole point of sniffing magic bytes: the extension is a lie here,
    // and dispatching on it would send a PDF into a ZIP parser.
    const pdfBytes = sampleResumePdf();
    expect(sniff(pdfBytes)).toBe("pdf");

    const result = await extractFromBuffer(pdfBytes);
    expect(result.kind).toBe("pdf");
  });

  it("rejects a legacy .doc with its own error code", async () => {
    await expectCode(extractFromBuffer(makeLegacyDoc()), "LEGACY_DOC");
  });

  it("rejects an unsupported file type", async () => {
    const plainText = new TextEncoder().encode("x".repeat(1000));
    await expectCode(extractFromBuffer(plainText), "UNSUPPORTED_FILE");
  });

  it("rejects a file over the size cap", async () => {
    const oversize = new Uint8Array(MAX_FILE_BYTES + 1);
    oversize.set([0x25, 0x50, 0x44, 0x46], 0);
    await expectCode(extractFromBuffer(oversize), "FILE_TOO_LARGE");
  });

  it("rejects a PDF with no text layer as a scanned image", async () => {
    await expectCode(extractFromBuffer(scannedPdf()), "EMPTY_RESUME");
  });

  it("rejects a document with too little text to analyse", async () => {
    await expectCode(extractFromBuffer(makeDocx(["Muhammad Nabil"])), "EMPTY_RESUME");
  });

  it("truncates a long resume and keeps the tail", async () => {
    const result = await extractFromBuffer(oversizeResumePdf());

    expect(result.truncated).toBe(true);
    expect(result.charCount).toBeGreaterThan(MAX_TEXT_CHARS);
    expect(result.text).toContain("MUHAMMAD NABIL");
    // The tail matters: education and skills live on the last page, and the
    // rubric scores them.
    expect(result.text).toContain("FINAL PAGE MARKER");
    expect(result.text).toContain("omitted for length");
  });
});

describe("normaliseText", () => {
  it("strips null bytes", () => {
    expect(normaliseText("a\0b")).toBe("ab");
  });

  it("collapses three or more newlines to two", () => {
    expect(normaliseText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("preserves single line breaks, which separate bullets", () => {
    expect(normaliseText("- one\n- two")).toBe("- one\n- two");
  });

  it("preserves bullet glyphs", () => {
    expect(normaliseText("• built a thing")).toBe("• built a thing");
  });

  it("collapses runs of horizontal whitespace left by PDF layout", () => {
    expect(normaliseText("Name        Title")).toBe("Name Title");
  });

  it("normalises Windows line endings", () => {
    expect(normaliseText("a\r\nb")).toBe("a\nb");
  });
});

describe("truncateText", () => {
  it("leaves text at the boundary untouched", () => {
    const exact = "x".repeat(MAX_TEXT_CHARS);
    expect(truncateText(exact)).toEqual({ text: exact, truncated: false });
  });

  it("never returns more text than it was given", () => {
    // Regression: head + marker + tail once overshot the cap, so text one
    // character past the boundary came back longer than it went in.
    for (const size of [MAX_TEXT_CHARS + 1, MAX_TEXT_CHARS + 50, 60_000]) {
      const over = "x".repeat(size);
      const result = truncateText(over);

      expect(result.truncated).toBe(true);
      expect(result.text.length).toBeLessThan(over.length);
      expect(result.text.length).toBeLessThanOrEqual(MAX_TEXT_CHARS);
    }
  });

  it("keeps both the head and the tail", () => {
    const text = `HEAD${"x".repeat(MAX_TEXT_CHARS)}TAIL`;
    const result = truncateText(text);

    expect(result.text.startsWith("HEAD")).toBe(true);
    expect(result.text.endsWith("TAIL")).toBe(true);
  });
});
