"use client";

import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";

/** The real pipeline stages, in order. Phase 4 advances these from the fetch. */
export const SCAN_STAGES = [
  "Reading your file",
  "Extracting text",
  "Analysing content",
  "Scoring",
] as const;

export type ScanStage = (typeof SCAN_STAGES)[number];

/**
 * Ceiling held while the request is still in flight. The bar only completes
 * once the response actually lands — it never runs ahead of the work.
 */
export const IN_FLIGHT_CEILING = 90;

interface ScanningCardProps {
  /** Index into SCAN_STAGES. */
  stageIndex?: number;
  /** 0-100. Clamped to IN_FLIGHT_CEILING until `complete` is true. */
  progress?: number;
  complete?: boolean;
}

export function ScanningCard({
  stageIndex = 0,
  progress = 25,
  complete = false,
}: ScanningCardProps) {
  const stage = SCAN_STAGES[Math.min(stageIndex, SCAN_STAGES.length - 1)];
  const value = complete ? 100 : Math.min(progress, IN_FLIGHT_CEILING);

  return (
    <div>
      {/* Centred as one group: `justify-center` on the row, not `text-center`
          on the copy. Centring the text alone would leave the icon pinned left
          and split the row across two axes. The two lines stay left-aligned
          against each other inside the group, which is what keeps the icon
          reading as a label for them rather than as a third column.

          The bar below is a sibling, not part of this row, so it still spans
          the card edge to edge. */}
      <div className="flex items-center justify-center gap-3">
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-[12px] bg-brand-tint text-brand-600"
        >
          <Sparkles
            className={cn("size-4", !complete && "animate-pulse")}
            strokeWidth={2.2}
          />
        </span>
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">AI Scanning…</p>
          <p
            aria-live="polite"
            className="mt-0.5 truncate text-note text-ink-soft"
          >
            {complete ? "Done" : stage}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <Progress value={value} aria-label={`Analysis progress: ${stage}`} />
      </div>
    </div>
  );
}
