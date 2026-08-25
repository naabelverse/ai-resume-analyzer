import { describe, expect, it } from "vitest";

import { clampToWord, repairTruncation, stripLeadingMarker } from "@/lib/text";

describe("clampToWord", () => {
  it("leaves text within the limit alone", () => {
    expect(clampToWord("short", 100)).toBe("short");
  });

  it("marks the cut and never exceeds the limit", () => {
    const out = clampToWord("a".repeat(50) + " " + "b".repeat(50), 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
  });

  it("prefers a word boundary when one is near the end", () => {
    expect(clampToWord("alpha beta gamma delta", 18)).toBe("alpha beta gamma…");
  });

  it("does not strand a dangling comma before the ellipsis", () => {
    expect(clampToWord("alpha beta, gamma delta", 14)).toBe("alpha beta…");
  });
});

describe("repairTruncation", () => {
  const LIMIT = 300;
  const atCap = (tail: string) => "x ".repeat(140).slice(0, LIMIT - tail.length) + tail;

  it("leaves a finished sentence alone even at the cap", () => {
    const text = atCap("done.");
    expect(repairTruncation(text, LIMIT)).toBe(text);
  });

  it("leaves short text alone, full stop or not", () => {
    expect(repairTruncation("A sentence with no period", LIMIT)).toBe(
      "A sentence with no period",
    );
  });

  /**
   * The live symptom: constrained decoding stops at maxLength mid-word, with no
   * marker. Observed as "...requirements for Go/Python, PostgreSQL, AWS,,K".
   */
  it("marks a mid-word cut sitting at the cap", () => {
    const out = repairTruncation(atCap("PostgreSQL, AWS,,K"), LIMIT);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("AWS,,K");
    expect(out.length).toBeLessThanOrEqual(LIMIT);
  });

  it("handles a cut that left a bare trailing space", () => {
    const out = repairTruncation(atCap("in payments using "), LIMIT);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });

  /**
   * Over-cap output is the retry's business, not this function's. Structured
   * outputs on Anthropic do not enforce maxLength, so trimming here would hide
   * exactly the failure the retry exists to catch.
   */
  it("passes over-cap text through untouched so validation still rejects it", () => {
    const tooLong = "y".repeat(LIMIT + 40);
    expect(repairTruncation(tooLong, LIMIT)).toBe(tooLong);
  });

  it("never lengthens the string", () => {
    for (const tail of ["abc", "a b", "…", "word", " "]) {
      const text = atCap(tail);
      expect(repairTruncation(text, LIMIT).length).toBeLessThanOrEqual(
        text.length,
      );
    }
  });

  it("copes with a single unbroken token", () => {
    const out = repairTruncation("z".repeat(LIMIT), LIMIT);
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("stripLeadingMarker", () => {
  const SENTENCE = "Responsible for maintaining the booking service.";

  /**
   * The only marker in the captured output is U+002D, because all three
   * quality fixtures use "- " and nothing else — 31 line starts, one glyph.
   * The bullet reported from production comes from real resumes, which the
   * fixtures do not model, so the set below is deliberately wider than the
   * evidence on disk. Listed one per case so a failure names the code point.
   */
  const GLYPHS = ["•", "·", "‣", "⁃", "∙", "▪", "▫", "■", "□", "●", "○", "◦"];

  it.each(GLYPHS)("strips the %s bullet with its whitespace", (glyph) => {
    expect(stripLeadingMarker(`${glyph} ${SENTENCE}`)).toBe(SENTENCE);
  });

  it.each(GLYPHS)("strips %s even with no space after it", (glyph) => {
    expect(stripLeadingMarker(`${glyph}${SENTENCE}`)).toBe(SENTENCE);
  });

  it.each(["-", "*", "–", "—", "−"])(
    "strips the ambiguous %s marker when a space follows",
    (marker) => {
      expect(stripLeadingMarker(`${marker} ${SENTENCE}`)).toBe(SENTENCE);
    },
  );

  /**
   * RULE 1 tells `detail` to OPEN with the quote, so this — not a bare marker
   * at index 0 — is the shape the bug actually arrives in.
   */
  it("strips a marker sitting just inside the opening quote", () => {
    expect(stripLeadingMarker(`"• ${SENTENCE}"`)).toBe(`"${SENTENCE}"`);
    expect(stripLeadingMarker(`“- ${SENTENCE}”`)).toBe(`“${SENTENCE}”`);
  });

  it("leaves a dash that is punctuation alone", () => {
    const dashed = "That bullet — the booking one — names a duty.";
    expect(stripLeadingMarker(dashed)).toBe(dashed);
  });

  /** Why the ambiguous set needs a following space and the glyphs do not. */
  it("leaves a quote that opens on a negative figure alone", () => {
    const figure = '"-15% margin on settlement" is the only number here.';
    expect(stripLeadingMarker(figure)).toBe(figure);
    expect(stripLeadingMarker("*emphasis* was used instead of a heading.")).toBe(
      "*emphasis* was used instead of a heading.",
    );
  });

  it("leaves ordinary prose untouched", () => {
    expect(stripLeadingMarker(SENTENCE)).toBe(SENTENCE);
    expect(stripLeadingMarker("")).toBe("");
  });

  /** One marker, not a run — see the docblock. */
  it("strips only the first marker", () => {
    expect(stripLeadingMarker(`• • ${SENTENCE}`)).toBe(`• ${SENTENCE}`);
  });

  it("never lengthens the string", () => {
    for (const input of ["• a", "- b", SENTENCE, "", "-", "•"]) {
      expect(stripLeadingMarker(input).length).toBeLessThanOrEqual(input.length);
    }
  });
});
