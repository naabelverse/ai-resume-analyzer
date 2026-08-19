import { describe, expect, it } from "vitest";

import { clampToWord, repairTruncation } from "@/lib/text";

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
