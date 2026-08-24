// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { FeedbackList } from "@/components/analysis/feedback-list";
import type { FeedbackItem } from "@/types";

/**
 * Mixed statuses, in the shape a strong resume produces: the model is told that
 * if the resume does something genuinely well, at least one item must be a
 * "pass" that quotes it. A run where every item came back "fail" is what this
 * file exists to make visible — the list has to render all three states, in
 * severity order, without losing any of them.
 */
const MIXED: FeedbackItem[] = [
  {
    status: "pass",
    text: "Nearly every bullet reports a measurable outcome",
    detail:
      '"Reduced p99 latency from 1.4s to 310ms" is exactly what a reviewer stops for: a number, a baseline, and a result.',
  },
  {
    status: "warn",
    text: "The summary repeats what the bullets already prove",
    detail:
      '"Backend engineer with five years on payments" restates the experience section. Use the space for the one thing the bullets cannot show.',
  },
  {
    status: "fail",
    text: "No profile or portfolio link appears in the document",
    detail:
      "For a backend role a reviewer usually looks for one. Add a single relevant link near your contact details.",
  },
];

describe("FeedbackList", () => {
  it("renders every status, not just the worst one", () => {
    render(<FeedbackList items={MIXED} />);

    for (const item of MIXED) {
      expect(screen.getByText(item.text)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("orders the most actionable first", () => {
    render(<FeedbackList items={MIXED} />);

    const rendered = screen
      .getAllByRole("listitem")
      .map((row) => within(row).getByRole("button").textContent ?? "");

    expect(rendered[0]).toContain("No profile or portfolio link");
    expect(rendered[1]).toContain("The summary repeats");
    expect(rendered[2]).toContain("Nearly every bullet");
  });

  it("keeps a pass item when it is the only one", () => {
    const single: FeedbackItem[] = [MIXED[0]!];
    render(<FeedbackList items={single} />);

    expect(screen.getByText(single[0]!.text)).toBeInTheDocument();
  });

  it("reveals the quoted detail on expand", async () => {
    const user = userEvent.setup();
    render(<FeedbackList items={MIXED} />);

    const passRow = screen.getByText(MIXED[0]!.text).closest("button")!;
    expect(passRow).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(MIXED[0]!.detail)).not.toBeInTheDocument();

    await user.click(passRow);

    expect(passRow).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(MIXED[0]!.detail)).toBeInTheDocument();
  });

  it("does not mutate the array it is given", () => {
    const items = [...MIXED];
    const before = items.map((item) => item.status);
    render(<FeedbackList items={items} />);

    expect(items.map((item) => item.status)).toEqual(before);
  });
});

/**
 * A live run returned headlines averaging 79.4 characters against a cap of 90,
 * two of five sitting on the cap. Nothing in this component clamped them, so a
 * headline that long wrapped into a block of body text and was reported as an
 * item "showing its detail without being expanded". The cap is 70 now, but the
 * clamp is what makes the row robust to a response that ignores it.
 */
describe("FeedbackList headline length", () => {
  const LONG: FeedbackItem = {
    status: "warn",
    text: "This bullet describes a duty rather than an outcome so add a metric here",
    detail: '"Responsible for maintaining the notification pipeline." Say what changed.',
  };

  it("clamps the headline while collapsed and releases it once open", async () => {
    const user = userEvent.setup();
    render(<FeedbackList items={[LONG]} />);

    const headline = screen.getByText(LONG.text);
    expect(headline.className).toContain("line-clamp-2");

    await user.click(screen.getByRole("button"));
    expect(headline.className).not.toContain("line-clamp-2");
  });

  it("still shows the detail only once expanded", async () => {
    const user = userEvent.setup();
    render(<FeedbackList items={[LONG]} />);

    expect(screen.queryByText(LONG.detail)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button"));
    expect(screen.getByText(LONG.detail)).toBeInTheDocument();
  });
});
