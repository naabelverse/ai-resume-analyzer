"use client";

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SEVERITY_ORDER, type FeedbackItem, type Status } from "@/types";

const ICON: Record<Status, typeof Check> = {
  pass: Check,
  warn: AlertTriangle,
  fail: X,
};

const TONE: Record<Status, string> = {
  pass: "bg-success-tint text-success",
  warn: "bg-warning-tint text-warning",
  fail: "bg-danger-tint text-danger",
};

interface FeedbackListProps {
  items: FeedbackItem[];
}

export function FeedbackList({ items }: FeedbackListProps) {
  // Actionable items first. Sort a copy — never mutate the prop.
  const ordered = [...items].sort(
    (a, b) => SEVERITY_ORDER[a.status] - SEVERITY_ORDER[b.status],
  );

  return (
    <ul className="divide-y divide-line">
      {ordered.map((item, index) => (
        <FeedbackRow key={`${item.status}-${index}`} item={item} />
      ))}
    </ul>
  );
}

function FeedbackRow({ item }: { item: FeedbackItem }) {
  const [open, setOpen] = useState(false);
  const Icon = ICON[item.status];

  return (
    <li className="first:pt-0 last:pb-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-start gap-3 py-3 text-left"
      >
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
            TONE[item.status],
          )}
        >
          <Icon className="size-3.5" strokeWidth={3} />
        </span>

        <span className="min-w-0 flex-1 text-body text-ink">{item.text}</span>

        <ChevronDown
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-ink-soft transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <p className="pb-3 pl-9 text-note leading-relaxed text-ink-soft">
          {item.detail}
        </p>
      )}
    </li>
  );
}
