"use client";

import { useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown } from "lucide-react";

import { JD_MAX_CHARS } from "@/lib/limits";
import { cn } from "@/lib/utils";

interface JobDescriptionInputProps {
  value?: string;
  onChange?: (value: string) => void;
  defaultOpen?: boolean;
}

/**
 * Collapsible job-description textarea. Leaving it empty is a first-class
 * case: keyword matching is skipped entirely rather than rendering an empty
 * panel downstream.
 */
export function JobDescriptionInput({
  value,
  onChange,
  defaultOpen = false,
}: JobDescriptionInputProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [internal, setInternal] = useState("");

  const text = value ?? internal;
  const atCap = text.length >= JD_MAX_CHARS;

  function handleChange(next: string) {
    const clipped = next.slice(0, JD_MAX_CHARS);
    if (value === undefined) setInternal(clipped);
    onChange?.(clipped);
  }

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-4">
      <Collapsible.Trigger
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-control px-1 py-2",
          "text-sm font-medium text-ink transition-colors hover:text-brand-600",
        )}
      >
        <span>Paste the job description (optional)</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 text-ink-soft transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </Collapsible.Trigger>

      <Collapsible.Content className="pt-2">
        <textarea
          value={text}
          onChange={(event) => handleChange(event.target.value)}
          rows={6}
          maxLength={JD_MAX_CHARS}
          placeholder="Paste the role's responsibilities and requirements here to see how well your resume matches."
          className={cn(
            "w-full resize-y rounded-panel border border-line bg-surface p-3",
            "text-sm text-ink placeholder:text-ink-soft/70",
            "outline-none focus-visible:border-brand-600",
          )}
        />
        <div className="mt-1.5 flex justify-end">
          <span
            className={cn(
              "text-xs tabular-nums",
              atCap ? "font-medium text-warning" : "text-ink-soft",
            )}
          >
            {text.length.toLocaleString()} / {JD_MAX_CHARS.toLocaleString()}
          </span>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
