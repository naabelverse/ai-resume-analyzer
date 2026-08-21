"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { isNarrowRoute } from "./narrow-routes";
import { cn } from "@/lib/utils";

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
 * The route list moved to `./narrow-routes` when the page-end feedback trigger
 * needed the same answer — it lines up with the card too, and on `/dashboard`
 * a plain `.shell` would have left it 132px to the card's left.
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
        isNarrowRoute(pathname) && "shell-narrow",
      )}
    >
      {children}
    </header>
  );
}
