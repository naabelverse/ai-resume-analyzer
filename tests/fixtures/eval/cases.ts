import {
  CREATIVE_JOB_DESCRIPTION,
  FINANCE_JOB_DESCRIPTION,
  JOB_DESCRIPTION,
  NURSING_JOB_DESCRIPTION,
} from "../job-descriptions";

/**
 * The eval set: four roles, three resumes each, every one written to land in
 * a known band.
 *
 * `quality-spread.test.ts` holds the role constant and measures noise on one
 * backend trio. This varies the ROLE, which is the axis that suite cannot see:
 * a rubric tuned on backend resumes could grade a strong nurse as middling and
 * nothing there would notice. The backend trio is reused rather than rewritten
 * so the two suites share an anchor.
 *
 * Each role is scored against a job description in its own field, so the
 * relevance dimension means the same thing for all three of its resumes and
 * the only variable left inside a role is how well the resume is written.
 *
 * The bands are the brief's, the same ones `quality-spread` asserts. The gaps
 * between them (45-54, 71-79) belong to no tier on purpose: a score there is a
 * fixture that failed to say clearly which tier it is.
 */

export const TIER_BANDS = {
  strong: { min: 80, max: 100 },
  middling: { min: 55, max: 70 },
  weak: { min: 0, max: 44 },
} as const;

export type Tier = keyof typeof TIER_BANDS;

/** Best first: the order `eval.test.ts` asserts a role's means fall in. */
export const TIERS: readonly Tier[] = ["strong", "middling", "weak"];

export const EVAL_ROLES = [
  { role: "backend", jd: JOB_DESCRIPTION, file: (tier: Tier) => `tests/fixtures/quality/${tier}.txt` },
  { role: "nursing", jd: NURSING_JOB_DESCRIPTION, file: (tier: Tier) => `tests/fixtures/eval/nursing-${tier}.txt` },
  { role: "design", jd: CREATIVE_JOB_DESCRIPTION, file: (tier: Tier) => `tests/fixtures/eval/design-${tier}.txt` },
  { role: "finance", jd: FINANCE_JOB_DESCRIPTION, file: (tier: Tier) => `tests/fixtures/eval/finance-${tier}.txt` },
] as const;

export interface EvalCase {
  id: string;
  role: string;
  tier: Tier;
  jd: string;
  file: string;
  min: number;
  max: number;
}

export const EVAL_CASES: EvalCase[] = EVAL_ROLES.flatMap(({ role, jd, file }) =>
  TIERS.map((tier) => ({
    id: `${role}/${tier}`,
    role,
    tier,
    jd,
    file: file(tier),
    ...TIER_BANDS[tier],
  })),
);
