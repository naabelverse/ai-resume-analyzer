import { describe, expect, it } from "vitest";

import { leakedHeadlines, restatementOverlap } from "./helpers";

/**
 * The detector that guards `feedback[].text`, tested on the strings that
 * actually leaked.
 *
 * The live suite it serves costs fifteen paid calls, so it is run rarely and
 * its assertions are only as good as this. A detector that silently stopped
 * matching would report a clean run forever — which is precisely how the
 * original bug survived: the metric of the day inspected `detail` alone and
 * reported "5/5 feedback items quote the resume" on a run whose every headline
 * was a JSON key.
 */
describe("leakedHeadlines", () => {
  /**
   * The production report. Note "Relevance to target role": the rubric says
   * "Relevance to the target role", so this one is NOT verbatim, and an exact
   * comparison against the rubric would have missed the very case that was
   * reported.
   */
  it("catches the rubric headings, verbatim or not", () => {
    const leaked = [
      "Impact and quantification",
      "Relevance to target role",
      "Clarity and concision",
      "Structure and completeness",
      "Skills and technologies",
      "ATS-friendliness",
    ];
    expect(leakedHeadlines(leaked)).toEqual(leaked);
  });

  /** Two live runs, which reached for the schema's key names instead. */
  it("catches schema key names, whatever their case", () => {
    const leaked = ["impact", "relevance", "clarity", "skills", "ats", "contact"];
    expect(leakedHeadlines(leaked)).toEqual(leaked);
    expect(leakedHeadlines(["Summary", "Experience", "Skills"])).toEqual([
      "Summary",
      "Experience",
      "Skills",
    ]);
  });

  /**
   * The other half of the job. A detector that fires on real findings would be
   * abandoned within a week, and these are real: three from the placeholder
   * report, two from a live run that behaved.
   */
  it("passes headlines that state a finding", () => {
    expect(
      leakedHeadlines([
        "Your contact details are inside the page header",
        "Only 2 of 11 experience bullets contain a measurable result",
        "The summary opens with 'hardworking team player'",
        "Your resume uses a clean, single-column format that is highly ATS-friendly",
        "Your experience bullets are excellent examples of impact-driven writing",
        "Skills section is specific and current",
      ]),
    ).toEqual([]);
  });

  it("reports only the offenders when a run is mixed", () => {
    expect(
      leakedHeadlines([
        "Add a dedicated Skills section",
        "Impact and quantification",
        "Trim verbose academic descriptions for tighter readability",
        "ATS-friendliness",
      ]),
    ).toEqual(["Impact and quantification", "ATS-friendliness"]);
  });
});

/**
 * The restatement metric, which exists because an item whose `detail` repeats
 * its `text` spends both fields saying one thing — the expanded row then adds
 * nothing the collapsed row did not already show.
 */
describe("restatementOverlap", () => {
  it("scores a near-verbatim restatement high", () => {
    expect(
      restatementOverlap(
        "Your contact details sit inside the page header",
        "Your contact details sit inside the page header, which is a problem.",
      ),
    ).toBeGreaterThanOrEqual(0.6);
  });

  it("scores a detail that quotes and then advises low", () => {
    expect(
      restatementOverlap(
        "Only 2 of 11 experience bullets contain a measurable result",
        '"Responsible for maintaining the booking service" describes a duty, not a result. Say what changed and by how much.',
      ),
    ).toBeLessThan(0.6);
  });

  /** Every real pair measured off disk scored under 40%. */
  it("does not fire on the shipped placeholder report", () => {
    expect(
      restatementOverlap(
        "Your contact details are inside the page header",
        "Several applicant tracking systems ignore header and footer regions entirely, so your email and phone number may never reach a recruiter.",
      ),
    ).toBeLessThan(0.6);
  });

  it("is 0 when either side has no content words", () => {
    expect(restatementOverlap("", "anything at all here")).toBe(0);
    expect(restatementOverlap("a to the of", "anything at all here")).toBe(0);
  });
});
