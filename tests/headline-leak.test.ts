import { describe, expect, it } from "vitest";

import { leakedHeadlines } from "./helpers";

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
