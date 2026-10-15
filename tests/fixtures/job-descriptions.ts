/**
 * Job descriptions shared by the live suites.
 *
 * `quality-spread.test.ts` measures keyword shape against the first three and
 * `eval.test.ts` scores each role's resumes against its own. One copy, so the
 * two suites can never be measuring against different text under one name.
 */

/**
 * One job description for all three, deliberately.
 *
 * With no JD the rubric judges relevance "against the role the resume is
 * clearly aiming at" — which is inferred from the resume, so a vague resume
 * gets a vague target and grades itself on a curve. Fixing the JD makes the
 * relevance dimension mean the same thing for all three fixtures, which is the
 * whole point of using one role.
 */
export const JOB_DESCRIPTION =
  "Mid-level Backend Engineer. You will own services in our payments and " +
  "logistics platform, from API design through production operation. " +
  "Required: 3+ years backend engineering, Python or Go, PostgreSQL, REST API " +
  "design, AWS. Preferred: Kafka or similar streaming, Kubernetes, Terraform, " +
  "CI/CD pipelines, distributed tracing.";

/**
 * A second job description, in a field that is not software, kept permanently.
 *
 * Keyword extraction was measured only against `JOB_DESCRIPTION` for its whole
 * life, and the prompt's only worked examples were tech. That combination hid a
 * real defect: on a nursing job description the model returned the REQUIREMENT
 * SENTENCES as keywords — "3+ years post-registration experience in an acute
 * inpatient", "Advanced Cardiac Life Support preferred" — because a bulleted
 * requirements list looks structurally identical to a bulleted skills list, and
 * nothing had ever shown it a non-technical worked example.
 *
 * Written in the style that CAUSED the failure rather than one that avoids it:
 * prose requirements with the qualification buried inside the sentence, not a
 * comma-separated skills list. A fixture that states its skills as a list
 * cannot reproduce the bug, and a regression fixture that cannot fail is
 * decoration.
 *
 * The resume fixtures stay as they are. Extraction reads the JOB DESCRIPTION,
 * so the JD is the variable under test — a low match rate against a backend
 * resume is expected and is not what this measures. What is measured is the
 * SHAPE of the terms in both lists.
 */
export const NURSING_JOB_DESCRIPTION =
  "Registered Nurse — Acute Medical Ward. Reporting to the Nurse Manager, you " +
  "will deliver direct patient care on a 32-bed inpatient unit. " +
  "Requirements: Minimum 3 years post-registration experience in an acute " +
  "inpatient ward. Current registration with the Malaysian Nursing Board is " +
  "mandatory. Demonstrated competence in telemetry monitoring and " +
  "interpretation of cardiac rhythms. Proficiency in IV cannulation and " +
  "administration of intravenous medications. Advanced Cardiac Life Support " +
  "certification preferred. Experience with electronic medical records " +
  "documentation. Willingness to work a rotating three-shift roster.";

/**
 * A third job description, in a field whose requirements are written about the
 * PERSON rather than the skill, kept permanently.
 *
 * Nursing proved the prompt could shorten a requirement sentence into a term.
 * It could not prove anything about a requirement that has no term inside it,
 * because every bullet in both prior JDs names something a candidate either
 * has or has not: a certification, a tool, a ward, a roster. Creative job
 * descriptions do not read that way. They mix real tools with statements about
 * who may apply and how the successful candidate is expected to behave, and
 * neither of those has a resume-side counterpart at all.
 *
 * That gap produced the defect this fixture exists for. "fresh graduates
 * welcome" and "take direction from senior designers" both reached pills under
 * "In your resume" with a checkmark. Nothing on a resume can literally match
 * either, so the model inferred a soft match — and the matching rule leaves it
 * no choice, since it is told to judge presence semantically and never to mark
 * a skill missing on the absence of a literal token. A false positive is worse
 * than a shortening miss: it tells the candidate they have something they do
 * not.
 *
 * VERBATIM a real posting, and the first invented attempt is why. A synthetic
 * version of this JD — the same sentences, flattened into one prose paragraph —
 * was extracted CLEANLY on the current prompt: eligibility 0, working-style 0,
 * nothing to fix. The phrasing was too separable, and a fixture that cannot
 * fail is decoration.
 *
 * What the real one has that the invention did not is structure. The
 * eligibility and working-style lines are bullets sitting in the SAME lists as
 * genuine requirements — "Take direction from senior designers" is a
 * responsibility bullet between two real ones, and "Fresh graduates welcome"
 * shares its bullet with "internship or freelance experience counts", which
 * does name something. That is what makes them read as requirements worth
 * extracting, and no invented phrasing reproduced it.
 *
 * Kept whole, including the section headings and the "Nice to have" block. The
 * failure is about a sentence's ROLE in the document, so a fixture that strips
 * the document's shape has removed the variable under test.
 */
export const CREATIVE_JOB_DESCRIPTION = `We are a 25-person branding studio working with F&B, retail and hospitality clients across Klang Valley. You would work alongside two senior designers on live client projects from your first week.

What you would do
- Produce social media assets, print collateral and packaging artwork to brand guidelines
- Take direction from senior designers and revise work based on client feedback
- Prepare artwork files for print production and liaise with printers
- Contribute ideas in concept sessions — we expect juniors to have opinions
- Maintain and organise the studio's asset library

What we are looking for
- A portfolio showing real work, personal projects included — we care more about the thinking than the client list
- Working knowledge of Adobe Illustrator, Photoshop and InDesign
- Understanding of typography, layout and colour theory
- Basic understanding of print production — bleed, CMYK, file preparation
- Ability to take feedback without taking it personally
- Fresh graduates welcome; internship or freelance experience counts

Nice to have
- Figma for digital and web assets
- Motion basics — After Effects or Canva animation
- Photography or retouching skills
- Experience with packaging or point-of-sale materials`;
/**
 * The eval set's fourth role. Written the way Malaysian finance postings
 * usually are: qualifications and systems named outright, so the relevance
 * dimension has concrete terms to find or miss.
 */
export const FINANCE_JOB_DESCRIPTION =
  "Senior Accountant, manufacturing (Shah Alam). You will own the month-end and " +
  "year-end close for two Malaysian entities and support group consolidation. " +
  "Required: ACCA, CIMA, CPA or MIA membership; 4+ years in accounting, at least " +
  "two in manufacturing or audit; full set of accounts under MFRS; SST and " +
  "corporate tax computations with the tax agent; inventory costing; SAP " +
  "Business One or SQL Account; advanced Excel. Lead the annual audit with the " +
  "external auditors. Preferred: Power BI, intercompany reconciliation, process " +
  "improvement.";
