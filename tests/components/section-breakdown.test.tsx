// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionBreakdown } from "@/components/analysis/section-breakdown";
import { statusFor } from "@/lib/scoring";
import { STATUS_THRESHOLDS } from "@/lib/schema/analysis";
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

  /*
    Degraded: the note survives, every grade goes.

    Suppressing the gauge alone would have moved the misleading grade 400px
    down the page instead of removing it — these rows carry a 0-100 number, a
    coloured bar and a "Pass"/"Poor" badge derived from the same structural
    signals the gauge was. The note stays because `lib/scoring.ts` writes it as
    a measurement, which is what this state can honestly report.
  */
  it("shows no score, badge or bar when degraded", () => {
    const { container } = render(
      <SectionBreakdown sections={[weak]} degraded />,
    );

    expect(screen.getByText(weak.note)).toBeInTheDocument();
    expect(screen.getByText("Experience")).toBeInTheDocument();

    expect(screen.queryByText("Poor")).not.toBeInTheDocument();
    expect(screen.queryByText(String(weak.score))).not.toBeInTheDocument();
    expect(container.querySelector(".bg-danger")).toBeNull();
    expect(container.querySelector(".bg-gauge-track")).toBeNull();
  });

  it("still grades when not degraded, so the flag is what decides", () => {
    const { container } = render(<SectionBreakdown sections={[weak]} />);

    expect(screen.getByText("Poor")).toBeInTheDocument();
    expect(screen.getByText(String(weak.score))).toBeInTheDocument();
    expect(container.querySelector(".bg-danger")).not.toBeNull();
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

const LABEL_FOR = { pass: "Pass", warn: "Needs work", fail: "Poor" } as const;

/**
 * The stored `status` is ignored; the score is the only source.
 *
 * `2b44aaf` stopped the MODEL supplying a status, but the field survives on a
 * stored `SectionScore`, so anything authoring a result by hand can still
 * carry one that disagrees with its own score. The demo fixture did — a
 * section scoring 45 beside a hardcoded "warn" — and that is what these pin
 * shut. Score, label and bar now come from one place on every path, including
 * records written before that commit.
 */
describe("SectionBreakdown — the status is derived, never read", () => {
  const base: SectionScore = {
    name: "summary",
    score: 45,
    status: "warn",
    note: "Opens with a generic phrase.",
  };

  it.each([
    ["fail scored, pass stored", 45, "pass", "Poor"],
    ["fail scored, warn stored", 45, "warn", "Poor"],
    ["pass scored, fail stored", 88, "fail", "Pass"],
    ["warn scored, pass stored", 62, "pass", "Needs work"],
  ] as const)("%s renders %s", (_name, score, stored, label) => {
    render(<SectionBreakdown sections={[{ ...base, score, status: stored }]} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText(String(score))).toBeInTheDocument();
  });

  /** The bar has to move with the label, or the contradiction just relocates. */
  it("colours the bar from the score, not the stored status", () => {
    const { container } = render(
      <SectionBreakdown sections={[{ ...base, score: 45, status: "pass" }]} />,
    );

    const bar = container.querySelector<HTMLElement>("div[style]");
    expect(bar?.className).toContain("bg-danger");
    expect(bar?.className).not.toContain("bg-success");
    expect(bar?.style.width).toBe("45%");
  });

  /** Boundaries read from STATUS_THRESHOLDS so this cannot drift from `statusFor`. */
  it("agrees with statusFor on both sides of each boundary", () => {
    for (const score of [
      100,
      STATUS_THRESHOLDS.pass,
      STATUS_THRESHOLDS.pass - 1,
      STATUS_THRESHOLDS.warn,
      STATUS_THRESHOLDS.warn - 1,
      0,
    ]) {
      const { unmount } = render(
        // Stored status is deliberately "pass" throughout, so anything reading
        // it instead of the score fails on every row but the first.
        <SectionBreakdown sections={[{ ...base, score, status: "pass" }]} />,
      );

      expect(screen.getByText(LABEL_FOR[statusFor(score)])).toBeInTheDocument();
      unmount();
    }
  });
});
