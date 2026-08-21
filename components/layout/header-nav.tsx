"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History } from "lucide-react";

/** The one destination this nav has. Compared against the current path below. */
const HREF = "/dashboard";

/**
 * The header's nav item, hidden on the page it points at.
 *
 * A link to the page you are already on does nothing when clicked, which reads
 * as a misclick rather than as a no-op. So the rule is not "hide on
 * /dashboard" but "do not link to where you already are" — the item compares
 * the current path against its own href, and anything added here later gets
 * that behaviour without being told.
 *
 * That is also why the pathname is read here rather than passed in. App Router
 * gives a server component no way to see it, and a prop from each page makes
 * the default for a route nobody has thought about yet "whatever the last
 * author remembered to pass". `usePathname` resolves during server rendering
 * too, so the item is absent from the first HTML rather than hydrating away.
 *
 * The client boundary stops here. `<Header>` stays a server component, so the
 * wordmark and the card shell still render without waiting for this bundle.
 *
 * Nothing is stranded by hiding it: the wordmark links to `/`, which is the
 * way back from every route this header appears on.
 */
export function HeaderNav() {
  const pathname = usePathname();

  /*
    `null`, not an empty <nav>. The header is a flex row with a column gap, and
    a wrapper that renders nothing is still a flex item — it would leave the
    gap it used to sit in as a hole beside the wordmark. Returning nothing at
    all leaves the row with a single child and no gap to apply.
  */
  if (pathname === HREF) return null;

  /*
    `-mx-3` takes the link's padding back out of the layout. The padding is
    there so the pointer target clears 40px on both axes; without the pull the
    label would sit 12px inside the shell on the right — off the edge every
    card below it lines up on — and 12px in from the wordmark on the wrapped
    row.
  */
  return (
    <nav className="-mx-3">
      <Link
        href={HREF}
        className="inline-flex min-h-10 items-center gap-1.5 px-3 text-body font-medium text-brand-600 hover:underline"
      >
        <History className="size-3.5" aria-hidden="true" />
        Past analyses
      </Link>
    </nav>
  );
}
