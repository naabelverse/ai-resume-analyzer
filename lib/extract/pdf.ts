import "server-only";

import { extractText, getDocumentProxy } from "unpdf";

import { ExtractionFailedError } from "@/lib/errors";

/**
 * `unpdf` is PDF.js in a serverless-optimised build with no native
 * dependencies — chosen over `pdf-parse`, whose current major pulls in
 * `@napi-rs/canvas` (a native `.node` binary used only for image features)
 * and reliably breaks serverless bundling.
 *
 * No OCR is attempted. A scanned PDF yields no text and is rejected upstream
 * with a message telling the user to export a text-based copy.
 */
export async function extractFromPdf(
  bytes: Uint8Array,
): Promise<{ text: string; pageCount: number }> {
  try {
    // PDF.js takes ownership of the array it is handed and may detach it, so
    // it gets a copy — the caller's buffer stays valid for mime re-sniffing.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    return { text, pageCount: totalPages };
  } catch (cause) {
    // Corrupt, password-protected, or not really a PDF despite the header.
    throw new ExtractionFailedError(cause);
  }
}
