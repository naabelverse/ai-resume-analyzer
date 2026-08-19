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
| `AI_MAX_TOKENS` | No | `16384` | Floored at `4000`; the JSON is large. |
| `AI_TIMEOUT_MS` | No | `90000` | Open-weight inference is slow. |
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
| `AI_MAX_TOKENS` | Default `16384`, floored at `4000` |
| `AI_TIMEOUT_MS` | Default `90000` |

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
  `maxRetries: 0` and `AI_TIMEOUT_MS` is 50s, giving a worst case of
  2 x 50s + 5s = 105s inside the 120s cap.

  50s is picked from measurement, not preference: across eighteen live calls the
  slowest request that actually succeeded took 43.6s and the second slowest
  25.1s. 45s would have cut the 43.6s request off by a 1.4s margin; 55s leaves
  only 5s of platform headroom. Retrying stays in `analyze.ts`, where it is
  counted, bounded, and carries the validator's complaint — the SDK's version
  was silent and unbounded. A test asserts the arithmetic against the route's
  `maxDuration`, so raising one without the other fails the suite.

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

## Two honest limitations

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

**`maxDuration` has never met a real platform.** The 105s worst case
(2 attempts x 50s + 5s) is arithmetic checked by a test, not an observation.
Nothing here has been deployed. How Vercel behaves at that boundary, and whether
a given plan even permits 120s, is untested.

**The bound trades slow successes for fast degrades, and the cost is real.**
Under the previous unbounded configuration two of nine calls only succeeded
because the SDK silently retried past 90s, arriving at ~200s. Those requests
would have been killed by the platform anyway. Bounding the request converts
them into honest failures — but on this endpoint that is not a rare event. The
first run under the 50s bound lost **four of nine calls** to timeouts, each one
degrading to the structural report. One successful call landed at 41.5s, leaving
only 8.5s of headroom. Free-tier capacity varies by the hour and this is a
single sample, so the true degrade rate is unknown; what is known is that it is
high enough to matter, and that the previous configuration was hiding it rather
than avoiding it.

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

`/api/analyze` needs the **Node runtime** (unpdf and mammoth both do). In
Next 16 that is the default and the Edge runtime is deprecated, so there is no
`export const runtime` — but the requirement is real.

The route exports `maxDuration = 60` to match the Anthropic client's own 60s
timeout. Without it the platform caps the function well below that and kills the
request before the SDK can report a timeout of its own.

For production persistence, point `DATABASE_URL` at Postgres, swap the
datasource provider and the adapter, and run `pnpm db:migrate`.

---

## Layout

```
app/
  api/analyze/route.ts        validate → extract → measure → Claude → validate
  api/analyses/               history CRUD
  api/health/route.ts         readiness without echoing secrets
  analyze/[id]/page.tsx       server shell around the client view
lib/
  ai/         client (server-only), analyze (retry + degrade), prompts
  extract/    magic-byte dispatch, unpdf, mammoth, normalise, truncate
  schema/     the two-schema strategy
  store/      persistence seam: session · remote, one interface
  scoring.ts  deterministic checks + the degraded report
  errors.ts   typed failures, one copy map for the whole app
tests/        118 tests; fixtures are built in memory, not committed
```

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
