// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  IN_FLIGHT_CEILING,
  SCAN_STAGES,
  ScanningCard,
} from "@/components/analysis/scanning-card";

/**
 * The one invariant this component exists to protect.
 *
 * CLAUDE.md lists it among the things that look like style and are not: "The
 * scanning bar holds at 90% until the response lands. It must never claim
 * completion before the work is done." A bar that reaches 100% while the
 * request is still in flight is the specific dishonesty that makes most
 * progress bars useless — and it is invisible in review, because the code that
 * does it looks exactly like the code that does not.
 *
 * Nothing checked it until now. `IN_FLIGHT_CEILING` was exported and never
 * imported anywhere, which reads like an export made for a test that was never
 * written.
 *
 * The clamp lives in `<ScanningCard>` rather than in its caller, which is what
 * makes it testable here: `value = complete ? 100 : Math.min(progress,
 * IN_FLIGHT_CEILING)`. A caller passing a bad number cannot defeat it.
 */

/** Radix Progress reports its value on the progressbar role. */
function progressValue(): number {
  return Number(screen.getByRole("progressbar").getAttribute("aria-valuenow"));
}

describe("<ScanningCard> — the in-flight ceiling", () => {
  it("holds at the ceiling rather than the value it was handed", () => {
    render(<ScanningCard progress={100} />);
    expect(progressValue()).toBe(IN_FLIGHT_CEILING);
  });

  it.each([
    ["exactly the ceiling", IN_FLIGHT_CEILING],
    ["just past it", IN_FLIGHT_CEILING + 1],
    ["a full bar", 100],
    ["nonsense from a runaway timer", 10_000],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("never exceeds the ceiling in flight — %s", (_label, progress) => {
    // The caller computes an asymptotic curve that should never reach the
    // ceiling on its own. "Should never" is not "cannot", which is why the
    // clamp is here and why these cases are worth spelling out.
    render(<ScanningCard progress={progress} />);
    expect(progressValue()).toBeLessThanOrEqual(IN_FLIGHT_CEILING);
  });

  it("leaves a value below the ceiling alone", () => {
    // The clamp must not flatten real progress into a constant.
    render(<ScanningCard progress={42} />);
    expect(progressValue()).toBe(42);
  });

  it("defaults to a value below the ceiling", () => {
    render(<ScanningCard />);
    expect(progressValue()).toBeLessThan(IN_FLIGHT_CEILING);
  });
});

describe("<ScanningCard> — completion", () => {
  it("does not say it is done while the request is in flight", () => {
    render(<ScanningCard progress={IN_FLIGHT_CEILING} stageIndex={3} />);

    expect(screen.queryByText("Done")).not.toBeInTheDocument();
    // It names the stage it is actually on instead.
    expect(screen.getByText(SCAN_STAGES[3])).toBeInTheDocument();
  });

  it("reaches 100 only once the response has landed", () => {
    render(<ScanningCard progress={IN_FLIGHT_CEILING} complete />);

    expect(progressValue()).toBe(100);
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("completes even when the caller never got past a low value", () => {
    /*
      The response landing is what completes the bar — not the curve arriving
      anywhere in particular. A fast response finishes while the curve is still
      near the bottom, and the bar must jump to 100 rather than wait to reach a
      number it was never going to reach.
    */
    render(<ScanningCard progress={3} complete />);
    expect(progressValue()).toBe(100);
  });

  it("is the only thing that can produce 100", () => {
    // Sweep the in-flight range: no input short of `complete` reaches it.
    for (const progress of [0, 25, 50, 75, 89, 90, 91, 100, 500]) {
      const { unmount } = render(<ScanningCard progress={progress} />);
      expect(progressValue()).toBeLessThan(100);
      unmount();
    }
  });
});

describe("<ScanningCard> — stages", () => {
  it.each(SCAN_STAGES.map((stage, index) => [index, stage] as const))(
    "shows stage %i as %s",
    (index, stage) => {
      render(<ScanningCard stageIndex={index} />);
      expect(screen.getByText(stage)).toBeInTheDocument();
    },
  );

  it("holds on the last stage rather than running off the end", () => {
    // The caller advances stages on elapsed time, which has no upper bound; a
    // slow request must not render `undefined` under the spinner.
    render(<ScanningCard stageIndex={SCAN_STAGES.length + 5} />);
    expect(screen.getByText(SCAN_STAGES.at(-1)!)).toBeInTheDocument();
  });
});
