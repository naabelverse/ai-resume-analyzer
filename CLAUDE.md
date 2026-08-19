@AGENTS.md

# Conventions in this repo

Written from what the code actually does, not from what would be nice.

## The server boundary

`lib/ai/providers/*`, `lib/env.ts`, `lib/db.ts`, and everything under
`lib/extract/` import `server-only`. That import is the guard: pulling one of
them into a client component is a build error rather than a leaked key. Do not
remove it to "make something testable" — Vitest aliases the package to a stub in
`vitest.config.mts`, which keeps the guard real in the build and inert in tests.

Anything both sides need goes in a module with no guard: `lib/limits.ts` for
caps, `lib/errors.ts` for failure copy. Duplicating a constant across the
boundary is how the two copies eventually disagree.

## Design tokens

Every colour, radius, shadow, and font weight resolves to a variable in
`app/globals.css`. No raw hex outside that file, no `dark:` variants anywhere —
dark mode is deliberately out of scope. Shape lives in the `.card` / `.panel`
component classes so padding and radius are defined once.

## Errors

One `ErrorCode` union, one `ERROR_COPY` map, in `lib/errors.ts`. Add a code
there and both `<ErrorState>` and `<InlineError>` pick it up — the component
test iterates every code and asserts a title, a cause, and a next action, so a
new code with missing copy fails the suite.

Server code throws `AppError` subclasses. The route maps them to a status and a
user-safe message. Nothing else formats an error message for a human.

## AI calls

`AI_PROVIDER` selects the transport at runtime — `nvidia` or `anthropic`. **Both
must keep working.** The Anthropic implementation is not dead code kept "just in
case": it is what proves the seam is real, and the parameterised suite in
`tests/api-analyze.test.ts` runs the same behavioural block against both. If you
change one provider and not the other, that suite fails, which is the point.

What is shared and must stay shared: the Zod schemas, the scoring rubric, the
system prompt, validation, the retry-once loop, and the degraded path. A
provider file may only turn a `ProviderRequest` into a `ProviderCompletion`.
Anything in `lib/ai/providers/*` that starts making a judgement about quality is
in the wrong file.

- Two schemas, always. `AnalysisWireSchema` for decoding, `AnalysisResultSchema`
  for validation. Bounds live in **both** — the wire schema so `z.toJSONSchema`
  emits them for the decoder, and the description so the model aims *below* the
  hard cap. Constrained decoding enforces `maxLength` by cutting mid-word.
- `sections` is a keyed object on the wire and an array in the result. As an
  array a model can omit, repeat, or invent one; six required keys cannot.
- `verdict` is derived from the score, never taken from the model. Two sources
  would eventually disagree on the same gauge.
- Never `console.log` resume text. Counts and timings only.

### Anthropic specifics
- Structured outputs via `messages.parse` with `zodOutputFormat`.
- On `claude-sonnet-5`: no `temperature`, `top_p`, `top_k`, or
  `thinking.budget_tokens` — each is a 400 — and no assistant prefill. A test
  asserts none of them are sent, because that mistake surfaces as "the AI is
  unavailable" rather than as itself.
- Check `stop_reason` for `refusal` and `max_tokens` before reading
  `parsed_output`. Both are HTTP 200 with unusable content.

### NVIDIA specifics
- `nvext.guided_json` is a **400** on the hosted endpoint despite NVIDIA's NIM
  docs recommending it; those docs describe self-hosted containers. Use
  `response_format: {type: "json_schema", strict: true}`, which is enforced.
- `enable_thinking` goes in `chat_template_kwargs`, not top-level. It is off:
  7s vs 129s on the same resume, same score. Reasoning arrives on a separate
  `reasoning_content` field, so it never threatens the parse either way.
- Rate limiting and credit exhaustion get **different** error codes. They look
  alike on the wire and mean opposite things.

## Degrade, don't fail

Any AI failure — no key, refusal, timeout, truncation, two validation failures —
returns the deterministic report from `lib/scoring.ts` with `meta.degraded`
true. Any database failure returns the `withDb` fallback. Neither ever becomes a
500 or an error page. `tests/scoring.test.ts` asserts the degraded result is
schema-valid across every input corner, because it is the last line of defence
and has nothing behind it.

## Tests

`tests/` mirrors `lib/`. Fixtures are **built in memory** by
`tests/fixtures/build-fixtures.ts` — no binaries in git, and a test that needs a
two-page resume with nine bullets asks for exactly that. Component tests opt
into jsdom with a `@vitest-environment jsdom` docblock; everything else runs on
Node.

Vitest globals are off, so `describe`/`expect` are imported explicitly and RTL
cleanup is wired by hand in `vitest.setup.ts`.

Mock at `getAnthropicClient`, not at the SDK, so retry, validation, and
degradation are the real code under test.

## Things that look like style but are not

- `verdict` is derived from the score, never taken from the model. Two sources
  would eventually disagree on the same gauge.
- The scanning bar holds at 90% until the response lands. It must never claim
  completion before the work is done.
- `truncateText` counts the marker against the budget. It once did not, and
  "truncating" text just past the cap made it longer.
- The `NEXT_PUBLIC_PERSISTENCE` flag exists because the store is chosen in the
  browser. A server-only variable reads as `undefined` there and silently pins
  everyone to session mode.
