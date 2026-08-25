/**
 * Text tidying shared by the AI path and the degraded path.
 *
 * No `server-only` guard: the degraded report is built server-side, but these
 * are pure string functions with no secrets and no I/O, and keeping them
 * unguarded means one implementation rather than two that drift.
 */

/**
 * Where a word boundary stops being worth honouring.
 *
 * Cutting at the last space is only an improvement if that space is reasonably
 * near the end. On a string that is one enormous token the last space might sit
 * at 10% of the length, and clipping there would throw away most of the
 * sentence to avoid splitting one word.
 */
const BOUNDARY_FLOOR = 0.6;

/** Trailing punctuation that would read badly immediately before an ellipsis. */
const DANGLING = /[\s,;:—–-]+$/;

/**
 * Characters a finished sentence can legitimately end on. Used to tell "the
 * model stopped here" from "something cut it off here".
 */
const TERMINAL = /[.!?…"'’”)\]]$/;

/**
 * How close to the cap a string must sit before truncation is suspected.
 *
 * Constrained decoding stops at exactly `maxLength`, but a cut landing inside a
 * multi-byte token can leave it a character or two short, so this is a small
 * window rather than an equality check.
 */
const SUSPICION_WINDOW = 5;

/**
 * Hard-truncates to `limit`, preferring a word boundary, always marking the cut.
 *
 * The marker counts against the budget. It once did not, and "truncating" text
 * a character past the cap made it longer than it started.
 */
export function clampToWord(text: string, limit: number): string {
  if (text.length <= limit) return text;

  const clipped = text.slice(0, limit - 1);
  const lastSpace = clipped.lastIndexOf(" ");
  const body =
    lastSpace > limit * BOUNDARY_FLOOR ? clipped.slice(0, lastSpace) : clipped;

  return `${body.replace(DANGLING, "")}…`;
}

/**
 * List markers that never legitimately open a sentence.
 *
 * These are glyphs whose only job is to mark a list item, so one at the start
 * of a quote means the resume's LAYOUT came across with the words. Word
 * bullets extract into the private use area (U+F0B7 and neighbours) rather
 * than as U+2022, which is why those are here: for a DOCX that is the common
 * case, not an exotic one.
 */
const BULLET_GLYPH = /^[•·‣⁃∙▪▫■□●○◦◘❯❖]/;

/**
 * Markers that are only markers when whitespace follows.
 *
 * A hyphen or an asterisk can legitimately open a quote — "-15% margin" is a
 * figure, not a bullet — so these are stripped only in the shape that makes
 * them a list marker: marker, whitespace, then the sentence.
 */
const AMBIGUOUS_MARKER = /^[-*–—−‐‑]\s+/;

/** An opening quotation mark, which RULE 1 requires `detail` to begin with. */
const OPEN_QUOTE = /^["'“‘«„]/;

/**
 * Removes a list marker the model carried over from the resume's formatting.
 *
 * The model is told not to do this (RULE 1); this is the net for when it does
 * anyway. Deliberately narrow, for the reason `repairTruncation` is narrow: a
 * wrong guess mangles good output.
 *
 *  - Only at the START. A dash mid-sentence is punctuation and is left alone.
 *  - A marker just inside the opening quotation mark is still the start. RULE 1
 *    tells `detail` to OPEN with the quote, so `"• Responsible for..."` is
 *    where this actually shows up — stripping index 0 only would miss the
 *    common case and leave the bug looking half fixed.
 *  - Ambiguous markers need a following space, so a quote opening on a
 *    negative number survives.
 *  - One marker, not a run. Nothing observed emits two, and looping invites
 *    eating a real character behind an unlucky first one.
 */
export function stripLeadingMarker(text: string): string {
  const quote = OPEN_QUOTE.exec(text)?.[0] ?? "";
  const rest = text.slice(quote.length);

  const stripped = BULLET_GLYPH.test(rest)
    ? rest.slice(1).trimStart()
    : rest.replace(AMBIGUOUS_MARKER, "");

  return stripped === rest ? text : quote + stripped;
}

/**
 * Repairs a string the *decoder* cut, rather than one this app is truncating.
 *
 * Constrained decoding enforces `maxLength` by stopping mid-word, with no
 * marker of any kind. What reaches the UI is a sentence that simply stops:
 * "...requirements for Go/Python, PostgreSQL, AWS,,K", or one ending on a bare
 * trailing space, or — where the cut lands inside a multi-byte token — on a
 * stray character from another script entirely. All three were observed live.
 *
 * The repair is deliberately narrow, because "was this cut?" is a guess and a
 * wrong guess mangles good output:
 *
 *  - Only strings sitting within `SUSPICION_WINDOW` of the cap are touched. A
 *    short sentence without a full stop is the model's style, not a casualty.
 *  - Anything ending in terminal punctuation is left alone. That is what a
 *    finished sentence looks like, at any length.
 *  - Anything *over* the cap is left alone too, and this one matters: bounds the
 *    decoder failed to enforce are exactly what the retry exists to catch, and
 *    silently trimming them here would swallow the signal. Structured outputs on
 *    Anthropic do not enforce `maxLength` at all, so over-cap output is a real
 *    case rather than a hypothetical.
 *
 * Never lengthens: the ellipsis replaces at least one character it removed.
 */
export function repairTruncation(text: string, limit: number): string {
  const trimmed = text.trimEnd();

  if (trimmed.length > limit) return text;
  if (trimmed.length < limit - SUSPICION_WINDOW) return text;
  if (TERMINAL.test(trimmed)) return trimmed;

  const lastSpace = trimmed.lastIndexOf(" ");
  const body =
    lastSpace > limit * BOUNDARY_FLOOR
      ? trimmed.slice(0, lastSpace)
      : trimmed.slice(0, -1);

  return `${body.replace(DANGLING, "")}…`;
}
