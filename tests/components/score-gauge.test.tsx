// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScoreGauge } from "@/components/analysis/score-gauge";

describe("ScoreGauge", () => {
  it("shows the score and the verdict label", () => {
    render(<ScoreGauge score={72} verdict="good" />);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("Good work")).toBeInTheDocument();
  });

  it("exposes the score to assistive technology, not just to sighted users", () => {
    render(<ScoreGauge score={91} verdict="great" />);

    expect(
      screen.getByRole("img", { name: /score 91 out of 100.*great job/i }),
    ).toBeInTheDocument();
  });

  it("reserves its box before animating, so the gauge cannot shift layout", () => {
    const { container } = render(<ScoreGauge score={50} verdict="needs-work" />);
    const box = container.firstElementChild as HTMLElement;

    expect(box.style.width).toBe("180px");
    expect(box.style.height).toBe("180px");
  });

  it.each([
    [-20, "0"],
    [140, "100"],
    [72.6, "73"],
  ])("clamps and rounds %s to %s", (input, expected) => {
    render(<ScoreGauge score={input} verdict="good" />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
