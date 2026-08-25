import { describe, expect, it } from "vitest";

import {
  endsAtQuote,
  leakedHeadlines,
  quoteCoverage,
  restatementOverlap,
} from "./helpers";

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

/**
 * The detector for a `detail` that quotes the resume and then stops, tested
 * against the shape reported from production.
 *
 * The resume below is an excerpt in the same style as the quality fixtures: the
 * summary line is the one the reported item quoted, and the experience bullet
 * gives the detector a second quotable span so the two-quote case is real
 * rather than contrived.
 */
const RESUME = `PROFESSIONAL SUMMARY
Backend engineer with six years building payment and settlement systems for
high-volume marketplaces in Southeast Asia.

WORK EXPERIENCE
Senior Backend Engineer, Halcyon Pay - 2021 to Present
- Responsible for maintaining the booking service used by partner airlines.
- Cut settlement reconciliation latency from 40 minutes to under 3 minutes.`;

/** The reported item, verbatim. Seventeen words, none of them the model's. */
const REPORTED_DETAIL =
  "Backend engineer with six years building payment and settlement systems " +
  "for high-volume marketplaces in Southeast Asia.";

describe("quoteCoverage", () => {
  it("attributes every word of the reported detail to the resume", () => {
    expect(quoteCoverage(REPORTED_DETAIL, RESUME)).toEqual({
      fromResume: 17,
      ownWords: 0,
    });
  });

  /**
   * The property the contiguity rule exists for. "settlement" appears in the
   * resume, but scattered through advice rather than consecutively, so it stays
   * counted as the model's own — a per-word overlap would have subtracted it
   * and pulled a good detail toward the threshold.
   */
  it("does not credit advice that merely reuses a resume word", () => {
    const { ownWords } = quoteCoverage(
      `"Backend engineer with six years building payment and settlement ` +
        `systems" leads on a title. Open on the settlement volume instead.`,
      RESUME,
    );
    expect(ownWords).toBeGreaterThan(3);
  });
});

describe("endsAtQuote", () => {
  /** The production failure: the candidate's own line, handed back unchanged. */
  it("catches a detail that is the resume verbatim", () => {
    expect(endsAtQuote(REPORTED_DETAIL, RESUME)).toBe(true);
  });

  /**
   * The same failure wearing three words of preamble. This is why the threshold
   * is not zero: an exact-substring test would have called this one clean.
   */
  it("catches a quote behind a short lead-in", () => {
    expect(endsAtQuote(`Your summary reads "${REPORTED_DETAIL}"`, RESUME)).toBe(
      true,
    );
  });

  /**
   * Two quotes and one word between them. Subtracting only the longest run
   * would have counted the second quote as original prose and reported this
   * item clean.
   */
  it("catches a detail that is two quotes and nothing else", () => {
    expect(
      endsAtQuote(
        `"Backend engineer with six years building payment and settlement ` +
          `systems" and "Responsible for maintaining the booking service used ` +
          `by partner airlines".`,
        RESUME,
      ),
    ).toBe(true);
  });

  /** A decoder cut mid-word leaves the shape intact, and so must the detector. */
  it("still catches a detail the decoder cut at the cap", () => {
    expect(
      endsAtQuote(
        "Backend engineer with six years building payment and settlement " +
          "systems for high-volume marketplaces in Southeast As…",
        RESUME,
      ),
    ).toBe(true);
  });

  /** RULE 1's GOOD example. A detector that fires on this would be abandoned. */
  it("passes a detail that quotes and then advises", () => {
    expect(
      endsAtQuote(
        `"Backend engineer with six years building payment and settlement ` +
          `systems" spends the first line a reviewer reads on a job title. ` +
          `Open on the settlement volume or the transaction rate instead, and ` +
          `those six years then arrive as evidence rather than as the claim.`,
        RESUME,
      ),
    ).toBe(false);
  });

  /**
   * Generic advice with no quote at all is a DIFFERENT failure — RULE 1's last
   * paragraph governs it — and counting it here would quietly inflate this
   * number with events that belong to another one. Hence the requirement that a
   * quote actually be found, not merely that little original prose is present:
   * this detail has only three words of its own and must still not be caught.
   */
  it("passes generic advice, which has no quote to stop at", () => {
    expect(endsAtQuote("Add more detail.", RESUME)).toBe(false);
    expect(
      endsAtQuote("Add more detail to your experience section.", RESUME),
    ).toBe(false);
  });

  /**
   * The predicate does not know the status, so it fires on a `pass` item whose
   * detail is a bare quoted bullet — which is CORRECT behaviour there, not a
   * finding. Pinned here so the filtering obligation cannot be forgotten: every
   * caller must select warn and fail before asking.
   */
  it("fires on a pass-shaped detail, which is why callers filter by status", () => {
    expect(
      endsAtQuote(
        "Cut settlement reconciliation latency from 40 minutes to under 3 minutes.",
        RESUME,
      ),
    ).toBe(true);
  });

  it("is false when there is nothing on either side to compare", () => {
    expect(endsAtQuote("", RESUME)).toBe(false);
    expect(endsAtQuote(REPORTED_DETAIL, "")).toBe(false);
  });
});
