import Link from "next/link";
import { FileText } from "lucide-react";

import { HeaderNav } from "./header-nav";
import { HeaderShell } from "./header-shell";

/**
 * Document icon in a rounded blue-tinted square, wordmark in the display face
 * carrying the brand gradient, subtitle beneath — and, opposite it, at most
 * one nav item.
 *
 * At most one on two counts. The demo link sat here for a while and the two
 * competed with each other and with the wordmark; it has gone to the form,
 * next to the drop target it is an alternative to. And what is left hides
 * itself on the page it points at, so /dashboard sees a header with no nav at
 * all.
 *
 * Stays a server component. Both pathname-dependent decisions — whether the
 * nav item appears, and how wide the row is — are made in the two client
 * components around this markup, `<HeaderNav>` and `<HeaderShell>`; the
 * wordmark renders from the server as it always did, arriving at the shell as
 * `children` rather than being re-rendered inside the client bundle.
 *
 * The width is not the same on every route. `/dashboard` is one list and puts
 * its card in the narrow column, and a full-width header above a centred
 * narrow card leaves its left edge 132px adrift of the card's — the offset
 * `app/page.tsx` describes as reading like an accident. `<HeaderShell>` owns
 * that rule and the list of routes it applies to.
 *
 * The brand block is a link to `/` because this header is shared by all three
 * routes, and it is what keeps hiding the nav item from stranding anyone:
 * whatever page you land on, the wordmark is the way back. On the upload page
 * it is a self-link, which is what a wordmark is on every site that has one.
 *
 * The row wraps rather than shrinks. The wordmark sets the header's height and
 * the nav item is one short line, so when they stop fitting side by side —
 * around 600px — the thing to give up is the side-by-side, not the size of
 * either.
 */
export function Header() {
  return (
    <HeaderShell>
      <Link href="/" className="flex min-w-0 items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-brand-tint text-brand-600 shadow-[0_1px_2px_rgb(28_16_66/0.06)]"
        >
          <FileText className="size-5.5" strokeWidth={2.2} />
        </span>

        <div className="min-w-0">
          {/* The one place the display face gets to be the size it was chosen for. */}
          <h1 className="gradient-text text-display">AI Resume Analyzer</h1>
          <p className="mt-2 text-body text-ink-soft">
            Get AI-powered feedback to improve your resume
          </p>
        </div>
      </Link>

      {/* Renders nothing on the page it points at — see `<HeaderNav>`. With one
          child left the row keeps the wordmark's height and `justify-between`
          has nothing to push against, so no gap is left where it was. */}
      <HeaderNav />
    </HeaderShell>
  );
}
