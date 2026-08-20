import { clampToWord as cap } from "@/lib/text";
import {
  FIELD_CAPS,
  SECTION_NAMES,
  STATUS_THRESHOLDS,
  deriveVerdict,
  type AnalysisResult,
  type FeedbackItem,
  type SectionName,
  type SectionScore,
  type Status,
} from "@/lib/schema/analysis";

/**
 * Checks that need no model at all.
 *
 * These exist for two reasons. They give Claude a factual starting point
 * instead of making it count things (which language models are bad at), and
 * they are the entire content of the degraded report when the AI is
 * unavailable — which is what turns "the demo is down" into "the AI portion is
 * unavailable, here is what we could still measure".
 *
 * Every heuristic here is approximate and the copy says so. An honest
 * approximation the user can sanity-check beats a confident number they can't.
 */

export interface DeterministicChecks {
  wordCount: number;
  /** Null for DOCX, which has no page count before rendering. */
  pageCount: number | null;
  bulletCount: number;
  passiveVoiceCount: number;
  hasEmail: boolean;
  hasPhone: boolean;
  hasLink: boolean;
  sectionsPresent: Record<Exclude<SectionName, "contact" | "formatting">, boolean>;
}

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/;
// Deliberately loose: international formats vary far too much for a strict
// pattern, and a false negative here tells the user their phone is missing
// when it isn't — the worse of the two errors.
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const LINK_RE = /(?:linkedin\.com|github\.com|gitlab\.com|https?:\/\/|www\.)/i;

const BULLET_RE = /^[\s]*[•▪◦‣·*+–—-]\s+\S/gm;

/**
 * "was reduced", "were implemented", "has been maintained". Catches the common
 * cases and misses irregular participles — it is a signal, not a parser, and
 * the feedback copy presents it as approximate.
 */
const PASSIVE_RE =
  /\b(?:was|were|is|are|been|being|be)\s+(?:\w+ly\s+)?\w+(?:ed|en)\b/gi;

const SECTION_HEADINGS: Record<
  Exclude<SectionName, "contact" | "formatting">,
  RegExp
> = {
  summary: /^[^\S\n]*(?:professional\s+)?(?:summary|profile|objective|about\s+me)\b/im,
  experience:
    /^[^\S\n]*(?:work\s+|professional\s+|relevant\s+)?(?:experience|employment|work\s+history)\b/im,
  education: /^[^\S\n]*education(?:\s+(?:and|&)\s+\w+)?\b/im,
  skills:
    /^[^\S\n]*(?:technical\s+|core\s+|key\s+)?(?:skills|technologies|competencies|tech\s+stack)\b/im,
};

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

export function runDeterministicChecks(
  text: string,
  pageCount: number | null,
): DeterministicChecks {
  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    pageCount,
    bulletCount: countMatches(text, BULLET_RE),
    passiveVoiceCount: countMatches(text, PASSIVE_RE),
    hasEmail: EMAIL_RE.test(text),
    hasPhone: PHONE_RE.test(text),
    hasLink: LINK_RE.test(text),
    sectionsPresent: {
      summary: SECTION_HEADINGS.summary.test(text),
      experience: SECTION_HEADINGS.experience.test(text),
      education: SECTION_HEADINGS.education.test(text),
      skills: SECTION_HEADINGS.skills.test(text),
    },
  };
}

/** Renders the checks as a compact fact block for the model's user turn. */
export function summariseChecksForModel(checks: DeterministicChecks): string {
  const missing = Object.entries(checks.sectionsPresent)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  return [
    `word count: ${checks.wordCount}`,
    checks.pageCount === null ? null : `pages: ${checks.pageCount}`,
    `bullet lines: ${checks.bulletCount}`,
    `approximate passive-voice constructions: ${checks.passiveVoiceCount}`,
    `email found: ${checks.hasEmail}`,
    `phone found: ${checks.hasPhone}`,
    `profile link found: ${checks.hasLink}`,
    missing.length
      ? `no recognisable heading for: ${missing.join(", ")}`
      : "all expected section headings found",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Exported for the live quality suite, which asserts that a run's feedback is
 * never dominated by a status harsher than the band its own score falls in.
 * That check has to read the boundaries from here rather than restate them, or
 * the test and the code drift into disagreeing about what "warn" means.
 */
export function statusFor(score: number): Status {
  if (score >= STATUS_THRESHOLDS.pass) return "pass";
  if (score >= STATUS_THRESHOLDS.warn) return "warn";
  return "fail";
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sectionScores(checks: DeterministicChecks): SectionScore[] {
  const contactSignals = [checks.hasEmail, checks.hasPhone, checks.hasLink];
  const contactScore = clampScore(
    (contactSignals.filter(Boolean).length / contactSignals.length) * 100,
  );

  const bulletsPerPage = checks.pageCount
    ? checks.bulletCount / checks.pageCount
    : checks.bulletCount;
  const formattingScore = clampScore(
    (checks.bulletCount >= 6 ? 55 : 25) +
      (bulletsPerPage >= 4 ? 20 : 5) +
      (checks.passiveVoiceCount <= 3 ? 25 : checks.passiveVoiceCount <= 8 ? 12 : 0),
  );

  const presenceScore = (present: boolean) => (present ? 80 : 25);

  const notes: Record<SectionName, string> = {
    contact: checks.hasEmail
      ? `Found an email address${checks.hasPhone ? " and a phone number" : ", but no phone number"}${checks.hasLink ? ", plus a profile link" : " and no profile link"}.`
      : "No email address was detected, which is the one contact detail a recruiter always needs.",
    summary: checks.sectionsPresent.summary
      ? "A summary or profile heading is present. Its quality needs the AI review."
      : "No summary or profile heading was found.",
    experience: checks.sectionsPresent.experience
      ? `An experience heading is present, with ${checks.bulletCount} bullet lines across the document.`
      : "No experience or employment heading was found.",
    education: checks.sectionsPresent.education
      ? "An education heading is present."
      : "No education heading was found.",
    skills: checks.sectionsPresent.skills
      ? "A skills or technologies heading is present."
      : "No skills or technologies heading was found.",
    formatting: `${checks.bulletCount} bullet lines, ${checks.wordCount} words${checks.pageCount ? `, ${checks.pageCount} page${checks.pageCount === 1 ? "" : "s"}` : ""}.`,
  };

  const rawScores: Record<SectionName, number> = {
    contact: contactScore,
    summary: presenceScore(checks.sectionsPresent.summary),
    experience: presenceScore(checks.sectionsPresent.experience),
    education: presenceScore(checks.sectionsPresent.education),
    skills: presenceScore(checks.sectionsPresent.skills),
    formatting: formattingScore,
  };

  return SECTION_NAMES.map((name) => ({
    name,
    score: rawScores[name],
    status: statusFor(rawScores[name]),
    note: cap(notes[name], FIELD_CAPS.sectionNote),
  }));
}

function degradedFeedback(checks: DeterministicChecks): FeedbackItem[] {
  const missing = Object.entries(checks.sectionsPresent)
    .filter(([, present]) => !present)
    .map(([name]) => name);

  const items: FeedbackItem[] = [
    checks.hasEmail
      ? {
          status: "pass",
          text: "An email address was found in the document text",
          detail:
            "Your email extracts cleanly from the file, which means an applicant tracking system will be able to read it rather than dropping it.",
        }
      : {
          status: "fail",
          text: "No email address was found in the document text",
          detail:
            "Either it is missing, or it sits in a page header that text extraction cannot reach — which is also where automated screeners lose it. Put it in the body, under your name.",
        },
    checks.hasLink
      ? {
          status: "pass",
          text: "A profile or portfolio link was found",
          detail:
            "A LinkedIn, GitHub or portfolio URL gives a reviewer somewhere to go when your resume interests them. Keep it in the body of the document.",
        }
      : {
          status: "warn",
          text: "No LinkedIn, GitHub or portfolio link was found",
          detail:
            "For technical roles a reviewer usually looks for one. Add a single relevant link near your contact details.",
        },
    {
      status: checks.bulletCount >= 8 ? "pass" : "warn",
      text: cap(`${checks.bulletCount} bullet lines were detected`, FIELD_CAPS.feedbackText),
      detail: cap(
        checks.bulletCount >= 8
          ? "That is a healthy amount of structured detail. Bullets scan far faster than paragraphs, which matters when a reviewer spends seconds on the first pass."
          : "That is on the low side. Experience written as paragraphs is much harder to scan quickly — break each role into three to five bullets that each report an outcome.",
        FIELD_CAPS.feedbackDetail,
      ),
    },
  ];

  const idealWords = checks.wordCount >= 350 && checks.wordCount <= 900;
  items.push({
    status: idealWords ? "pass" : "warn",
    text: cap(`The resume runs to about ${checks.wordCount} words`, FIELD_CAPS.feedbackText),
    detail: cap(
      idealWords
        ? "That sits in the range most reviewers expect — long enough to show substance, short enough to read in full."
        : checks.wordCount < 350
          ? "That is short for a resume with real experience behind it. You are likely underselling what you did — most of the missing words belong in your experience bullets."
          : "That is long. Reviewers skim rather than read, so anything past the second page rarely lands. Cut the oldest and least relevant material first.",
      FIELD_CAPS.feedbackDetail,
    ),
  });

  items.push({
    status: checks.passiveVoiceCount <= 3 ? "pass" : "warn",
    text: cap(
      `About ${checks.passiveVoiceCount} passive-voice constructions were detected`,
      FIELD_CAPS.feedbackText,
    ),
    detail: cap(
      checks.passiveVoiceCount <= 3
        ? "Your bullets mostly lead with an action verb, which is what puts you rather than the project at the centre of each sentence."
        : "Phrases like 'was responsible for' and 'were implemented' hide who did the work. Rewrite them to lead with a verb: Built, Cut, Shipped, Migrated. This count is approximate.",
      FIELD_CAPS.feedbackDetail,
    ),
  });

  items.push(
    missing.length > 0
      ? {
          status: "fail",
          text: cap(`No heading found for: ${missing.join(", ")}`, FIELD_CAPS.feedbackText),
          detail: cap(
            `A recognisable heading for ${missing.join(", ")} is missing. Automated parsers use headings to route content into the right fields, so an unlabelled or creatively named section can be dropped entirely.`,
            FIELD_CAPS.feedbackDetail,
          ),
        }
      : {
          status: "pass",
          text: "All the expected section headings were found",
          detail:
            "Summary, experience, education and skills each have a heading a parser can recognise, so your content routes into the right fields rather than being dropped.",
        },
  );

  items.push({
    status: checks.hasPhone ? "pass" : "warn",
    text: checks.hasPhone
      ? "A phone number was found in the document text"
      : "No phone number was found in the document text",
    detail: checks.hasPhone
      ? "It extracts cleanly from the file, so a recruiter reaching for it will actually find it."
      : "Some recruiters still call before they email. If you would rather not list one that is a legitimate choice — but make sure it is a choice.",
  });

  // The schema requires between 5 and 8; the construction above yields 7.
  return items.slice(0, 8);
}

/**
 * The report shown when the AI portion failed.
 *
 * It is a real report, not a placeholder: every number in it was actually
 * measured. What it cannot do is judge writing quality, so the summary says so
 * rather than implying the score means more than it does.
 */
export function buildDegradedResult(
  checks: DeterministicChecks,
): AnalysisResult {
  const sections = sectionScores(checks);
  const overallScore = clampScore(
    sections.reduce((total, section) => total + section.score, 0) /
      sections.length,
  );

  return {
    // Honest about what this number is and is not. The structural checks cannot
    // read writing quality, so the rationale says so rather than implying a
    // judgement nothing actually made.
    scoreRationale: cap(
      `Structural checks only — no band was judged. Averaged the six section scores from measured signals: ${checks.bulletCount} bullet lines, ${checks.wordCount} words, contact details ${checks.hasEmail ? "found" : "missing"}.`,
      FIELD_CAPS.scoreRationale,
    ),
    overallScore,
    verdict: deriveVerdict(overallScore),
    summary: cap(
      "The AI review is unavailable right now, so this score reflects only the automated structural checks — not the quality of your writing. Run it again shortly for the full analysis.",
      // Deliberately tighter than FIELD_CAPS.summary. That 500 is a ceiling for
      // the model's prose; this copy sits in a banner and should stay short.
      240,
    ),
    sections,
    feedback: degradedFeedback(checks),
    bulletRewrites: [],
    keywordMatch: null,
    redFlags: [],
  };
}
