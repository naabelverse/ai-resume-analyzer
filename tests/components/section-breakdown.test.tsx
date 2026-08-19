// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionBreakdown } from "@/components/analysis/section-breakdown";
import type { SectionScore } from "@/types";

/**
 * The status labels have to describe a score band, not a presence. `fail` is
 * everything below 50, so a section can be a fail and still be on the page —
 * the label read "Missing" over a section scoring 40 whose own note said the
 * bullets were there.
 */
describe("SectionBreakdown", () => {
  const weak: SectionScore = {
    name: "experience",
    score: 40,
    status: "fail",
    note: "All bullets describe duties without outcomes",
  };

  it("does not claim a low-scoring section is absent", () => {
    render(<SectionBreakdown sections={[weak]} />);

    expect(screen.queryByText("Missing")).not.toBeInTheDocument();
    expect(screen.getByText("Poor")).toBeInTheDocument();
  });

  it("uses the same label for a section that really is absent", () => {
    render(
      <SectionBreakdown
        sections={[{ ...weak, score: 0, note: "No experience section found" }]}
      />,
    );

    expect(screen.getByText("Poor")).toBeInTheDocument();
  });

  it.each([
    ["pass", 88, "Pass"],
    ["warn", 62, "Needs work"],
    ["fail", 40, "Poor"],
  ] as const)("labels a %s section %s", (status, score, label) => {
    render(<SectionBreakdown sections={[{ ...weak, status, score }]} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(String(score))).toBeInTheDocument();
  });
});
