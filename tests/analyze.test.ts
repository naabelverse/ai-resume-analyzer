import { describe, expect, it } from "vitest";

import { mergeDuplicateFeedback } from "@/lib/ai/analyze";
import { ARRAY_CAPS, FIELD_CAPS, type FeedbackItem } from "@/lib/schema/analysis";

const LIVE_HEADLINE = "Only 1 of 8 experience bullets contains a measurable result";

const item = (
  text: string,
  status: FeedbackItem["status"] = "warn",
  detail = `${text} — detail.`,
): FeedbackItem => ({ status, text, detail });

describe("mergeDuplicateFeedback", () => {
  it("merges items that share a headline, keeping the first's place", () => {
    const merged = mergeDuplicateFeedback([
      item(LIVE_HEADLINE, "warn", "'Wrote unit tests' names a duty."),
      item("Your contact details sit in the page header", "fail"),
      item(LIVE_HEADLINE, "fail", "'Helped with code reviews' names a duty."),
      item("The summary opens with 'hardworking'", "warn"),
      item("Your one quantified result is strong", "pass"),
    ]);

    expect(merged.map(({ text }) => text)).toEqual([
      LIVE_HEADLINE,
      "Your contact details sit in the page header",
      "The summary opens with 'hardworking'",
      "Your one quantified result is strong",
    ]);
    expect(merged[0]).toEqual({
      text: LIVE_HEADLINE,
      status: "fail",
      detail: "'Wrote unit tests' names a duty. 'Helped with code reviews' names a duty.",
    });
  });

  it("matches headlines case-insensitively and ignoring outer whitespace", () => {
    const merged = mergeDuplicateFeedback([
      item("Tense is inconsistent"),
      item("  tense is INCONSISTENT "),
      item("Skills are specific", "pass"),
      item("Layout parses cleanly", "pass"),
      item("Dates are consistent", "pass"),
    ]);
    expect(merged).toHaveLength(4);
  });

  it("keeps the merged detail within the detail cap", () => {
    const long = "word ".repeat(70).trim();
    const merged = mergeDuplicateFeedback([
      item("A", "warn", long),
      item("a", "warn", long),
      item("B"),
      item("C"),
      item("D"),
    ]);
    expect(merged[0].detail.length).toBeLessThanOrEqual(FIELD_CAPS.feedbackDetail);
    expect(merged[0].detail.endsWith("…")).toBe(true);
  });

  it("leaves the items alone when merging would fall below the minimum (the live run)", () => {
    // Seven copies of one headline and one other: two distinct items, under
    // the schema minimum, so the list is returned as it came.
    const live = [
      ...Array.from({ length: 7 }, (_, i) => item(LIVE_HEADLINE, "fail", `Bullet ${i}.`)),
      item("Your one quantified result is strong and relevant", "pass"),
    ];
    expect(ARRAY_CAPS.feedbackMin).toBeGreaterThan(2);
    expect(mergeDuplicateFeedback(live)).toBe(live);
  });

  it("returns the same list when nothing repeats", () => {
    const items = [item("One"), item("Two"), item("Three")];
    expect(mergeDuplicateFeedback(items)).toBe(items);
  });
});
