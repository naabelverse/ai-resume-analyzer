import { describe, expect, it } from "vitest";

import {
  clampToWord,
  markDanglingCut,
  maskNewFigures,
  normalisePlaceholders,
  repairTruncation,
  stripLeadingMarker,
  trimToSentence,
} from "@/lib/text";

describe("normalisePlaceholders", () => {
  it("rewrites other single-letter placeholders as [X] (live rewrite)", () => {
    expect(
      normalisePlaceholders("Cut load from [X]s to [Y]s, reducing bounce by [Z]% and [N%] errors."),
    ).toBe("Cut load from [X]s to [X]s, reducing bounce by [X]% and [X%] errors.");
  });
});

/**
 * A live section note, cut by the decoder at exactly the 230 cap on an OPENING
 * quote. `TERMINAL` accepted the `'` as a closing quote, so it passed as whole.
 */
const CUT_ON_OPENING_QUOTE =
  "Hardworking and passionate frontend developer and team player with experience " +
  "building web applications. Looking for a challenging role where I can grow my " +
  "skills. That opening spends your first line on subjective traits. Lead a '";

describe("trimToSentence", () => {
  it("is the live note at the cap", () => {
    expect(CUT_ON_OPENING_QUOTE.length).toBe(230);
  });

  it("trims a cut note back to its last complete sentence", () => {
    expect(trimToSentence(CUT_ON_OPENING_QUOTE, 230)).toBe(
      CUT_ON_OPENING_QUOTE.slice(0, CUT_ON_OPENING_QUOTE.indexOf(" Lead a '")),
    );
  });

  it("keeps a closing quote with the sentence it ends", () => {
    const note = "Only one bullet has a metric: 'cut abandonment 31% to 22%.' That is the";
    expect(trimToSentence(note, note.length)).toBe(
      "Only one bullet has a metric: 'cut abandonment 31% to 22%.'",
    );
  });

  it("ends on an ellipsis when there is no complete sentence to keep", () => {
    const note = "Lists tools without depth such as years of use or project scale or team";
    const out = trimToSentence(note, note.length);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(note.length);
  });

  it("leaves a note that ends complete at the cap alone", () => {
    const note = "Two sentences here. The second one finishes.";
    expect(trimToSentence(note, note.length)).toBe(note);
  });

  it("leaves a note well under the cap alone, finished or not", () => {
    expect(trimToSentence("Short note. And a fragment", 230)).toBe("Short note. And a fragment");
  });
});

describe("repairTruncation on an opening quote", () => {
  it("marks a cut that lands right after an opening quote", () => {
    const out = repairTruncation(CUT_ON_OPENING_QUOTE, 230);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("'…");
  });

  it("still treats a closing quote as finished", () => {
    const text = "x".repeat(20) + " ended on 'a quote'";
    expect(repairTruncation(text, text.length)).toBe(text);
  });
});

describe("maskNewFigures", () => {
  const original = "Worked on the team that migrated the storefront from jQuery to React.";

  it("replaces invented figures and keeps their units (live rewrites)", () => {
    expect(
      maskNewFigures(original, "Migrated 15+ product pages from jQuery to React."),
    ).toBe("Migrated [X]+ product pages from jQuery to React.");
    expect(
      maskNewFigures("Maintained the company marketing website.", "Maintained the site at 99.9% uptime."),
    ).toBe("Maintained the site at [X]% uptime.");
  });

  it("keeps figures the original already stated", () => {
    const from = "Rebuilt the checkout form, cutting abandonment from 31% to 22%.";
    const to = "Rebuilt the checkout in React, cutting abandonment from 31% to 22%.";
    expect(maskNewFigures(from, to)).toBe(to);
  });

  it("matches figures with and without grouping commas", () => {
    expect(maskNewFigures("Served 1200 users.", "Served 1,200 daily users.")).toBe(
      "Served 1,200 daily users.",
    );
  });

  it("treats p95 as text, so the demo rewrite is unchanged", () => {
    const demo =
      "Maintained a booking service handling [X] requests/day, cutting p95 latency from [X]ms to [X]ms.";
    expect(maskNewFigures("Responsible for maintaining the booking service.", demo)).toBe(demo);
  });

  it("treats numbers in names as text", () => {
    const to = "Upgraded to Node.js 20, fixed HTTP 500 errors and passed ISO 27001 audit.";
    expect(maskNewFigures("Maintained the API.", to)).toBe(to);
  });

  it("masks a figure after a capitalised verb that opens the bullet", () => {
    expect(maskNewFigures("Led the team.", "Led 5 engineers.")).toBe("Led [X] engineers.");
  });

  it("leaves a rewrite with no figures alone", () => {
    const to = "Built [X] screens of the admin dashboard in React and TypeScript.";
    expect(maskNewFigures(original, to)).toBe(to);
  });
});

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

describe("markDanglingCut", () => {
  /** `FIELD_CAPS.keyword`, the cap the observed pills were cut against. */
  const KEYWORD_CAP = 60;

  it("marks the observed pill that dangled on 'and' with no marker", () => {
    // 52 characters against a cap of 60 — eight clear of SUSPICION_WINDOW, so
    // repairTruncation cannot see it and leaves it untouched.
    const cut = "Willing to work rotating shifts including nights and";
    expect(cut).toHaveLength(52);
    expect(repairTruncation(cut, KEYWORD_CAP)).toBe(cut);

    expect(markDanglingCut(cut)).toBe(
      "Willing to work rotating shifts including nights and…",
    );
  });

  it.each([
    ["Experience with", "Experience with…"],
    ["Reporting to the", "Reporting to the…"],
    ["Rotating shifts including", "Rotating shifts including…"],
    ["Nights and weekends or", "Nights and weekends or…"],
    ["Handover, escalation and,", "Handover, escalation and…"],
  ])("marks %j", (input, expected) => {
    expect(markDanglingCut(input)).toBe(expected);
  });

  it.each([
    "IT",
    "Grade A",
    "Nursing",
    "Acute inpatient care",
    "Health and Safety",
    "Opt-in",
    "Band 5 Staff Nurse",
  ])("leaves the complete term %j alone", (term) => {
    expect(markDanglingCut(term)).toBe(term);
  });

  it("is idempotent — a term already marked keeps one ellipsis", () => {
    const once = markDanglingCut("Rotating shifts including");
    expect(markDanglingCut(once)).toBe(once);
    expect(once.endsWith("……")).toBe(false);
  });

  it("never lengthens a term past the keyword cap", () => {
    // A dangling word sitting exactly at the cap: the ellipsis has to replace
    // the characters it removes, not stack on top of them.
    const atCap = "coordination and escalation across the acute inpatient and";
    expect(atCap.length).toBeLessThanOrEqual(KEYWORD_CAP);
    expect(markDanglingCut(atCap).length).toBeLessThanOrEqual(KEYWORD_CAP);
  });

  /*
    The property the bug was: a term that renders must never end on a bare
    dangling word. Both passes run, in the order the keyword path runs them,
    across every cut position of a phrase that is over the cap.
  */
  it("marks every over-cap cut position, whichever pass catches it", () => {
    const phrase =
      "Willing to work rotating shifts including nights and weekends and public holidays";
    expect(phrase.length).toBeGreaterThan(KEYWORD_CAP);

    const DANGLES = /\s(a|an|the|and|or|but|nor|plus|of|to|in|on|at|for|with|by|from|as|into|onto|per|via|up|that|which|who|when|while|including|include|includes|such)$/;

    for (let cut = 2; cut <= KEYWORD_CAP; cut += 1) {
      const term = phrase.slice(0, cut);
      const rendered = markDanglingCut(
        repairTruncation(term, KEYWORD_CAP) as string,
      );

      expect(rendered.length).toBeLessThanOrEqual(KEYWORD_CAP);
      // Never a bare dangling word with nothing after it.
      expect(rendered).not.toMatch(DANGLES);
    }
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
