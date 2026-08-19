import { Check, Minus, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { KeywordMatch } from "@/types";

interface KeywordMatchPanelProps {
  /** Null when no job description was supplied. */
  data: KeywordMatch | null;
}

export function KeywordMatchPanel({ data }: KeywordMatchPanelProps) {
  // No JD is a normal state, not a broken one.
  if (!data) {
    return (
      <div className="panel flex flex-col items-center gap-2 px-6 py-8 text-center">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-full bg-muted-tint text-ink-soft"
        >
          <Search className="size-4" strokeWidth={2.2} />
        </span>
        <p className="text-sm text-ink-soft">
          Paste a job description to see how well your resume matches it.
        </p>
      </div>
    );
  }

  const total = data.matched.length + data.missing.length;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {data.matched.map((keyword) => (
          <Chip key={`matched-${keyword}`} tone="matched" label={keyword} />
        ))}
        {data.missing.map((keyword) => (
          <Chip key={`missing-${keyword}`} tone="missing" label={keyword} />
        ))}
      </div>

      <div className="mt-5">
        <Progress
          value={data.matchPercent}
          aria-label={`${data.matchPercent}% keyword match`}
        />
        <div className="mt-2 flex items-baseline justify-between gap-3">
          <span className="text-[13px] text-ink-soft">
            Matched {data.matched.length}/{total} keywords
          </span>
          <span className="text-[13px] font-semibold text-ink tabular-nums">
            {data.matchPercent}%
          </span>
        </div>
      </div>
    </div>
  );
}

function Chip({ tone, label }: { tone: "matched" | "missing"; label: string }) {
  const Icon = tone === "matched" ? Check : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
        tone === "matched"
          ? "bg-success-tint text-success"
          : "bg-muted-tint text-ink-soft",
      )}
    >
      <Icon aria-hidden="true" className="size-3" strokeWidth={3} />
      {label}
    </span>
  );
}
