import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface RevealProps {
  children: ReactNode;
  /** Position in the stagger sequence. Each step adds 60ms. */
  index?: number;
  className?: string;
}

/**
 * Cards fade and rise 8px on mount, staggered 60ms apart.
 *
 * Deliberately CSS-only. An earlier framer-motion version branched on
 * `useReducedMotion()`, which returns null during SSR and the first client
 * render — the differing markup produced a hydration mismatch that broke
 * every card below it. A plain element with a CSS animation renders the same
 * on both sides, still animates without a client bundle, and honours
 * prefers-reduced-motion through the global media query in globals.css.
 */
export function Reveal({ children, index = 0, className }: RevealProps) {
  return (
    <div
      className={cn("reveal", className)}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {children}
    </div>
  );
}
