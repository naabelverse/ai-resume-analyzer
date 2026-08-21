import { crc32 } from "node:zlib";

/**
 * Test fixtures, built in memory rather than committed as binaries.
 *
 * A checked-in `sample.pdf` tells you nothing about why it is shaped the way
 * it is, and nobody can adjust it without a copy of Word. These builders make
 * the fixture's contents part of the test that uses it: a test that needs a
 * two-page resume with nine bullets asks for exactly that.
 *
 * Both writers are deliberately minimal. The PDF is uncompressed with a real
 * cross-reference table, and the DOCX is a ZIP with stored (uncompressed)
 * entries — enough for PDF.js and mammoth respectively, and nothing more.
 */

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ------------------------------------------------------------------ PDF -- */

/** Escapes the three characters that are special inside a PDF string literal. */
function pdfEscape(line: string): string {
  return line
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function contentStream(lines: string[]): string {
  const drawn = lines.map((line) => `(${pdfEscape(line)}) Tj T*`).join("\n");
  return `BT\n/F1 11 Tf\n72 720 Td\n14 TL\n${drawn}\nET`;
}

/**
 * Builds a PDF whose pages carry the given lines of text.
 *
 * Pass `[[]]` for a single page with no text at all — that is the "scanned
 * document" case, where a real scan would carry an image the app deliberately
 * does not OCR.
 */
export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 2);
  const kids = pageObjectNumbers.map((number) => `${number} 0 R`).join(" ");
  const fontNumber = 3 + pages.length * 2;

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`;

  pages.forEach((lines, index) => {
    const pageNumber = pageObjectNumbers[index]!;
    const stream = contentStream(lines);

    objects[pageNumber] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontNumber} 0 R >> >> ` +
      `/Contents ${pageNumber + 1} 0 R >>`;
    objects[pageNumber + 1] =
      `<< /Length ${bytes(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  objects[fontNumber] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  // Assemble, recording each object's byte offset for the xref table.
  const chunks: Uint8Array[] = [bytes("%PDF-1.4\n")];
  let offset = chunks[0]!.length;
  const offsets: number[] = [];

  for (let number = 1; number <= fontNumber; number += 1) {
    offsets[number] = offset;
    const chunk = bytes(`${number} 0 obj\n${objects[number]}\nendobj\n`);
    chunks.push(chunk);
    offset += chunk.length;
  }

  const size = fontNumber + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let number = 1; number <= fontNumber; number += 1) {
    xref += `${String(offsets[number]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;

  chunks.push(bytes(xref));
  return concat(chunks);
}

/* ----------------------------------------------------------------- ZIP --- */

interface ZipEntry {
  name: string;
  content: string;
}

function u16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

/**
 * Stored-entry ZIP writer. No compression, which keeps this to a few dozen
 * lines and costs nothing at these sizes — and it means entry names sit in the
 * file as plain ASCII, which is exactly what the DOCX mime sniff looks for.
 */
export function makeZip(entries: ZipEntry[]): Uint8Array {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = bytes(entry.name);
    const data = bytes(entry.content);
    const sum = crc32(Buffer.from(data));

    const header = concat([
      u32(0x04034b50),
      u16(20), // version needed
      u16(0), // flags
      u16(0), // method: stored
      u16(0), // mod time
      u16(0x21), // mod date — 1 Jan 1980, the ZIP epoch
      u32(sum),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0), // extra field length
      name,
      data,
    ]);

    central.push(
      concat([
        u32(0x02014b50),
        u16(20), // version made by
        u16(20), // version needed
        u16(0),
        u16(0),
        u16(0),
        u16(0x21),
        u32(sum),
        u32(data.length),
        u32(data.length),
        u16(name.length),
        u16(0), // extra
        u16(0), // comment
        u16(0), // disk number
        u16(0), // internal attrs
        u32(0), // external attrs
        u32(offset),
        name,
      ]),
    );

    local.push(header);
    offset += header.length;
  }

  const centralBytes = concat(central);
  const eocd = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);

  return concat([...local, centralBytes, eocd]);
}

/* ---------------------------------------------------------------- DOCX --- */

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A DOCX carrying one `<w:p>` paragraph per supplied line. */
export function makeDocx(paragraphs: string[]): Uint8Array {
  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`,
    )
    .join("");

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}</w:body>
</w:document>`;

  return makeZip([
    { name: "[Content_Types].xml", content: CONTENT_TYPES },
    { name: "_rels/.rels", content: RELS },
    { name: "word/document.xml", content: document },
  ]);
}

/**
 * The OLE2 compound-file header a pre-2007 `.doc` starts with. Only the magic
 * bytes matter — the app rejects the format on sight and never parses further.
 */
export function makeLegacyDoc(): Uint8Array {
  const header = new Uint8Array(512);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  return header;
}

/* ------------------------------------------------------- sample content -- */

/** A realistic resume body, long enough to clear the 200-character floor. */
export const RESUME_LINES = [
  "MUHAMMAD NABIL",
  "muhammad.nabil@example.com | +44 7700 900123 | github.com/muhammadnabil",
  "",
  "SUMMARY",
  "Backend engineer with four years building payment and booking systems.",
  "",
  "EXPERIENCE",
  "Senior Engineer, Northwind Ltd, 2023 to present",
  "- Reduced p95 checkout latency from 820ms to 140ms across three services.",
  "- Migrated the booking service from MySQL to PostgreSQL with no downtime.",
  "- Responsible for maintaining the notification pipeline.",
  "Engineer, Contoso, 2021 to 2023",
  "- Built the internal admin dashboard in React and TypeScript.",
  "- Added covering indexes that cut report load times from 9s to 1.2s.",
  "",
  "EDUCATION",
  "BSc Computer Science, University of Leeds, 2021",
  "",
  "SKILLS",
  "TypeScript, Node.js, PostgreSQL, Docker, React, REST APIs",
];

export function sampleResumePdf(): Uint8Array {
  return makePdf([RESUME_LINES]);
}

export function sampleResumeDocx(): Uint8Array {
  return makeDocx(RESUME_LINES);
}

/** A page with no text layer at all — the "you scanned a printout" case. */
export function scannedPdf(): Uint8Array {
  return makePdf([[]]);
}

/** Long enough to cross the 15,000-character truncation boundary. */
export function oversizeResumePdf(): Uint8Array {
  const filler = Array.from(
    { length: 540 },
    (_, index) =>
      `- Delivered project ${index} covering integration, testing and rollout for the platform team.`,
  );

  // Chunked into page-sized runs on purpose: PDF.js discards text drawn
  // outside the MediaBox, so piling every line onto one page would silently
  // produce a much smaller fixture than the line count suggests.
  const LINES_PER_PAGE = 45;
  const pages: string[][] = [RESUME_LINES];
  for (let i = 0; i < filler.length; i += LINES_PER_PAGE) {
    pages.push(filler.slice(i, i + LINES_PER_PAGE));
  }
  pages.push(["FINAL PAGE MARKER", "Certifications: AWS Solutions Architect Associate."]);

  return makePdf(pages);
}
