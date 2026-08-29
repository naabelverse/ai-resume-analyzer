import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Surface, --radius-card, 1px --line border, layered shadow, 24px padding.
 * The `.card` class in globals.css owns those values so the tokens stay in
 * one place; this component only adds layout.
 */
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card" className={cn("card", className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="card-title"
      className={cn("text-title", className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="card-description"
      className={cn("mt-1.5 text-note text-ink-soft", className)}
      {...props}
    />
  );
}

export { Card, CardTitle, CardDescription };
