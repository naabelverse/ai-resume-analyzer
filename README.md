# AI Resume Analyzer

Upload a resume, optionally paste a job description, and get a real
Claude-generated review: a 0–100 score against a weighted rubric, pass/warn/fail
feedback that quotes your actual bullets, semantic keyword matching against the
job description, a per-section breakdown, and concrete bullet rewrites.

The interesting part is not that it calls an LLM. It is what happens when the
LLM is unavailable, returns something malformed, refuses, or runs out of tokens
mid-JSON — and what happens when someone uploads a scanned photo of a printout,
a 40MB file, or a PDF renamed `.docx`. Every one of those has a designed answer,
and the app degrades rather than breaking.

> **Screenshot placeholder** — add `docs/screenshot.png` and link it here.

---

## Quick start

```bash
pnpm install
cp .env.example .env.local     # add NVIDIA_API_KEY (free: build.nvidia.com)
pnpm dev
```

Open http://localhost:3000.

**It runs with no API key.** You get the deterministic structural report plus a
banner explaining the AI review is unavailable. That is the same code path a
production outage takes, so it is worth seeing once on purpose.

`/analyze/demo` renders the full results layout from static sample data, with no
key and no request.

```bash
pnpm test         # 163 tests, no network
pnpm test:live    # one real analysis against your key
pnpm test:quality # nine real analyses: does the score discriminate?
pnpm build     # type check, lint, production build
pnpm lint
```

Requires Node 20+ (developed on 24) and pnpm.

---

## Environment

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `AI_PROVIDER` | No | `nvidia` | `nvidia` or `anthropic`. Selects the transport. |
| `AI_MODEL` | No | per provider | Never hardcoded in source. |
| `NVIDIA_API_KEY` | With `nvidia` | — | Server-side only. Free from build.nvidia.com. |
| `ANTHROPIC_API_KEY` | With `anthropic` | — | Server-side only. |
| `AI_TEMPERATURE` | No | `0.2` | Low for repeatability. |
| `AI_MAX_TOKENS` | No | `4000` | Floored at `4000`. Bounds the whitespace runaway; see limitations. |
| `AI_TIMEOUT_MS` | No | `120000` | Open-weight inference is slow, and rate varies 4.5x by the hour. |
| `NVIDIA_ENABLE_THINKING` | No | `false` | See the AI section for the measurements. |
| `ANTHROPIC_EFFORT` | No | `medium` | `low`…`max`. Anthropic only. |
| `PERSISTENCE` | No | `session` | `session` or `db`. Read by the server. |
| `NEXT_PUBLIC_PERSISTENCE` | No | `session` | Must match. Read by the browser. |
| `DATABASE_URL` | Only with `db` | `file:./prisma/dev.db` | |

Only the key for the provider you actually selected is required, and only to get
a real AI review — the app runs without one.

Missing or malformed configuration is reported once at server boot by
`instrumentation.ts`, which logs and never throws: a build that cannot run
without a live secret is a build CI cannot run at all.

---

## How a request actually works

```
   browser                          server
   ───────                          ──────
   file + JD  ──POST multipart──▶   rate limit        5 / IP / 10 min
                                    ↓
                                    sniff magic bytes  %PDF · PK+word/ · OLE2
                                    ↓
                                    extract            unpdf · mammoth
                                    ↓
                                    normalise          ≥200 chars, ≤15k
                                    ↓
                                    measure            words, bullets, sections
                                    ↓
                                    Claude             structured outputs
                                    ↓
                                    validate           Zod, retry once
                                    ↓
   render  ◀──{ ok, data, meta }──  respond            or degrade
```

**Mime sniffing, not extensions.** `lib/extract/index.ts` reads magic bytes:
`%PDF`, or `PK\x03\x04` *plus* a `word/document.xml` entry (a bare ZIP header is
also an XLSX, a PPTX and a JAR), or the OLE2 header that means a pre-2007
`.doc`. A PDF renamed `.docx` is caught here rather than failing deep inside a
ZIP parser with an error nobody can act on.

**Truncation keeps the tail.** Over ~15,000 characters, the first 12,000 and the
last ~2,950 are kept with a marker between them. Education and skills live on
the last page and the rubric scores them — a plain head-clip would penalise long
resumes for the app's limitation, not theirs.

**The counts are measured, not guessed.** `lib/scoring.ts` counts words,
bullets, passive constructions and section headings deterministically, and those
numbers go into the prompt as stated fact. Language models are unreliable at
counting, and one feedback item that opens with the wrong number costs the
reader their trust in every item after it.

**Schema-guaranteed output, twice over.** `lib/schema/analysis.ts` holds two
schemas. `AnalysisWireSchema` goes to `zodOutputFormat` and constrains decoding,
which guarantees shape — keys, types, enums, nullability — but *not* string
`.max()` bounds or array length ranges. `AnalysisResultSchema` carries every
bound from the contract and validates the parsed result. The bounds constrained
decoding cannot enforce are carried in `.describe()` calls, which become part of
the JSON Schema the model decodes against, so it sees "at most 90 characters"
while generating rather than only in a retry.

**The verdict is derived, never model-supplied.** Asking the model for both a
score and a band creates a way for the gauge's number and its label to disagree.
`deriveVerdict(score)` is the only thing that decides.

**One retry, then degrade.** A validation failure retries once with the Zod
error *and the model's own previous output* quoted back — a bare "try again"
just resamples the same distribution. Two failures means something is genuinely
wrong, and the route returns the deterministic report with a banner rather than
an error page.

---

## The AI layer is provider-agnostic — on purpose

The app runs against a frontier hosted model or an open-weight one **with no
change to the analysis logic**. That is a deliberate design decision, not a
convenience: the parts that determine output quality — the Zod schema, the
scoring rubric, the system prompt, the validate-and-retry loop, and the degraded
fallback — are shared by every provider. Only the transport differs.

```
lib/ai/
├── types.ts              the AnalysisProvider seam
├── prompts.ts            rubric + system prompt        ← shared
├── analyze.ts            validate, retry once, degrade ← shared
└── providers/
    ├── anthropic.ts      messages.parse + zodOutputFormat
    ├── nvidia.ts         OpenAI-compatible NIM endpoint
    └── index.ts          picks one from AI_PROVIDER
```

Switching providers is `AI_PROVIDER=` and a restart. Both implementations are
kept working and both are covered by the same parameterised test suite — the
Anthropic path is not dead code kept "just in case", it is the thing that proves
the seam is real. An abstraction with one implementation is just indirection.

| Variable | Purpose |
| --- | --- |
| `AI_PROVIDER` | `nvidia` \| `anthropic` |
| `AI_MODEL` | Model id for that provider — never hardcoded |
| `NVIDIA_API_KEY` | Required when provider is `nvidia` |
| `ANTHROPIC_API_KEY` | Required when provider is `anthropic` |
| `AI_TEMPERATURE` | Default `0.2` |
| `AI_MAX_TOKENS` | Default `4000`, floored at `4000` |
| `AI_TIMEOUT_MS` | Default `120000` |

A missing key **for the provider you selected** is reported at boot, naming the
exact variable. It is never a 500 at request time — the request path returns the
deterministic report instead.

### What running on an open-weight model actually cost

Findings from probing the live API, not from documentation:

- **`nvext.guided_json` does not work on the hosted endpoint.** NVIDIA's own NIM
  docs recommend it, but `integrate.api.nvidia.com` rejects it with a 400 — those
  docs describe self-hosted containers. `response_format: {type: "json_schema",
  strict: true}` *is* enforced there; verified by giving it an enum of
  meaningless values (`zeta`, `kappa`, `omicron`) and confirming it returned one.
- **Constrained decoding enforces `maxLength` by hard-truncating mid-word**, not
  by making the model wrap up. Every string bound therefore lives in the wire
  schema *and* is stated in the field description at a lower target, so the model
  finishes before it hits the ceiling.
- **Section scores are a keyed object on the wire, not an array.** As an array
  the model could omit a section, repeat one, or invent a seventh — all three
  happened in testing. Six required keys makes those states unrepresentable.
- **`enable_thinking` is off.** Measured on the same resume: **7s vs 129s**, same
  score, one attempt vs two, and thinking-on returned an empty answer often
  enough to cost a retry. Reasoning arrives on a separate `reasoning_content`
  field, so it never threatens the JSON parse either way — this is purely a
  cost/latency call. Flip `NVIDIA_ENABLE_THINKING=true` to compare.
- **The retry loop matters more here than it did on Claude.** Schema enforcement
  constrains shape, not the bounds Zod checks or how tightly instructions are
  followed. The second attempt carries the validator's own complaint and the
  model's previous output.
- **Temperature is a weaker lever than it looks.** At `0.2` vs `1.0` on a short
  input, repeat scores varied about the same. The rubric's explicit band anchors
  and the injected measured counts do more for score stability.

- **The overall score is computed, not asked for.** Requesting a single 0-100
  number produced band midpoints and nothing else: across a nine-run
  measurement every score landed within a point of the midpoint of the anchor
  band its own rationale had named (82, 82, 94, 68, 68, 50, 50, 50), leaving
  five reachable values on a hundred-point gauge. The model now scores the six
  rubric dimensions and `deriveOverallScore` weights them. Measured on three
  resumes written to be strong, middling and weak:

  | | before | after |
  | --- | --- | --- |
  | strong, three runs | 82 / 94 / 82 | 90 / 90 / 90 |
  | middling, three runs | 68 / 68 / failed | 62 / 63 / 62 |
  | weak, three runs | 50 / 50 / 50 | 28 / 32 / 32 |
  | means | 86.0 / 68.0 / 50.0 | 90.0 / 62.3 / 30.7 |
  | widest spread within one resume | 12 | 4 |
  | narrowest gap between two resumes | 18.0 | 27.7 |
  | means inside their expected band | 2 of 3 | 3 of 3 |
  | calls that failed validation twice | 1 of 9 | 0 of 9 |

  Not one of the after-scores is a band midpoint (95, 82, 67, 49.5), and the
  breakdown now carries information the total cannot: the weak resume scores
  `impact=10 relevance=15` but `ats=60 clarity=55`, which is the correct and
  useful reading — its problem is substance, not formatting.

  The 12-point spread was not jitter — it was one run reclassifying a band
  upward and jumping midpoint to midpoint, which flipped the verdict a user
  reads between "good" and "great" on identical input.

- **Section scores are checked against the overall score.** A model once
  returned the six section scores on a 0-10 scale — `contact=10 summary=5
  experience=6 education=8 skills=7 formatting=9` — beside an ordinary overall
  score of 68. Every value was a valid integer in 0-100, so nothing rejected it,
  and the UI would have drawn a catastrophic breakdown under a healthy headline
  number. `AnalysisResultSchema` now rejects a result whose section scores
  average more than `SECTION_COHERENCE_TOLERANCE` (35) from the overall score,
  which routes it into the existing retry-then-degrade path. The tolerance is
  set from data: the largest legitimate gap across nine live runs was 16.3, and
  the scale error produced 60.5. A stated minimum was the alternative and is the
  wrong tool — a resume with no education section genuinely scores near zero
  there, so a floor would reject honest output.

- **The request is bounded, not merely timed out.** Both SDK clients were built
  with `maxRetries: 2`, and both SDKs retry on timeout — so a per-request
  timeout of 90s became a 270s call. Measured live at 203s and 205s with
  `attempts=1`, meaning the app's own retry had not even run. The true ceiling
  was 2 attempts x 3 SDK requests x 90s = 540s against a `maxDuration` of 120s,
  so slow requests were killed by the platform and the user got a dead
  connection instead of the degraded report. Both clients now use
  `maxRetries: 0` and `AI_TIMEOUT_MS` is 120s, giving a worst case of
  2 x 120s + 5s = 245s inside a `maxDuration` of 300s.

  The bound was 50s for one reason: Vercel's 120s function cap, worked
  backwards. This app targets Railway, which imposes no such cap, so the
  constraint that set the number is gone. What replaced it is measurement —
  the slowest request that actually succeeded across eighteen live calls took
  43.6s, and per-token rate on this endpoint swings 5.9-26.9 ms/token by the
  hour, so the headroom above that is deliberate rather than shaved. Retrying
  stays in `analyze.ts`, where it is counted, bounded, and carries the
  validator's complaint — the SDK's version was silent and unbounded. A test
  asserts the arithmetic against the route's `maxDuration`, so raising one
  without the other fails the suite.

Verify against your own key with `pnpm test:live` — it prints the full raw
response before parsing, whether Zod passed first try or retried, elapsed time,
and the parsed result. `pnpm test:quality` runs the spread measurement above.
Both are excluded from `pnpm test` so neither ever spends credits in CI; they
run through `vitest.live.config.mts`.

### Failure modes specific to NVIDIA's free tier

| Condition | Code | What the user is told |
| --- | --- | --- |
| 40 req/min ceiling hit | `AI_RATE_LIMITED` | Wait about a minute |
| Free credits exhausted | `AI_CREDITS_EXHAUSTED` | Top up, or switch provider |
| Anything else | `AI_UNAVAILABLE` | Try again shortly |

Credits are split from rate limiting deliberately. They look similar on the wire
and mean opposite things: one is fixed by waiting sixty seconds and the other
never is. Telling someone to "try again shortly" when their credits are gone
wastes their afternoon.

---

## Failure modes

Each has a designed state, reachable and tested. None is a toast.

| What happened | What the user gets |
| --- | --- |
| Not a PDF or DOCX | Named error, dropzone stays usable |
| A pre-2007 `.doc` | Its own message — save as PDF or `.docx` |
| Over 5MB | Size named, with the usual fix |
| Scanned image, no text layer | "Export a text-based PDF" — no OCR is attempted |
| 6th request in 10 minutes | 429 with `retry-after` |
| Missing or invalid API key | Full deterministic report + banner |
| Model refuses, truncates, or times out | Same — degraded, never a 500 |
| NVIDIA rate limit (40/min) | Degraded report + "wait a minute" banner |
| NVIDIA credits exhausted | Degraded report + "top up or switch provider" |
| Model output fails validation twice | Same |
| Database down (with `PERSISTENCE=db`) | Falls back to session storage |

---

## Security

- **The key never reaches the browser.** `lib/ai/client.ts` imports
  `server-only`, which makes an accidental client import a build error rather
  than a leak. Verified against the built bundle: no key, no SDK, and no prompt
  text in `.next/static`.
- **Resume and job description are untrusted data.** They arrive wrapped in
  `<resume>` / `<job_description>` tags, and the system prompt states that
  anything inside them is data, never instructions — including text that
  imitates a system prompt, which gets flagged in `redFlags` instead of obeyed.
- **Model output is untrusted text.** React escapes it, and `react/no-danger` is
  an ESLint error so `dangerouslySetInnerHTML` cannot be introduced later.
- **Nothing touches disk.** The file buffer is released after extraction. Logs
  carry character counts and stage timings, never resume content.

---

## Three honest limitations

**The rate limiter is in-process.** On serverless that means 5 requests per
*instance*, not 5 globally, and it trusts `x-forwarded-for` — safe behind Vercel
or any normal reverse proxy, forgeable if the app is directly exposed. It raises
the cost of casual abuse; it is not a security control. Redis or Vercel KV is
the right answer for real traffic and the wrong answer for a project whose point
is that it runs on a fresh clone with no infrastructure.

**"Never stores your resume" means the raw text.** With `PERSISTENCE=db`, the
stored analysis contains bullet fragments Claude quoted back from the resume.
The extracted text itself is never persisted, but that distinction is real and
worth stating rather than rounding off.

**Keyword extraction returns requirement sentences on non-technical job
descriptions.** Two defects were found in the Keyword match section at the same
time. They were unrelated, one is fixed and verified, and the other is not —
which is the whole reason they are written up together.

*Fixed and verified: the match percentage.* `matchPercent` was the last number
in the response that the model supplied and nothing checked. The formula was
stated twice — in the system prompt and in the wire schema's `.describe()` — and
enforced in neither, so the gauge rendered whatever integer arrived beside two
arrays the model had also written. Production returned **40% for a 5-of-11
match**, which is 4/10: the counts were rounded before the division rather than
after. It hid for months because every captured case was exact — both
`keywordMatch` blocks in `live-report.txt` are 4 matched and 4 missing, and 4/8
is 50 however carelessly you compute it, while `quality-report.txt` logged only
`keywords=NN%` with no arrays beside it to check against. The field is now gone
from the wire schema entirely and `deriveMatchPercent` computes it after
parsing, joining `verdict`, `overallScore` and section `status`. Confirmed
working on a live run. Removing it also handed back 19 characters of every
response, which raised the `sectionNote` ceiling from 234 to 237 — the one lever
the response budget had left, and the second time it has been pulled.

*Not fixed: the shape of the keywords themselves.* On a nursing job description
the model returns the requirement sentences as pills — "3+ years
post-registration experience in an acute inpatient", "Advanced Cardiac Life
Support preferred" — rather than the terms inside them. A bulleted requirements
list is structurally identical to a bulleted skills list, and the section's only
worked examples were technical, so the extractor had never been shown what a
non-technical keyword looks like.

The fix was the treatment that worked for the headline field and the section
note: GOOD/BAD pairs in the prompt, this time in **two** domains — nursing and
marketing — plus an explicit "a term past about six words is a copied
requirement" rule carried in both `.describe()` calls. Measured live it fixed
tech and did not generalise:

| job description | terms under the limit |
| --- | --- |
| tech | 11/11 |
| nursing | 2/7 — **5 still full requirement sentences** |

**Worked examples in two domains were not enough**, and that is the finding
worth keeping. This repo's standing lesson — from `f485f05` and the section
note rounds — is that a field misbehaves because it lacks a worked example, and
that adding one fixes it. Here the example was added, in the failing domain
specifically, and the behaviour moved in tech while barely moving in nursing.
So the lesson has a boundary: worked examples teach a FORM, and they generalise
across instances of a domain far better than across domains themselves.

Three mechanisms were considered for enforcing shape and all three were
rejected, which is why this is closed rather than open:

- **`FIELD_CAPS.keyword`** is 60 and stays there. It is a truncation backstop,
  not a shape guard — every wrong pill was *under* it and therefore a legal
  decode. Lowering it would cut legitimate terms; "Malaysian Nursing Board
  registration" is 36 characters. A character count cannot express shape.
- **A word-count reject in the result schema** would fail validation, spend the
  single retry, and then degrade the whole analysis to the deterministic
  report. Turning a cosmetic defect in one section into no AI review at all is
  the worse outcome.
- **Another prompt round** is what this entry exists to rule out. Two domains of
  worked examples moved tech to 11/11 and nursing to 2/7; a third domain is the
  same lever again.

**So this is a known limitation, not an open problem, and there are no further
rounds on this field.** What ships: on a technical job description the pills are
short terms and the section works as designed. On a nursing-style job
description some pills are full sentences, and the progress bar and "X/Y
matched" count beside them are reading a list of requirements rather than a list
of skills. The nursing JD stays in the quality suite as a permanent fixture so
the gap stays visible and measured; `pnpm test:quality` asserts the tech case,
prints the nursing distribution, and deliberately does not fail on it — a suite
left permanently red over a defect nobody intends to fix next stops being read
at all. If nursing ever comes back clean, that test fails on purpose and says
to re-open this.

## Limitations of the score measurement

The spread numbers above are real, and they are also narrower than they look.
What follows is what those nine calls do *not* establish. It is here so nobody —
including me, six months from now — mistakes a promising measurement for a
settled one.

**Three resumes, one role, three runs each.** Every claim about band separation
rests on nine data points drawn from a single job description and a single
target role. That is enough to show the score is not constant. It is not enough
to characterise its distribution, and it says nothing about how the score
behaves across other roles, other seniorities, or resumes that are strong on one
dimension and weak on another rather than uniformly good or bad.

**I did not choose the bands the fixtures are measured against.** The brief
specified them: strong lands 80+, middling 55-70, weak under 45. The fixtures
were then written to be plausible resumes at those three quality levels. This
matters in two directions. The *separation* result is clean — the model never
saw the intent, and nothing in the pipeline knows which file it is reading. The
*calibration* result is not independent: "a competent but generic resume
deserves 55-70" is a judgement encoded in the test, and the test agreeing with
it proves the model agrees with that judgement, not that the judgement is right.

**The fixtures are plain text and never touch extraction.** They are read
straight off disk, normalised, and handed to the model. No PDF was parsed. So
the entire class of problems the rubric's ATS-friendliness dimension exists to
catch — multi-column layouts, contact details stranded in a page header, text
inside tables or boxes — is absent from every number here. The score's
ATS dimension has been exercised on documents that could not possibly fail it.

**Every live call was NVIDIA.** All twenty-seven analyses ran against
`nvidia/nemotron-3-super-120b-a12b`. The Anthropic path is covered by the
offline suite and by the shared analysis code, but no measurement on this page
was produced by it. The midpoint-collapse finding in particular is a fact about
one model's behaviour under one prompt; Claude may distribute scores quite
differently, better or worse.

**The section-coherence check has never caught a real failure.** It was written
after observing the 0-10 scale error once, and it is proven against a synthetic
payload reproducing it. Across every run since, the largest legitimate gap was
16.3 against a tolerance of 35 — the guard has never fired outside a test. A
subtler scale error, or one that moves the overall score along with the
sections, would still get through.

**A blanket "the same applies to X" inherits whatever the rule later becomes.**
This is the most general lever found in this project, and it is worth stating
on its own because it is invisible by construction: nothing about it changes,
which is exactly why nobody re-reads it.

RULE 1 ended with a seven-word clause — "The same applies to sections[].note
and to redFlags." On the day it was written RULE 1 was **736 characters** and
said one thing: quote real text or drop the item. Extended to a section note
that is a CONSTRAINT. It makes the note shorter and more specific, which is
what a 120-character target wants.

Eleven commits later RULE 1 was **8,694 characters — 11.8x** — because six
separate fixes had each correctly expanded it: the text/detail split, the
restatement rule and its escape hatch, the quote-is-a-beginning rule, the
advice-is-a-sentence rule, quote-the-fragment, and the list-marker rule. Every
one of those was right for `detail`. The clause silently handed all of them to
a field with a fifth of the room, so the note was being asked for a verbatim
quote, what it costs, and what to change, in one sentence of 120 characters.

It resolved the way the emphasis pointed. RULE 1 is titled "the most important
rule here" and carries worked GOOD/BAD examples; the competing instruction was
seven words at the end of a schema description. Live notes came back at
**189 and 180 against a 190 cap**, cut mid-word, both reading
observation -> problem -> next step: the `detail` contract, exactly.

The tell is the pair of numbers. A tail at the cap with a mean under the target
is a few verbose sections. A tail at the cap while the **target** is being
missed wholesale is an instruction losing to a louder one somewhere else, and
raising the cap treats the symptom — it also pulls the tail up again, which
`FIELD_CAPS.feedbackText` already recorded at 90.

The fix was to scope the clause to the paragraph it was written against and to
say in the note's own description what it is NOT. The cap did not move.

**What actually let it run for eleven commits was the absence of a row.**
`sections[].note` was the one free-text field the quality report never
measured — headline length, detail length, restatement rate and quote-stopping
all had distributions; the note had nothing, so there was no number to look
wrong. The only capture on disk carrying notes predated the cap raise, so the
comparison had to be made against six values from a single analysis. The suite
now reports note length per fixture and per section, with "over stated max" as
a separate column from "at/near cap" precisely because they mean different
things. **Instrument the field before tuning the field.**

**A count can tell you a field is wrong. Only the contents can tell you which
instruction is wrong.** The row added above measured note length for two
rounds and reported the same thing both times — the note is too long — while
the cause underneath it changed.

The run of 2026-08-27, five per fixture on `nemotron-3-super-120b-a12b` at
temp 0.2, with the note's contract restated as a count and moved out of RULE 1
into its own section:

| fixture | mean | over stated 150 | at/near cap 190 | cut mid-word |
| --- | --- | --- | --- | --- |
| strong | 123.6 (was 138.8) | 2/18 | 1/18 | 0/18 |
| middling | 112.3 (was 112.2) | 1/30 | 0/30 | 0/30 |
| weak | 153.9 (was 120.6) | 19/30 | 8/30 | 11/30 |

Strong is fixed and middling never moved. Weak went the other way, and the
lengths alone read as the same failure coming back — which is what the two
previous rounds each concluded, and each time the fix aimed at the count.

The notes themselves say otherwise. Weak's longest is "Experience bullets
contain no metrics or outcomes — for example, 'Worked on the backend of the
companys main web aplication using python and databases' describes a duty, not
an achievement." That is ONE observation with ONE quotation and no
prescription: the contract, obeyed. It is 189 characters because 82 of them
are the candidate's own sentence, and a resume written this way offers no
shorter fragment that still locates the line. The 120 target predates the note
row in this report by many commits and was set from six values in a single
captured analysis; nothing about it was ever measured against a resume that
takes more words to name precisely. **On this fixture the target is what is
wrong, not the instruction, and the cap doing its job at 190 is the field
behaving correctly for input that legitimately needs the room.**

**The same nine notes also show something the decision below does not act on.**
Weak's other two notes at the cap are not clean. One enumerates three missing
items and then prescribes — "Consider adding: 'Associate of Science in
Information Technology, Riverside Community…'" — and one carries two
quotations and prescribes: "replace it with a concise professional summary…".
Strong's longest does the same: "consider grouping or adding proficiency
levels". Of the nine longest notes printed, one is cleanly long; four still
say what to change, which the note's own description forbids in as many words.
And 11 of weak's 30 notes are cut mid-word at 190, which is a defect a reader
sees rather than a tuning question.

**The decision is to stop.** Seven rounds have gone into one 190-character
field. `FIELD_CAPS.sectionNote` stays at 190 and the description keeps "Aim
for 120 characters, never exceed 150" — the mismatch recorded rather than
tuned, so that whoever changes this field next does it having read this and
can say in advance what the change would prove. Two caveats on the table:
strong lost 2 of its 5 runs to unusable responses, so its 123.6 is three runs
and not five, and every run in it needed a second attempt.

**Round eight changed it anyway, and the reason is worth separating from the
evidence.** The stop above was the right call on the evidence, and the evidence
has not changed. What changed is a judgement about which defect matters: 11 of
weak's 30 notes cut mid-word is visible to anyone who opens the app, and a
truncation reads as the product being broken rather than as a tuning question.
That is a product decision overriding a measurement discipline, not a new
measurement, and it is recorded that way on purpose.

**The note format changed. This round is a policy change, not a bigger cap.**
Round eight is easy to file under "they raised the number again", and read that
way the interesting part is invisible. For seven rounds a note was defined as
an observation and prescription was forbidden outright — "do NOT say what to
change and do NOT append a next step". That prohibition is now **gone**, from
the schema description and from the system prompt both. A note may close with
one clause saying what to do about the thing it named.

So `sections[].note` is a different field than it was, and the cap is
downstream of that. Anyone comparing notes captured before and after this
commit is comparing two formats, not one format at two lengths — and any
future round that measures note length without knowing this will mis-read what
it is looking at.

Why the prohibition went rather than got restated louder: the nine longest
notes above show **four still prescribing** against a description that forbade
it in as many words, and three rounds of forbidding did not stop it. The rule
was not being followed and was not going to be, so the honest move was to write
down what the field actually does. That is also the whole reason the cap had to
move — a note that names a thing AND says what to do about it needs the room
for both, and the old 190 was sized for one of them.

The second thing round eight does that the previous two raises did not: **it
moves the target with the cap.** 120/150/190 becomes 150/190/230 — aim, stated
max, hard cap. The last two raises moved only the backstop and left the target
at 120/150, so the model went on writing past a target it was never going to
hit and hit the new cap instead. Same lever, pulled the way
`FIELD_CAPS.feedbackText` says it has to be. The sizing follows the same
measurements: aim 150 is weak's measured mean, stated max 190 puts the
189-character clean example under the **target** rather than merely under the
cap, and the cap sits 40 above the stated max because 40 is the overshoot this
round actually observed.

The arithmetic was re-run before spending, as `ARRAY_CAPS` demands, and it
settled the "215 vs 234-252" disagreement that comment had carried for several
commits: the true ceiling is **234**, compact at 3.75 chars/token, so the old
215 was too conservative by 19 characters. The worst case at the shipped caps
is 14,973 characters / ~3,993 tokens — **7 tokens of margin**. 250 was asked
for and does not fit; it is 25 tokens over. 234 was available and was declined:
230 ships because the extra margin is worth more than one token of headroom on
a field that already has room. `tests/schema.test.ts` now builds the maxed wire
object, parses it, and asserts it fits, so the next person to raise a cap fails
a test instead of reading a stale number off a comment.

**Where the room came from, recorded so it is traceable: `redFlags`.** The 40
characters this raise spent were the reserve the previous round explicitly held
against `redFlag`, and the consequence is exact — **`redFlag`'s own ceiling
falls from 244 to 204**, against a cap of 200. There is no longer room to raise
it.

`redFlag` still has **zero live observations**. Every other capped field has
been measured against captured output; this one has never been seen populated
at all, because the only capture on disk carries `"redFlags": []` twice. So the
trade was made knowingly and in one direction: a defect readers can see today —
notes cut mid-word in front of anyone testing the app — was preferred over
headroom reserved against a field nobody has yet watched fail.

**If `redFlags` starts arriving truncated, this commit is the cause.** Not a
model change, not a prompt regression — this trade. The fix will not be a cap
raise, because there is no room for one; it will be removing a derivable field
from the response, and `matchPercent` is the next candidate, being
`round(matched / (matched + missing) * 100)` and computable exactly the way
`status` and `verdict` already are.

The prediction, stated in advance as the paragraph above asks: **notes stop
arriving cut, and the mean lands near 150-190 rather than climbing to sit on
230.** If it climbs to the new cap the way it sat on the old one, the length is
being set by the prescription now permitted rather than by the target — and
there is no room for a ninth raise. The next lever would be removing a field
from the response, the way deriving `status` bought back 26 tokens.

**The prediction failed. This is the live note that failed it:**

> Your education is relevant and well-presented, though adding your CGPA or
> class standing (which you already have) is good; consider including relevant
> coursework if space allows and it strengthens your marketing analytics or…

225 characters after repair, and the trailing `…` is not decoration — it is
`repairTruncation` firing, which by construction only fires within five
characters of the cap. So the raw note arrived at **225-230 against a 230 cap**
and a stated max of 190. It sat on the new ceiling exactly the way notes used
to sit on 190, which is the branch the prediction named as its failure case.

It also failed for the reason that branch named. This is not one observation
closed by one clause. It is three ideas chained — the education section is
good, the CGPA is good, consider adding coursework — with the third still
running when the decoder cut it. **The prescription allowance is being used as
permission to keep going rather than as a way to close.** The tell sits inside
the sentence: "adding your CGPA or class standing (which you already have) is
good" prescribes something the same clause says the candidate has already done.
That is what chaining produces and what closing does not.

One example is not a rate, and this page has said so about other fields twice.
It establishes that the failure mode occurs, not how often. Here that
distinction changes nothing, because no measurement unlocks an action: the cap
cannot rise — the `redFlags` trade above left a 204 ceiling — and wording has
now lost every round it has been tried in, the prohibition and the allowance
that replaced it alike.

**`sections[].note` is closed. No further rounds.** Not fixed — closed. The cap
stays at 230, the target stays 150/190, and the prescription allowance stays.
Reverting the allowance is not the answer either: the prohibition it replaced
also lost, with four of nine notes prescribing straight through it, so going
back would trade a note that chains for a note that chains while claiming not
to.

What the field costs a reader, stated plainly so nobody has to rediscover it:
**some section notes chain several ideas instead of naming one, and some arrive
cut.** That is a documented limitation of this project, not an open problem in
it.

If it is ever reopened, the trigger is not a better wording idea — eight rounds
say wording is not the lever on this field. It is the response shape changing
enough to free budget, the way deriving `status` bought back 26 tokens and
`matchPercent` could buy back more. Until then the eight rounds above are the
record, and the durable thing in them is the method rather than the field:
instrument before tuning, read the contents and not only the counts, and say in
advance what a change would prove — including when the answer turns out to be
that it did not.

**Guided JSON decoding can run away on whitespace, and it still does.** This is
the failure mode that cost the most to find, because it never once looked like
itself.

A structured-output request to this endpoint sometimes stops advancing the JSON
and emits whitespace until it runs out of budget. Captured raw, one such
response was 16,384 completion tokens — the entire `max_tokens` ceiling — of
which **1,414 characters were JSON and 16,007 were a `"\n "` pair repeated**:
**91.9% of the body**, at 1.06 characters per output token against a healthy
~3.9. The JSON simply stopped mid-object, after `sections.skills`. The same
responses show the tell elsewhere: one `summary` came back as
`"YourResumeSectionIsStrongButYouNeedToWorkOnImpact…"` with every space removed,
and a section note containing "contribute to the the".

The mechanism is that a JSON grammar always permits more whitespace between
structural tokens, so "emit another space" is never an illegal next token. **No
schema bound can prevent this** — the loop happens *between* fields, not inside
a string or an array — which is why the remedy is `max_tokens` and not a
stricter schema. Anyone building on structured outputs should know the failure
is representable at all; `strict: true` guarantees the shape of what you get,
not that you get it.

What made it expensive to diagnose is that the cost surfaced as something else
entirely. At this endpoint's 5.9-11.4 ms/token, 16,384 tokens takes **96-187
seconds**, which blew straight through the 50s per-request timeout; the SDK
aborted and the app reported that the model could not be reached. A quality run
showed weak.txt failing 3 of 3 while strong.txt passed 6 of 6 — which reads as a
content-dependent bug and is really a length-dependent one. The runaway is more
likely on a weak resume (measured 2/3, against 1/3 middling and 0/3 strong) but
is not specific to it, and the successful weak.txt runs produce the *smallest*
output of any fixture. Every diagnostic that measured output length on the
finished analysis found no correlation with elapsed time, because by then the
runaway attempt had already been discarded and retried.

`AI_MAX_TOKENS` is now 4,000 — chosen against the schema's own ceiling of about
3.2k tokens, with the largest real response ever observed at 1,645. That bounds
a runaway to roughly 25-45s and turns it into a `finish_reason: "length"` the
retry loop already handles. **It does not stop the runaway happening.** In the
first run after the change, 3 of 9 calls still hit the ceiling and both attempts
ran away, so those calls still degraded — but with the accurate `AI_SCHEMA` code
instead of a misleading `AI_UNAVAILABLE`, in around 13s instead of 150s, and
weak.txt produced a usable score for the first time.

A frequency penalty was the obvious next lever, and it does not work. Attempted
at 0.1 — the low end, deliberately — the runaway rate was unchanged within the
noise of a nine-call sample, and it introduced a failure of its own: empty-string
fields, in feedback `detail` and in `bulletRewrites`. That is exactly the
structural distortion to expect, because a JSON payload repeats its punctuation
and field names hundreds of times in any valid response, so penalising repetition
penalises well-formed output as readily as it penalises a loop. Reverted.

So: nothing currently reduces how often the runaway happens. `max_tokens` bounds
what one costs, and that is the whole of the mitigation.

**Three attempts across two runs have now stopped in the same place, and that
is all it is so far.** The first captured runaway "stopped mid-object, after
`sections.skills`". The 2026-08-26 capture stopped after `sections` on both
attempts — 1,648 and 1,632 characters of JSON, `feedback`, `bulletRewrites`,
`keywordMatch` and `redFlags` never emitted at all. Three data points from two
runs is a coincidence worth writing down and nothing more; it is recorded here
so the next capture has something to compare against rather than being read
fresh. If it holds across more captures, the `sections` boundary is where to
look — and the thing that would make it interesting is that `sections` is the
one keyed object in the schema, so its closing brace is the point where the
grammar's next legal token set changes shape most.

What that capture DID settle is that the runaway emits **structurally correct
JSON**, not corrupt JSON. Read by eye the body looked malformed: `formatting`
printed at two spaces where the other five sections sat at four, with the
separating comma alone on its own line, which reads as a closed object followed
by a stray key. It is not. Repair the newlines the console wrapped into string
literals, close the one open brace, and it parses — with all six sections
present and correctly nested inside `sections`. Indentation carries no meaning
in JSON, and the deranged indentation IS the runaway beginning: whitespace
appearing at the one place the grammar always permits more of it. The claim in
this section stands as written.

**The diagnostic added to expose the runaway was stripping the evidence.** This
is worth naming as a class, because it is the same fault as a test that pins
internal phrasing: an instrument that runs, reports, and quietly measures the
wrong thing.

`logTerminalFailure` printed `chars=` from `completion.text` — which is what
survived `stripToJson`, and `stripToJson` slices from the first `{` to the LAST
`}` and discards everything after it. A runaway is ~90% trailing whitespace, so
the one thing that identifies it was deleted before the number was taken. The
printed line read `chars=1632 tokens={...,"outputTokens":4000}`, which invites
the division: 0.41 characters per token, denser than the 1.06 on record, and
therefore a new and worse failure. It is not a ratio at all — numerator and
denominator describe different bodies. Reconstructed properly, 1,632 characters
at the healthy ~3.9 chars/token is ~418 tokens of content and **~89.5%
whitespace**, which is the 91.9% already documented above, to within noise.

The completion now carries `rawChars` — the pre-strip length — through the
provider seam, and the diagnostic prints `chars=`, `raw=` and `stripped=`
together so the subtraction is on the line rather than left to be reasoned
about afterwards. **An instrument that reports a number nobody can act on is
better than none; an instrument that reports a plausible wrong number is
worse.**


**`maxDuration` has never met a real platform.** The 245s worst case
(2 attempts x 120s + 5s) is arithmetic checked by a test, not an observation.
Nothing here has been deployed. The app targets Railway, which does not cap
function duration — and on a long-running Node server the route segment config
has no runtime effect at all. The invariant is kept because it is the one place
that states what a single request is allowed to cost, not because a platform is
currently enforcing it.

**The bound trades slow successes for fast degrades, and the cost is real.**
Under the earlier unbounded configuration two of nine calls only succeeded
because the SDK silently retried past 90s, arriving at ~200s. Bounding the
request converts those into honest failures. The first run under a 50s bound
lost **four of nine calls** to timeouts — but most of those were the whitespace
runaway above rather than genuinely slow analysis, which is why the remedy
turned out to be `max_tokens` rather than a longer wait. Per-token rate on this
endpoint still varies **5.9-26.9 ms/token** by the hour, a 4.5x swing on
identical work, so the timeout is now 120s rather than shaved to just above the
slowest observed success. Free-tier capacity varies and these are single
samples; the true degrade rate is still unknown.

**A prompt rule about how many findings to write does not change how many get
written.** Two runs of the quality suite came back with middling.txt marked at a
single severity across all eight feedback items, and in both the uniform run was
one that had filled the array to `ARRAY_CAPS.feedbackMax`, while every mixed run
came in at five or six. The reading was that the model pads toward the cap, runs
out of genuinely distinct findings, and repeats a severity to fill the space — so
RULE 4 gained a rule saying the count is itself a judgement and the maximum is a
ceiling, not a target. It made no difference. Across the next three runs
middling.txt returned **eight items every time**, unchanged at the cap, and two of
the three were uniform. Whatever fixes the padding, telling the model not to pad
is not it. Reverted.

The assertion that catches the harmful case survives, because it never depended
on the count: a run may be uniform, but its feedback may not be dominated by a
status harsher than the band its own score falls in. Eight warns under a 60 is
coherent and passes; eight fails under a 60 is the list overruling the gauge and
fails.

**What moved it was removing the compulsion, not arguing with it.** The feedback
array's floor reached the decoder as `minItems: 5`, and NVIDIA's strict
`json_schema` enforces that during generation — so the grammar could not stop
before five items however little the resume gave the model to say, while RULE 1
told it to emit nothing it could not quote. Told to stop and forbidden to stop,
it filled the gap with the nearest list of headings to hand. Measured at five
runs per fixture: **26 of 95 feedback items** came back with `text` set to a
rubric heading ("Impact and quantification") or a schema key ("impact",
"Summary"), affecting **5 of 14 runs**, all-or-nothing — a run that leaked
leaked every headline it had. `text` was the one free-text field the system
prompt never mentioned, so there was no contract for it to violate: RULE 1
governed `detail` and gave it worked examples, while `text` had eight words of
schema description and no example anywhere.

Two changes, measured the same way. RULE 1 now specifies `text` with GOOD/BAD
examples as it always did for `detail`, and `ARRAY_CAPS.feedbackMin` dropped
from 5 to 3. Leakage went to **0 of 64 items across 13 runs** (one-tailed Fisher
exact on runs affected, p ≈ 0.025). Item counts moved with it: middling.txt had
returned eight items marked 8/8 "fail" in all five baseline runs, and afterwards
returned 3, 5, 8, 5 and 6 items with mixed statuses — the uniformity above
clearing as a side effect of no longer being forced to fill the array. That is
n=5 on one fixture, and is reported rather than claimed.

The check that would have caught this from the start is now in the live suite,
with the detector itself unit-tested offline against the exact strings that
leaked. The metric it replaces inspected `detail` alone and reported "5/5
feedback items quote the resume" on a run whose every headline was a JSON key.

**Lowering the headline cap does not shorten the headline.** `feedback[].text`
was capped at 90 and the model averaged 79.4 against it — long enough to wrap
into a block that reads as a headline with its detail already showing, which is
how it was reported. The cap went to 70 on the reasoning that moved
`feedbackMin`: the model anchors on the ceiling, so move the ceiling. Measured
at five runs per fixture the mean did fall, to 62.1 / 61.9 / 63.9 — and the fall
was an artifact. **47 of 59 headlines came back cut mid-word by the decoder**,
against roughly one in five at the old cap. The model went on writing the same
~80-character headline and simply got truncated earlier. Reverted to 90, and
filed here beside the frequency penalty and the count rule as a third obvious
lever that moved nothing it was aimed at.

What holds the layout together instead is the clamp: `line-clamp-2` on the
collapsed headline in `feedback-list.tsx`, released when the row opens. A row
that only looks right when the response behaves is one bad response away from
four lines of body text where a headline belongs, and no schema bound fixes
that — the component has to be robust on its own.

**A detail that restates its own headline is real, and now measured.** The same
run found **23 of 26** middling items and **6 of 17** weak items whose `detail`
repeats 60% or more of its own `text`'s content words, against **0 of 16** on
strong. It is not merely an artifact of the truncation above: strong.txt had
every headline cut and no restatement at all. It is **unfixed**. The run that
measured it was confounded by the 70-cap, so the rate at 90 is still unknown,
and RULE 1 tells `detail` to open with a verbatim quote without ever saying it
must not open with the headline again.

That gap is why `RunRecord` now keeps both fields. Twenty-eight paid calls had
already been spent on runs that recorded statuses only, and none of them could
answer the question that was actually asked.

**The detail-restates-headline rule ships UNMEASURED.** RULE 1 now states the
contract between the two fields — `detail` must ADD to `text` and must never
open by restating it, neither in the headline's words nor reworded — with
GOOD/BAD examples in the shape the `text` contract uses.

Nothing about it has been measured. The only restatement numbers on record
(23/26 middling, 6/17 weak, 0/16 strong) come from a run at the 70-character cap
that was itself reverted, so they are not a baseline for the cap that ships.

To measure it, run the quality suite twice with `QUALITY_RUNS=5` — once at
`ce3e010`, this change's parent, and once here — and compare the TOTAL line
under "detail restating its headline". It has worked if that rate at least
halves and lands in single figures. strong.txt scored 0 even in the confounded
run, so the signal lives in middling and weak. If it does not clearly drop, this
belongs beside the frequency penalty, the count rule and the headline cap as a
fourth lever that read well and moved nothing.

**Measured, and it works — with a cost still being chased.** Five runs per
fixture either side: restatement fell from **13/52 (25%) to 0/26 (0%)**. But the
after-run lost **8 of 15 calls against 4 of 15**, and the scrollback put
empty-`detail` validation errors at **2 -> 5** while the `max_tokens` runaway
went **2 -> 4**. Both roughly doubled, so the two are not cleanly separated and
endpoint variance is not excluded — a doubling at n=15 is p ≈ 0.26 on its own.
Empty `detail` is nonetheless the shape a model reaches for when it is told it
may not restate and given no cheaper way out.

So RULE 1 now puts **DROP THE ITEM** ahead of the restructure it already
offered, cites the `ARRAY_CAPS.feedbackMin` floor so the model knows a drop is
cheap, and forbids an empty `detail` outright with the consequence stated: one
dropped item costs the candidate one item, an empty `detail` can cost them the
whole review.

Note what the 0% rests on: 26 surviving items rather than 52, weak.txt
contributing 3 of them. It is a real drop on a thin sample, not a settled one,
and the calls that failed are exactly the ones that could not comply — so the
rate is optimistic by an unknown margin until the failure rate comes down.

**Resolved at 5.1%, across three runs of five per fixture, all at cap 90.**

| | restatement | successful calls | empty `detail` | `max_tokens` |
|---|---|---|---|---|
| baseline | 13/52 (25%) | 11/15 | 2 | 2 |
| restatement rule | 0/26 (0%) | 7/15 | 5 | 4 |
| + drop path | **2/39 (5.1%)** | **11/15** | 4 | 2 |

The number that decides this is not the restatement rate but the failure rate.
Successful calls went from 7/15 back to 11/15, exactly the baseline. That would
not have recovered if the rule had been unrelated to the failures: the drop path
gave the model somewhere to go when it had nothing to add, and it went there.
The middle row's 0% was never the better result — it was the same rule with no
way out, measured on the 26 items that survived it.

Empty `detail` is **not fully resolved**: 2, then 5, then 4. Down but not back,
and four events against two is far too small to separate from this endpoint's
own variance. The `max_tokens` runaway sat at 2 in the first and third runs and
4 in the second, within the noise it has always shown, and remains the one
failure mode nothing here has ever moved.

**What to watch, and it is deliberately not fixed.** Items per successful call
fell to **~3.5** (39/11), with most runs returning exactly
`ARRAY_CAPS.feedbackMin` — three. The model takes the drop path readily, so
reports are thinner than they were: three findings where it used to write five
or six. That is the rule working as written, and it is the trade the 5.1%
bought. If it falls further, the floor is what to revisit — not the rule.

**The detail now stops at the quote instead, and that ships UNMEASURED.** The
restatement is gone and a third shape took its place. On a warn item in
production:

> **headline** Your summary could open with your most impressive metric to grab
> attention faster.
> **detail** Backend engineer with six years building payment and settlement
> systems for high-volume marketplaces in Southeast Asia.

The detail quotes the summary and ends. The candidate is told something should
change and never told what to change it to — RULE 1 asks for the quote, then the
evidence, then the cost, then the fix, and the model does the first part and
stops.

Nothing on the report could see it. **`restatementOverlap` scores that pair
0.14**, because the detail is not the headline again, it is the *resume* again —
two failures that look identical in the UI and are opposite in the data. The
restatement metric would have gone on reporting this run clean, which is the
same way the headline leak survived a metric that read `detail` alone.

The shape is status-dependent and the fix has to be. On a `pass` item the quote
IS the evidence and stopping there is correct: "Your experience section leads
with a quantified result" followed by the bullet that proves it needs nothing
more. Forcing advice onto those would turn praise into padding. So RULE 1 now
says the quote is where `detail` BEGINS and not where it ends **on warn and fail
specifically**, with the production item above as the BAD example against a GOOD
one that quotes the same line and carries on into the cost and the change — and
routes the failure to the existing drop path, because an obligation with no
cheap way out is what doubled the empty-`detail` count last time.

`endsAtQuote` in `tests/helpers.ts` is the check, unit-tested offline against the
reported string like the other two. It walks the detail and credits any run of
four or more consecutive words the resume contains verbatim, then counts what is
left: at most three words of the model's own, with a quote actually found, is a
detail that stopped. Contiguity is what makes it work — advice that reuses
"settlement" or "latency" scatters those words rather than lining them up, so it
is not credited away. Greedy across the whole field rather than one longest run,
so two quotes with nothing between them is still caught. Probed against
middling.txt, five realistic quote-then-advice details score 11 to 28 own words
against the bare quote's 0.

It **under-counts** and the number should be read as a floor: a bare quote behind
a four-word lead-in escapes, and raising the allowance to catch it would start
firing on "Name the volume instead". Pass items are counted on their own line and
excluded from the rate, so the exception stays visible rather than putting a
floor under the total that no prompt change could move.

To measure it, run `QUALITY_RUNS=5` either side of this commit and compare four
lines. **"warn/fail detail stopping at the quote" TOTAL** is the one the change
is aimed at. The other three are the revert conditions: restatement TOTAL must
not climb back over ~5%, successful calls must not fall below 11/15, and the new
**detail length** block must not show details arriving decoder-cut at whatever
`FIELD_CAPS.feedbackDetail` is at the time — a rule that works by writing details
truncated before they reach the advice has not worked. (It said "the 300 cap"
when written; `bfdc0a1` raised it to 400, which is exactly the kind of drift a
revert condition pinned to a literal invites.) If any of those moves the wrong way, this belongs beside the
frequency penalty, the count rule and the headline cap as a fifth lever that read
well and moved nothing.

**That measurement procedure was wrong, and the run that followed it is
inconclusive.** Thirty paid calls, five per fixture at `b7ed2d8~1` and five at
`b7ed2d8`, and they cannot answer the question. Recorded here because the reason
is reusable.

**The primary metric has no before number and never could have.** `endsAtQuote`
was added *in* `b7ed2d8`, so the parent commit's report has no "stopping at the
quote" block at all — the paragraph above says to run "either side of this
commit", which measures the detector's existence rather than the prompt's
effect. To compare a prompt change against a detector introduced alongside it,
hold `tests/` at the newer commit and swap only `lib/ai/prompts.ts`.

**The endpoint then failed mid-run.** In the after log every call from round 3
onward returned unreachable — eight consecutive transport failures — and
weak.txt produced no usable run at all, leaving strong and middling only. The
before log is not a usable reference either: it scored **5/15** on the same
commit this file records at 11/15, so neither run is comparable to the other or
to anything earlier.

| | before (`b7ed2d8~1`) | after (`b7ed2d8`) |
|---|---|---|
| detail stopping at the quote | *block absent* | 2/10 (20.0%) |
| restatement TOTAL | 0/19 (0.0%) | 2/15 (13.3%) |
| successful calls | 5/15 | 4/15 |
| — unreachable (transport) | 3 | 8 |
| — format / validation | 7 | 3 |
| validation retries | 10 | 5 |
| empty `detail` | 13 | **0** |
| `max_tokens` | 6 | 5 |
| detail decoder-cut at 300 | *block absent* | 1/15 (max 298) |
| fixtures with data | 1 / 1 / 3 | 2 / 2 / **0** |

All three revert conditions fired literally and all three are confounded.
Restatement compares different populations — 11 of the 19 before-items are
weak.txt and the after run has no weak.txt at all; on middling, the only fixture
with data on both sides, it is 0/5 against 2/9. The failure rate is eight
transport errors that no prompt text can cause, and the failures a prompt CAN
reach moved the other way: format and validation failures 7 to 3, retries 10 to
5, and **empty `detail` 13 to 0** — the cost the drop path was still carrying in
the 5.1% round, gone. One detail arrived cut, at 298 against a cap of 300.

**Not reverted.** Reverting here would repeat `26c7f3b` exactly: a prompt
hypothesis judged on noise. Nothing in these logs shows harm, the one clean
signal points the right way, and the metric the change was written for was never
measured. The 20.0% in the table is a first observation of the new detector on
live output, not an after number — there is nothing to compare it to yet.

**The resume's list marker rides into the quote, and the fixtures cannot show
it.** `detail` is required to open with a verbatim quote, and the model was
copying the bullet glyph across with the words — so some feedback bodies opened
with a marker and others did not, inside a paragraph where it reads as a list
item that has lost its list. Fixed in both places, because either alone is a
half fix: RULE 1 now says the glyph belongs to the resume's LAYOUT and the quote
starts at the first word, and `stripLeadingMarker` in `lib/text.ts` takes it off
`detail` in the analyze parse path when it arrives anyway.

The measurement is the interesting part. Of the report files on disk,
`before.log`, `after.log` and `run.log` hold **no model detail text at all** —
validation errors and summary statistics only — and `quality-report.txt` holds
four detail prefixes, none of them marked. `live-report.txt` is the only capture
of real output, and **6 of its 10 details open with U+002D**. Replaying all ten
through the strip removes exactly those six and leaves the other four untouched.

**The only glyph on disk is U+002D, and that is a property of the fixtures, not
of the model.** All three quality fixtures use `- ` and nothing else — 31 line
starts, one character — so no local run can produce the `•` that was reported
from production. The strip's character set is therefore deliberately wider than
the evidence, and the reason is worth writing down rather than rediscovering:

**Word does not emit U+2022.** Bulleted lists in DOCX carry their glyph in the
Symbol font, which extracts into the **private use area — U+F0B7**, with U+F0A7
and U+F076 for the hollow and square variants. Anyone testing this against a
plain-text fixture, or against a PDF, will never see those and will conclude the
set is over-broad. It is not; it is sized for the format most resumes arrive in.

Dedicated glyphs strip with or without a following space. Ambiguous markers
(`-`, `*`, en/em dash) require the space, which is what keeps a quote opening on
a negative figure — `"-15% margin"` — intact.

**The strip runs after `repairTruncation`, not before.** That function decides
"was this cut?" from how close the length sits to the cap, so it has to see what
the decoder produced; stripping first could carry a cut detail out of the
suspicion window and lose its ellipsis. Stripping only ever shortens, so this
order is safe in the other direction.

**It does not disturb the quote detectors, and that is now asserted rather than
assumed.** `quoteCoverage` and `endsAtQuote` compare `detail` against the resume
text, and nothing strips markers from the resume side — the exact shape of a
check that quietly stops matching. It does not bite, because both sides go
through `contentWords`, which replaces every non-alphanumeric run with a space,
so a leading marker is gone before either side is compared. That is a property
of `contentWords` rather than a coincidence, so `headline-leak.test.ts` pins it,
including that the stripped detail is still FOUND in the resume — equality alone
would be satisfied by 0 = 0. If anyone narrows that normalisation to preserve
punctuation, those fail and say why, instead of the live suite reporting a clean
run forever.

**Ships UNMEASURED against live output**, like the two rules above it. The strip
is deterministic and tested, so the visible symptom is gone either way; what is
unknown is whether the prompt rule stops the model doing it at all. The way to
tell is a run in which no `detail` needs stripping.

---

---

## Resume history (optional)

Set the following in `.env.local`, then run `pnpm db:migrate`:

```ini
PERSISTENCE=db
NEXT_PUBLIC_PERSISTENCE=db
DATABASE_URL=file:./prisma/dev.db
```

`/dashboard` then lists past analyses with a delete action. Both flags are
needed because the server and the browser each choose a store implementation,
and a server-only variable would read as `undefined` in the browser and silently
pin everyone to session mode.

Every database call goes through `withDb()` in `lib/db.ts`, which returns a
fallback instead of throwing. **Delete `prisma/dev.db` and the app keeps
working** — you lose cross-tab history, not the analysis you just waited for.

Prisma 7 connects through a driver adapter rather than a bundled engine, so
moving to Postgres is a change of adapter in `lib/db.ts` and provider in
`prisma/schema.prisma`. No caller changes.

---

## Deployment

Deploy target is **Railway**, or any host that runs a normal long-lived Node
process. Not Vercel.

### Node version

**Node 22.13 or newer.** `package.json` declares
`engines.node: ">=22.13.0"`, and the number is not arbitrary — four separate
things in the toolchain require Node 22 or above:

| What | Requires | Why it matters |
| --- | --- | --- |
| `pnpm@11.22.0` (from `packageManager`) | `>=22.13` | The binding constraint, and the loudest. |
| `unpdf` | `>=22` | Every PDF extraction. |
| `openai` | `>=22.0.0` | The NVIDIA transport. |
| `resend` | `>=20`, dev `>=22.12` | The feedback form. |

This was originally declared as `>=20`, which is what `next` alone asks for.
A host is free to satisfy the range however it likes, and Railway picked Node
20.20.2 — legal against `>=20`, and fatal, because pnpm 11 uses `node:sqlite`,
a builtin that does not exist before 22.5:

```
ERR_UNKNOWN_BUILTIN_MODULE: No such built-in module: node:sqlite
```

pnpm crashed before installing anything, so the failure surfaced at install
rather than at runtime. That was luck worth noticing: `unpdf` and `openai` both
need Node 22 too, so Node 20 would have broken PDF extraction and every model
call anyway — later, in production, and much less legibly. A floor that only
satisfies `next` is not a floor for this project.

Pick the version once, in `engines.node`, and let the host resolve it. There is
deliberately no `.nvmrc`: a second file naming the same requirement is a second
thing to forget to update.

### Why not Vercel

One analysis can legitimately outlast what a serverless function is allowed to
run. `AI_TIMEOUT_MS` defaults to 120s per model call, `analyzeResume` makes a
second attempt when the first fails validation, and extraction and
serialisation cost about 5s on top — so the worst case a request must be
allowed to reach is 2 x 120 + 5 = **245s**. That is what `maxDuration = 300` in
`app/api/analyze/route.ts` declares.

Vercel's function ceiling sits below that on the plans this project targets,
and the failure mode is the bad kind: the platform kills the request
mid-generation, the user sees a network error rather than a degraded report,
and nothing in the app gets the chance to fall back. A long-running server has
no per-request ceiling to hit, so that whole class of failure disappears.

`maxDuration` stays in the route on Railway even though nothing reads it there.
It is inert, not harmful — Next's docs say deployment platforms *may* use it —
and it is the one place in the codebase that states what a request is allowed
to cost. `tests/api-analyze.test.ts` asserts the arithmetic against it, so
raising `AI_TIMEOUT_MS` past what it covers fails the suite rather than
production.

`/api/analyze` also needs the **Node runtime** (unpdf and mammoth both do). In
Next 16 that is the default and the Edge runtime is deprecated, so there is no
`export const runtime` — but the requirement is real.

### The one thing that will break a first deploy

`prisma/schema.prisma` generates its client into `lib/generated/`, which is
gitignored — so a fresh checkout does not have it, and `lib/db.ts` imports it
statically. Without a generate step the build fails at the host with:

```
Module not found: Can't resolve '@/lib/generated/prisma/client'
```

This happens **even with no database**, because the import is static and does
not care that `PERSISTENCE=session` never reaches it. `package.json` therefore
runs `prisma generate` from `postinstall`, which fixes fresh clones locally for
the same reason. Nothing puts it back on its own: Prisma 7's `prisma-client`
generator writes outside `node_modules`, so no dependency's install hook can.

### Recommended configuration: `PERSISTENCE=session`

Deploy with session persistence. It is the configuration this app is built
around, and the one to use unless you have a specific reason not to:

- no volume to attach, no migrations at deploy, no Postgres to stand up
- history still works — per-tab rather than cross-device, which is an honest
  thing for a demo to offer
- one fewer moving part that can be down while someone is reading a report

The database path is real and tested, but it is neither the default nor free.
`lib/db.ts` is hardcoded to the `better-sqlite3` adapter and `schema.prisma` to
`provider = "sqlite"`, so Postgres is a schema edit, an adapter swap and a
dependency — not a config change. SQLite on Railway needs an attached volume,
because the container filesystem is ephemeral and the database would be
discarded on every redeploy. If you do want it: set `PERSISTENCE=db` and
`NEXT_PUBLIC_PERSISTENCE=db`, provide `DATABASE_URL`, and run
`prisma migrate deploy` — not `pnpm db:migrate`, which is `migrate dev` and
prompts.

### Steps

1. Create a Railway project from the GitHub repo. Nixpacks detects Node and
   pnpm on its own; no Dockerfile is needed.
2. Leave the build and start commands alone. `next build` and `next start` are
   already right, and `next start` reads `PORT` from the environment and binds
   `0.0.0.0` by default — **do not** set `PORT` yourself or add `-p $PORT`.
   Railway injects it.
3. Set the variables below **before the first build**. One of them is baked
   into the bundle at build time; see the warning under the table.
4. Point the healthcheck at `/api/health`. It reports readiness without echoing
   any secret.
5. Deploy, then open `/analyze/demo`. It renders the sample report without
   touching a provider, so it separates "the app is up" from "the key works".

### Environment variables

Required:

| Variable | What it does |
| --- | --- |
| `NVIDIA_API_KEY` | The provider key. Without it the app still runs, but every analysis silently degrades to the deterministic checks. |
| `NEXT_PUBLIC_PERSISTENCE` | `session` for the recommended deploy. Chooses the store **in the browser**. |

> **`NEXT_PUBLIC_PERSISTENCE` is inlined at build time, not read at runtime.**
> Setting or changing it in the Railway dashboard after a build leaves the
> deployed bundle pinned to whatever it was when that bundle was compiled.
> Changing it needs a rebuild, not a restart. It has to be `NEXT_PUBLIC_` at
> all because the store is chosen in the browser, where a server-only variable
> reads as `undefined` and silently pins everyone to session mode.

Optional — every one of these has a working default:

| Variable | Default | What it does |
| --- | --- | --- |
| `AI_PROVIDER` | `nvidia` | Transport: `nvidia` or `anthropic`. |
| `AI_MODEL` | `nvidia/nemotron-3-super-120b-a12b` | Model id for the selected provider. |
| `AI_MAX_TOKENS` | `4000` | Floored at 4000. Bounds the whitespace runaway, not answer size. |
| `AI_TEMPERATURE` | `0.2` | Low for repeatability. |
| `AI_TIMEOUT_MS` | `120000` | Per model call. 2x this + 5s must stay under `maxDuration`. |
| `NVIDIA_BASE_URL` | NVIDIA hosted | Override only for a self-hosted NIM container. |
| `NVIDIA_ENABLE_THINKING` | `false` | Off deliberately: 7s vs 129s for the same score. |
| `NVIDIA_REASONING_BUDGET` | `4096` | Only consulted when thinking is on. |
| `ANTHROPIC_API_KEY` | — | Required only when `AI_PROVIDER=anthropic`. |
| `ANTHROPIC_EFFORT` | `medium` | Anthropic reasoning effort. |
| `PERSISTENCE` | `session` | Server-side half of the persistence switch. |
| `DATABASE_URL` | — | Required only when `PERSISTENCE=db`. |
| `RESEND_API_KEY` | — | Feedback form transport. This and the next are both needed, or the form refuses to send. |
| `FEEDBACK_EMAIL` | — | Where feedback is delivered. Must be the address the Resend account is registered under, since the app sends from `onboarding@resend.dev`. |

`PORT` is injected by Railway. Do not set it.

---

## Layout

```
app/
  api/analyze/route.ts        validate → extract → measure → model → validate
  api/extract/route.ts        the same extraction, without the analysis
  api/analyses/               history CRUD
  api/feedback/route.ts       feedback form → Resend, two rate-limit buckets
  api/health/route.ts         readiness without echoing secrets
  analyze/[id]/page.tsx       server shell around the client view
lib/
  ai/         providers (server-only), analyze (retry + degrade), prompts
  extract/    magic-byte dispatch, unpdf, mammoth, normalise, truncate
  schema/     the two-schema strategy
  store/      persistence seam: session · remote, one interface
  scoring.ts  deterministic checks + the degraded report
  errors.ts   typed failures, one copy map for the whole app
  mail.ts     the one place this app sends mail from
tests/        325 tests; fixtures are built in memory, not committed
```

---

## Known UI issues

Real, understood, and not yet fixed. Written down so they get found on purpose
rather than rediscovered.

- **Hit areas below the 40px minimum.** `size="sm"` buttons are 36px tall, the
  copy button on each bullet rewrite overrides that down to 28px, and the
  delete control in the history list is 36px. A pointer target wants at least
  40px and ideally 44px. The fix is an expanded pseudo-element rather than a
  bigger visible control, so no layout has to move — but the expanded areas
  must not overlap, which is why it is not a one-line change.
- **Status pill text fails WCAG AA.** Measured from the tokens: `pass` is
  2.07:1 (`--success` on `--success-tint`), `warn` 1.96:1, `fail` 3.30:1, and
  the `IMPROVED` label on each bullet rewrite 2.07:1. All four are text and all
  four want 4.5:1. It is not a one-line darkening: `--success` and `--warning`
  are also the progress-bar and section-meter fills, where they are correct at
  this lightness, so the fix is a separate pair of text tokens rather than a
  new value for the existing ones.
- **The report's two columns come apart in the degraded state.** The layout is
  loaded so section breakdown carries one column against feedback plus keyword
  match in the other, which balances for a full report. A degraded one has
  three deterministic feedback items and an empty keyword panel, so the right
  column ends around 400px above the left at 1440px.
- **The submit button stays enabled when the held file is invalid.** The form
  keeps a rejected file on purpose, but `disabled={!file || busy}` does not
  consult the error, so the primary action invites a click that can only
  re-show the same message. The chip beside it no longer claims success, so
  this is now the last part of that state that misleads.
- **Nothing marks the form as busy while the request is in flight** except the
  button label. The drop target still reads and behaves as live, so a second
  file can be chosen mid-analysis.
- **A missing analysis reports `UNKNOWN`.** `/analyze/<id>` for an id this tab
  has never held renders "the analysis stopped for a reason the app doesn't
  recognise", which describes a failure that did not happen. In session mode
  every shared or reopened link lands here, so it is the common case, not the
  edge. It needs its own `ErrorCode` and copy in `lib/errors.ts`.
- **Three surfaces render one fill — deliberate, not a defect on this list.**
  `.panel` dresses both a container (the file preview, which nests its own
  `.quote-well`) and a passive panel ("What you'll get"), and the
  job-description trigger and textarea take that same `--surface-inset` by
  utility — so all three sit at dL* 3.56 below the card face, which is the
  flat read this form wants. A deeper `--surface-field` at 6.81 briefly held
  the field apart; that 6.81 was measured against the card face rather than
  against the panels the field actually sits beside, and it made the field the
  darkest thing in the form, so it has been removed rather than left unused in
  `globals.css`. Focus marks the live control now — a white fill and the 2px
  brand outline — not resting depth. Worth knowing before anyone separates
  them again: the room is tight, running from `--surface-inset` at 3.56 to
  `--disabled-surface` at 8.62, which an input must not approach.

---

## What I would build next

1. **Stream the analysis.** Feedback items appearing one at a time instead of
   after a 25-second wait, with the progress bar driven by real token progress
   rather than elapsed time — the honest version of what the scanning card
   currently approximates.
2. **Before/after re-scoring.** Accept the bullet rewrites, re-analyse the
   amended resume, and show a genuine score delta rather than arithmetic on the
   old one.
3. **An eval set.** A dozen resumes of known quality with expected score bands,
   run against prompt changes. Right now "the scores spread sensibly" is a
   judgement made by reading them, and that does not survive a prompt edit.
