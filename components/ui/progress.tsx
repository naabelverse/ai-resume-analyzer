"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "@/lib/utils";

/**
 * Track plus a blue-violet gradient fill. The fill is width-animated rather
 * than transform-animated so it never overshoots its rounded container.
 */
function Progress({
  className,
  indicatorClassName,
  value = 0,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * Overrides the fill. Opt-in, so the gradient stays the default and the
   * scanning card is untouched — `className` reaches the track only, and the
   * keyword bar needs to recolour the fill while leaving the track alone.
   */
  indicatorClassName?: string;
}) {
  const clamped = Math.min(100, Math.max(0, value ?? 0));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={clamped}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-gauge-track",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
          indicatorClassName ?? "gradient-fill",
        )}
        style={{ width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
