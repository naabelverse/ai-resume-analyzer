/**
 * Which routes put their content in the narrow column.
 *
 * Extracted from `<HeaderShell>` when a second element — the page-end feedback
 * trigger — needed the same answer. Two copies of this set would have been two
 * things that must stay equal in files that never import each other, which is
 * the drift `--shell-narrow` exists to prevent one level down.
 *
 * A genuine route rule, unlike `<HeaderNav>`'s. That component compares the
 * path against its own href, so its behaviour — do not link to where you
 * already are — needs no list to maintain. A layout width has no such
 * self-referential property to derive from: it is narrow here because
 * `/dashboard` shows one list and constrains its card, which is a fact about
 * that page and nothing else. So it is written down, next to the reason.
 *
 * A page that adds itself here must also put `shell-narrow` on its card; the
 * shared `--shell-narrow` token keeps the widths equal, but nothing makes a
 * page apply both.
 *
 * No `"use client"` and no React: it is a string test, imported by client
 * components that have already read the pathname.
 */
const NARROW_ROUTES = new Set(["/dashboard"]);

export function isNarrowRoute(pathname: string): boolean {
  return NARROW_ROUTES.has(pathname);
}
