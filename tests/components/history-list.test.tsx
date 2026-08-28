// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { HistoryList } from "@/components/dashboard/history-list";
import { STATUS_THRESHOLDS } from "@/lib/schema/analysis";
import { VERDICT_BADGE, deriveVerdict } from "@/types";
import type { AnalysisSummary } from "@/types";

/**
 * The dashboard badge was the last score in the app painted one colour at every
 * value, and banding it created the risk this file exists to close: a second
 * copy of the thresholds, somewhere decorative, drifting away from the ones the
 * report is graded on.
 *
 * `4a99c2e` fixed that failure for section rows and the verdict unification
 * fixed it for the gauge. Both times the defect was two sources for one fact,
 * and both times it surfaced as a colour disagreeing with a number a reader
 * could see beside it.
 *
 * So this asserts against `deriveVerdict` rather than against a list of
 * expected class names. A hardcoded expectation would pass just as happily on a
 * component that had grown its own copy of the bands — it would only start
 * failing once the two had already drifted, which is the bug rather than a
 * warning of it. Comparing against the derivation means the test tracks
 * whatever `STATUS_THRESHOLDS` becomes.
 *
 * The scores are computed from `STATUS_THRESHOLDS` for the same reason. Writing
 * 75/74/50/49 here would quietly start testing the interior of the bands the
 * moment anyone moved the constant.
 *
 * Note which function is the reference. `statusFor` applies the identical
 * boundaries, but it lives in `lib/scoring.ts`, which imports `lib/text.ts`,
 * which is `server-only` — so a client component cannot reach it, and
 * `deriveVerdict` is the one of the pair that crosses the boundary.
 */
describe("HistoryList score badge", () => {
  /** Both edges of both boundaries: the first value in a band, and the last below it. */
  const BOUNDARIES = [
    STATUS_THRESHOLDS.pass,
    STATUS_THRESHOLDS.pass - 1,
    STATUS_THRESHOLDS.warn,
    STATUS_THRESHOLDS.warn - 1,
  ];

  beforeEach(() => {
    // `NEXT_PUBLIC_PERSISTENCE` is unset under test, so `store` resolves to the
    // session store and its index is plain `sessionStorage`. Seeding that
    // exercises the real read path rather than a mock of it.
    const index: AnalysisSummary[] = BOUNDARIES.map((score, i) => ({
      id: `r${i}`,
      fileName: `score-${score}.pdf`,
      createdAt: new Date(Date.UTC(2026, 7, 28, 12, 0, i)).toISOString(),
      overallScore: score,
      // Stated so `list()` resolves without a record lookup, and because a
      // degraded row deliberately shows no grade to colour.
      degraded: false,
    }));
    window.sessionStorage.setItem("ara:index", JSON.stringify(index));
  });

  it("colours every badge by deriveVerdict, on both edges of both boundaries", async () => {
    render(<HistoryList />);

    for (const score of BOUNDARIES) {
      const badge = await screen.findByText(String(score));
      expect(badge.className).toContain(VERDICT_BADGE[deriveVerdict(score)]);
    }
  });
});
