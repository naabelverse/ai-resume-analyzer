"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

/**
 * Routes whose page puts its card in the narrow column, and so want a header
 * the same width.
 *
 * This one is a genuine route rule, unlike `<HeaderNav>`'s. That component
 * compares the path against its own href, so its behaviour — do not link to
 * where you already are — needs no list to maintain. A header's width has no
 * such self-referential property to derive from: it is narrow here because
 * `/dashboard` shows one list and constrains its card, which is a fact about
 * that page and nothing else. So it is written down, next to the reason.
 *
 * A page that adds itself here must also put `shell-narrow` on its card; the
 * shared `--shell-narrow` token keeps the two widths equal, but nothing makes
 * a page apply both.
 */
const NARROW_ROUTES = new Set(["/dashboard"]);

/**
 * The header's outer element, sized from the current route.
 *
 * It exists so `<Header>` can stay a server component. The width depends on
 * the pathname, App Router gives a server component no way to read one, and
 * the alternative — a prop from each page — makes the default for a route
 * nobody has thought about yet "whatever the last author remembered to pass".
 * That is the same reasoning `<HeaderNav>` records for reading the path
 * itself.
 *
 * Only this wrapper is a client component. The wordmark arrives as
 * `children`, already rendered by the server, so nothing about it waits for
 * this bundle — the client boundary is the `<header>` element, not its
 * contents. `usePathname` resolves during server rendering too, so the width
 * is correct in the first HTML rather than corrected on hydration.
 */
export function HeaderShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <header
      className={cn(
        "shell flex flex-wrap items-center justify-between gap-x-6 gap-y-2 pt-12 pb-9",
        NARROW_ROUTES.has(pathname) && "shell-narrow",
      )}
    >
      {children}
    </header>
  );
}
