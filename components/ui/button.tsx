import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Height 40px (h-10), radius --radius-control, medium weight, never uppercase.
 *
 * Only layout and sizing live here. Each variant's fill, hover, press and
 * disabled treatment is a `.btn-*` component class in globals.css, so a
 * variant cannot ship with a hover state and no disabled one — which is what
 * happened before: `disabled:opacity-50` in this base string was every
 * variant's entire disabled story, and it put the primary gradient on screen
 * at half strength, reading as merely pale rather than as off.
 */
const buttonVariants = cva(
  "btn inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "btn-primary",
        secondary: "btn-secondary",
        ghost: "btn-ghost",
      },
      size: {
        default: "h-10 px-4 text-body",
        sm: "h-9 px-3 text-note",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
