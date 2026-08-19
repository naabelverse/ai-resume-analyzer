import "server-only";

import mammoth from "mammoth";

import { ExtractionFailedError } from "@/lib/errors";

/**
 * `extractRawText` deliberately, not `convertToHtml`: the model wants the
 * words and their line structure, not markup it has to see past. DOCX carries
 * no page count — pagination is a rendering decision Word makes at print
 * time — so callers get `null` for it rather than a fabricated number.
 */
export async function extractFromDocx(
  bytes: Uint8Array,
): Promise<{ text: string }> {
  try {
    const { value } = await mammoth.extractRawText({
      buffer: Buffer.from(bytes),
    });

    return { text: value };
  } catch (cause) {
    throw new ExtractionFailedError(cause);
  }
}
