"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FilePlus2, History } from "lucide-react";

/**
 * The two places this nav can point — the only pair of routes a reader would
 * want to cross between.
 */
const PAST = { href: "/dashboard", label: "Past analyses", Icon: History } as const;
const NEW = { href: "/", label: "New analysis", Icon: FilePlus2 } as const;

/**
 * The header's nav item: exactly one, never pointing at the page you are on.
 *
 * It used to hide itself on `/dashboard` and show nothing there. The rule was
 * already the right one — not "hide on /dashboard" but "do not link to where
 * you already are", since a link to the current page does nothing when clicked
 * and reads as a misclick rather than as a no-op. What was wrong is what
 * happened once that rule fired: `/dashboard` got a header with no nav at all,
 * and the only way back to the form was the wordmark, which is a link a reader
 * has to already know is one.
 *
 * So the item SWAPS rather than disappears. Both invariants that made the old
 * version worth reading survive, and neither needs a route list to enforce:
 *
 *   - Never a self-link. `/` and `/analyze/[id]` offer the dashboard;
 *     `/dashboard` offers the form. No branch can produce an item whose href
 *     is the current path.
 *   - **At most one item**, which is `<Header>`'s rule and the reason the demo
 *     link was moved out to the form: two of these competed with each other
 *     and with the wordmark. This is why the obvious change was not the right
 *     one. Adding "New analysis" as a SECOND entry and filtering out whichever
 *     matches the current path reads as the natural generalisation, but
 *     `/analyze/[id]` matches neither, so it would render both and quietly
 *     restore the competition that was removed. One item chosen by the route
 *     cannot do that.
 *
 * The report route keeps exactly what it had: `/analyze/[id]` is neither
 * destination, so it falls through to the dashboard link it has always shown.
 *
 * The pathname is read here rather than passed in, and the client boundary
 * stops here — `<Header>` stays a server component, so the wordmark and the
 * card shell still render without waiting for this bundle. `usePathname`
 * resolves during server rendering too, so the right item is in the first HTML
 * rather than swapping after hydration.
 */
export function HeaderNav() {
  const pathname = usePathname();
  const { href, label, Icon } = pathname === PAST.href ? NEW : PAST;

  /*
    `-mx-3` takes the link's padding back out of the layout. The padding is
    there so the pointer target clears 40px on both axes; without the pull the
    label would sit 12px inside the shell on the right — off the edge every
    card below it lines up on — and 12px in from the wordmark on the wrapped
    row.

    There is no `null` branch left to explain. It existed because an empty
    <nav> is still a flex item and would have left its column gap behind as a
    hole beside the wordmark; now that the row always has both children, that
    gap is always wanted.
  */
  return (
    <nav className="-mx-3">
      <Link
        href={href}
        className="inline-flex min-h-10 items-center gap-1.5 px-3 text-body font-medium text-brand-600 hover:underline"
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </Link>
    </nav>
  );
}
