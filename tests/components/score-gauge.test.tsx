// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScoreGauge } from "@/components/analysis/score-gauge";
import { STATUS_THRESHOLDS } from "@/lib/schema/analysis";

/** The sweeping arc; the first circle is the static track behind it. */
function arcOf(container: HTMLElement): SVGCircleElement {
  return container.querySelectorAll("circle")[1] as SVGCircleElement;
}

describe("ScoreGauge", () => {
  it("shows the score and the verdict label", () => {
    render(<ScoreGauge score={72} />);

    expect(screen.getByText("72")).toBeInTheDocument();
    expect(screen.getByText("Needs work")).toBeInTheDocument();
  });

  it("exposes the score to assistive technology, not just to sighted users", () => {
    render(<ScoreGauge score={91} />);

    expect(
      screen.getByRole("img", { name: /score 91 out of 100.*strong/i }),
    ).toBeInTheDocument();
  });

  it("reserves its box before animating, so the gauge cannot shift layout", () => {
    const { container } = render(<ScoreGauge score={50} />);
    const box = container.firstElementChild as HTMLElement;

    expect(box.style.width).toBe("180px");
    expect(box.style.height).toBe("180px");
  });

  it.each([
    [-20, "0"],
    [140, "100"],
    [72.6, "73"],
  ])("clamps and rounds %s to %s", (input, expected) => {
    render(<ScoreGauge score={input} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  /*
    Boundaries read from `STATUS_THRESHOLDS`, so this cannot drift from
    `statusFor` — the same way `section-breakdown.test.tsx` reads them. The
    ring and the section bars are asserted against one constant because they
    are now one banding system.
  */
  it.each([
    [STATUS_THRESHOLDS.warn - 1, "Poor", "var(--danger)"],
    [STATUS_THRESHOLDS.warn, "Needs work", "var(--warning)"],
    [STATUS_THRESHOLDS.pass - 1, "Needs work", "var(--warning)"],
    [STATUS_THRESHOLDS.pass, "Strong", "var(--success)"],
  ])("bands %i as %s and strokes the ring to match", (score, label, stroke) => {
    const { container } = render(<ScoreGauge score={score} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(arcOf(container)).toHaveAttribute("stroke", stroke);
  });

  /*
    The ring used to be a blue-purple brand gradient — decoration where every
    other metric in the report states its status in colour. It also put two raw
    hex values in a component, which `app/globals.css` is supposed to be the
    only home for.
  */
  it("carries no gradient fill, so the ring's colour is the status", () => {
    const { container } = render(<ScoreGauge score={91} />);

    expect(container.querySelector("linearGradient")).toBeNull();
    expect(arcOf(container).getAttribute("stroke")).not.toContain("url(");
  });

  /*
    The number and the band both come from the rounded value. Rendering "75"
    beside a label banded on the 74.6 that came in would put a reader's own
    arithmetic in conflict with the words next to it.
  */
  it("bands the number it renders, not the one it was passed", () => {
    const { container } = render(
      <ScoreGauge score={STATUS_THRESHOLDS.pass - 0.4} />,
    );

    expect(screen.getByText(String(STATUS_THRESHOLDS.pass))).toBeInTheDocument();
    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(arcOf(container)).toHaveAttribute("stroke", "var(--success)");
  });
});
