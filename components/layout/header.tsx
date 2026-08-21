import Link from "next/link";
import { FileText, History } from "lucide-react";

/**
 * Document icon in a rounded blue-tinted square, wordmark in the display face
 * carrying the brand gradient, subtitle beneath — and one nav item opposite.
 *
 * One, deliberately. The demo link sat here beside it for a while and the two
 * competed with each other and with the wordmark; it has gone to the form,
 * next to the drop target it is an alternative to. What is left is the only
 * link here that is really navigation — a place in the app you go to.
 *
 * The brand block is a link to `/` because this header is shared by all three
 * routes. "Past analyses" is how you leave the upload page; the wordmark is
 * how you get back from wherever it led, so /dashboard and /analyze/[id] are
 * never dead ends. On the upload page it is a self-link, which is what a
 * wordmark is on every site that has one.
 *
 * The row wraps rather than shrinks. The wordmark sets the header's height and
 * the nav item is one short line, so when they stop fitting side by side —
 * around 600px — the thing to give up is the side-by-side, not the size of
 * either.
 */
export function Header() {
  return (
    <header className="shell flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-12 pb-9">
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

      {/*
        `-mx-3` takes the link's padding back out of the layout. The padding is
        there so the pointer target clears 40px on both axes; without the pull
        the label would sit 12px inside the shell on the right — off the edge
        every card below it lines up on — and 12px in from the wordmark on the
        wrapped row.
      */}
      <nav className="-mx-3">
        <Link
          href="/dashboard"
          className="inline-flex min-h-10 items-center gap-1.5 px-3 text-body font-medium text-brand-600 hover:underline"
        >
          <History className="size-3.5" aria-hidden="true" />
          Past analyses
        </Link>
      </nav>
    </header>
  );
}
