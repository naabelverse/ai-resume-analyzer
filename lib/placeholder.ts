import type { AnalysisResult } from "@/types";

/**
 * Static demo data behind the `/analyze/demo` route.
 *
 * Written for Phase 1 so the full layout could be reviewed before any logic
 * existed, and this comment said for a long time that Phase 4 would delete it.
 * That is not what happened. The live path arrived and this became the sample
 * instead: `<AnalysisView>` serves this record for the `demo` id, and
 * `<AnalyzeForm>` links to it beside the drop target, so the whole report
 * is readable without an API key or a resume of your own.
 *
 * It is load-bearing, not leftover — deleting it breaks that route.
 *
 * Every value here is invented — there is no real resume behind it.
 */
export const PLACEHOLDER_FILE_NAME = "muhammad-nabil-resume.pdf";

export const PLACEHOLDER_ANALYSIS: AnalysisResult = {
  scoreRationale:
    "Real engineering scope, but only two of eleven bullets carry a metric, so the impact is asserted rather than shown.",
  overallScore: 72,
  verdict: "good",
  summary:
    "Solid engineering background, but most bullets describe duties rather than outcomes. Add numbers to your top three achievements and this moves into strong territory.",

  sections: [
    {
      name: "contact",
      score: 92,
      status: "pass",
      note: "Email, phone and GitHub are all present and parse cleanly.",
    },
    {
      name: "summary",
      // 45 so the demo exercises the "fail" band, which nothing rendered
      // before: every section here scored above STATUS_THRESHOLDS.warn, so the
      // red state had never appeared anywhere. The note below already reads as
      // a poor section rather than a middling one.
      //
      // `status` below is now ignored by `<SectionBreakdown>`, which derives it
      // from this score. Left in place because it is still part of a stored
      // `SectionScore`; it is dead weight here, not a second opinion.
      score: 45,
      status: "warn",
      note: "Opens with 'hardworking team player' — generic, says nothing specific.",
    },
    {
      name: "experience",
      score: 70,
      status: "warn",
      note: "Good scope of work, but only two of eleven bullets carry a metric.",
    },
    {
      name: "education",
      score: 85,
      status: "pass",
      note: "Degree, institution and expected graduation are clear.",
    },
    {
      name: "skills",
      score: 76,
      status: "pass",
      note: "Specific and current; consider grouping by domain rather than one list.",
    },
    {
      name: "formatting",
      score: 64,
      status: "warn",
      note: "Contact details sit in the header, which some ATS parsers drop.",
    },
  ],

  feedback: [
    {
      status: "fail",
      text: "Your contact details are inside the page header",
      detail:
        "Several applicant tracking systems ignore header and footer regions entirely, so your email and phone number may never reach a recruiter. Move them into the body of the document, directly under your name.",
    },
    {
      status: "warn",
      text: "Only 2 of 11 experience bullets contain a measurable result",
      detail:
        "Bullets like 'Responsible for maintaining the booking service' describe a duty. Recruiters scan for outcomes — throughput, latency, cost, user counts, error rates. Aim for a number in at least half your bullets.",
    },
    {
      status: "warn",
      text: "The summary opens with 'hardworking team player'",
      detail:
        "This phrase appears on a large share of resumes and carries no information. Replace it with what you actually build and the stack you build it in.",
    },
    {
      status: "warn",
      text: "Tense is inconsistent across roles",
      detail:
        "Your current role mixes past and present tense between bullets. Use present tense for the role you hold now and past tense for everything earlier.",
    },
    {
      status: "pass",
      text: "Skills section is specific and current",
      detail:
        "Naming TypeScript, PostgreSQL and Docker rather than vague terms like 'web technologies' gives a reviewer something concrete to match against the role.",
    },
    {
      status: "pass",
      text: "Clean, single-column layout that parses reliably",
      detail:
        "No tables, text boxes or multi-column regions. The document extracts cleanly, which is exactly what you want for automated screening.",
    },
  ],

  bulletRewrites: [
    {
      original: "Responsible for maintaining the booking service.",
      improved:
        "Maintained a booking service handling [X] requests/day, cutting p95 latency from [X]ms to [X]ms.",
      // No placeholder reminder here. RULE 2 forbids the model putting one in
      // `why`, and the section states the convention once above the list — a
      // demo that still carried the old instruction was the reason it looked
      // like the prompt change had not landed.
      why: "Turns a duty into an outcome, and names the service it happened to.",
    },
    {
      original: "Worked on the team that built the new admin dashboard.",
      improved:
        // [X], not [N]: RULE 2 now standardises on one letter, and this is the
        // page anyone can reach without an API key — a demo contradicting the
        // convention it demonstrates teaches the wrong thing first.
        "Built [X] screens of the admin dashboard in React and TypeScript, used daily by [X] internal staff.",
      why: "Names your specific contribution and the stack instead of the team's.",
    },
    {
      original: "Helped improve database performance.",
      improved:
        "Added covering indexes to the three slowest queries, reducing average report load from [X]s to [X]s.",
      why: "States what you actually changed, and ties it to the queries it affected.",
    },
  ],

  keywordMatch: {
    matched: [
      "TypeScript",
      "React",
      "Node.js",
      "PostgreSQL",
      "REST APIs",
      "Git",
    ],
    missing: ["Kubernetes", "CI/CD", "GraphQL", "AWS"],
    matchPercent: 60,
  },

  /*
    Both entries name a problem AND a next step, because that is what the wire
    schema now asks the model for and the demo is the only place this section
    has ever been seen rendering.

    The first used to read "Nine-month gap between the 2024 and 2025 roles with
    no explanation", which tells the candidate something they already know and
    gives them nothing to do. 125 and 117 characters against a 150 target — see
    the measurement in `FIELD_CAPS`.
  */
  redFlags: [
    "Nine-month gap between the 2024 and 2025 roles — account for it in one line in your summary so a reader is not left guessing.",
    "Two spelling errors in the experience section ('recieved', 'managment') — proofread it end to end before you send it.",
  ],
};
