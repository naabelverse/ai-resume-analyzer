import type { AnalysisResult } from "@/types";

/**
 * Static demo data for Phase 1 so the full layout can be reviewed before any
 * logic exists. Every value here is invented — there is no real resume behind
 * it. Phase 4 replaces these imports with the live API response and this file
 * is deleted.
 */
export const PLACEHOLDER_FILE_NAME = "muhammad-nabil-resume.pdf";

export const PLACEHOLDER_ANALYSIS: AnalysisResult = {
  scoreRationale:
    "Band 60-74: real engineering scope, but only two of eleven bullets carry a metric, so the impact is asserted rather than shown.",
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
      score: 58,
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

  redFlags: [
    "Nine-month gap between the 2024 and 2025 roles with no explanation",
    "Two spelling errors in the experience section ('recieved', 'managment')",
  ],
};
