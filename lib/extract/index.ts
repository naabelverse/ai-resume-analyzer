import "server-only";

import {
  HEAD_CHARS,
  MAX_FILE_BYTES,
  MAX_TEXT_CHARS,
  MIN_TEXT_CHARS,
  TAIL_CHARS,
  TRUNCATION_MARKER,
} from "@/lib/limits";
import {
  EmptyResumeError,
  FileTooLargeError,
  LegacyDocError,
  UnsupportedFileError,
} from "@/lib/errors";
export * from "@/lib/limits";

import { extractFromDocx } from "./docx";
import { extractFromPdf } from "./pdf";

export type FileKind = "pdf" | "docx" | "doc" | "unknown";

export interface ExtractedResume {
  /** Normalised, possibly truncated. */
  text: string;
  /** Null for DOCX, which has no page count until it is rendered. */
  pageCount: number | null;
  truncated: boolean;
  /** Length after normalisation, before truncation. */
  charCount: number;
  kind: Exclude<FileKind, "doc" | "unknown">;
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // legacy .doc

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, index) => bytes[index] === byte);
}

/** Byte-scan for an ASCII needle. Used to tell DOCX from other ZIP containers. */
function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = new Uint8Array(needle.length);
  for (let i = 0; i < needle.length; i += 1) target[i] = needle.charCodeAt(i);

  outer: for (let i = 0; i <= bytes.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * Identifies the file from its magic bytes, never its extension or the
 * browser-reported mime type — both are trivially wrong. A PDF renamed
 * `.docx` is the case this exists to catch: it would otherwise reach mammoth,
 * fail deep inside a zip parser, and surface as a confusing internal error.
 *
 * A DOCX is a ZIP, and so is an XLSX, a PPTX, and a JAR — the `PK` header
 * alone proves nothing, so the buffer is scanned for the `word/document.xml`
 * entry name that only a Word document carries.
 */
export function sniff(bytes: Uint8Array): FileKind {
  if (startsWith(bytes, PDF_MAGIC)) return "pdf";
  if (startsWith(bytes, OLE2_MAGIC)) return "doc";
  if (startsWith(bytes, ZIP_MAGIC)) {
    return containsAscii(bytes, "word/document.xml") ? "docx" : "unknown";
  }
  return "unknown";
}

/**
 * Whitespace cleanup that preserves the structure the model reads meaning
 * from. Single line breaks stay (they separate bullets), bullet glyphs stay,
 * and only runs of 3+ blank lines collapse. Horizontal runs collapse to a
 * single space because PDF text extraction pads with spaces to approximate
 * visual position, which is noise once the layout is gone.
 */
export function normaliseText(raw: string): string {
  return raw
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ +\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Head + tail rather than a plain head clip: the last page of a resume holds
 * education and skills, which the rubric scores. Dropping the tail would make
 * long resumes score badly for a reason that is the app's fault, not theirs.
 *
 * The marker counts against the budget, so the result is always at most
 * MAX_TEXT_CHARS. Adding it on top instead meant text one character over the
 * limit came back longer than it went in — truncation that grew the input.
 */
export function truncateText(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };

  const tailChars = Math.min(
    TAIL_CHARS,
    MAX_TEXT_CHARS - HEAD_CHARS - TRUNCATION_MARKER.length,
  );

  return {
    text:
      text.slice(0, HEAD_CHARS) + TRUNCATION_MARKER + text.slice(-tailChars),
    truncated: true,
  };
}

/**
 * Buffer-level entry point. Separate from `extractResume` so tests can drive
 * it with fixture bytes without constructing a `File`.
 */
export async function extractFromBuffer(
  bytes: Uint8Array,
): Promise<ExtractedResume> {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileTooLargeError();

  const kind = sniff(bytes);
  if (kind === "doc") throw new LegacyDocError();
  if (kind === "unknown") throw new UnsupportedFileError();

  const extracted =
    kind === "pdf"
      ? await extractFromPdf(bytes)
      : { ...(await extractFromDocx(bytes)), pageCount: null };

  const normalised = normaliseText(extracted.text);
  if (normalised.length < MIN_TEXT_CHARS) throw new EmptyResumeError();

  const { text, truncated } = truncateText(normalised);

  return {
    text,
    pageCount: extracted.pageCount,
    truncated,
    charCount: normalised.length,
    kind,
  };
}

export async function extractResume(file: File): Promise<ExtractedResume> {
  if (file.size > MAX_FILE_BYTES) throw new FileTooLargeError();

  return extractFromBuffer(new Uint8Array(await file.arrayBuffer()));
}
