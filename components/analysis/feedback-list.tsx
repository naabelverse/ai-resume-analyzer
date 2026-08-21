"use client";

import { useState } from "react";
import { AlertCircle, Check, ChevronDown, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { SEVERITY_ORDER, type FeedbackItem, type Status } from "@/types";

const ICON: Record<Status, typeof Check> = {
  pass: Check,
  warn: AlertCircle,
  fail: X,
};

const TONE: Record<Status, string> = {
  pass: "bg-success-tint text-success",
  warn: "bg-warning-tint text-warning",
  fail: "bg-danger-tint text-danger",
};

/**
 * Both end icons sit in a box exactly one body line tall, so each centres on
 * the first line of the title rather than on the whole wrapped block. A shared
 * box also means the two agree with each other for free: they used to carry
 * the same `mt-0.5` nudge despite being different sizes, which left the 24px
 * badge 4px below the 16px chevron.
 */
const ICON_SLOT = "flex h-[1lh] shrink-0 items-center";

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
        <span aria-hidden="true" className={ICON_SLOT}>
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full",
              TONE[item.status],
            )}
          >
            <Icon className="size-3.5" strokeWidth={3} />
          </span>
        </span>

        <span className="min-w-0 flex-1 text-body text-ink">{item.text}</span>

        {/* The chevron gets the badge's 24px circle so the row has equal
            weight at both ends; a bare stroke glyph opposite a filled badge
            reads left-heavy however well the two are aligned. */}
        <span aria-hidden="true" className={ICON_SLOT}>
          <span className="grid size-6 place-items-center rounded-full bg-muted-tint text-ink-soft">
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180",
              )}
            />
          </span>
        </span>
      </button>

      {open && (
        <p className="pb-3 pl-9 text-note leading-relaxed text-ink-soft">
          {item.detail}
        </p>
      )}
    </li>
  );
}
