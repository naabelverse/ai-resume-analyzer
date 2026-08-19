import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium",
  {
    variants: {
      tone: {
        pass: "bg-success-tint text-success",
        warn: "bg-warning-tint text-warning",
        fail: "bg-danger-tint text-danger",
        brand: "bg-brand-tint text-brand-600",
        muted: "bg-muted-tint text-ink-soft",
      },
    },
    defaultVariants: {
      tone: "muted",
    },
  },
);

function Badge({
  className,
  tone,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
