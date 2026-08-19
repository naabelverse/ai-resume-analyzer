import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { SectionScore, Status } from "@/types";

const SECTION_LABEL: Record<string, string> = {
  contact: "Contact",
  summary: "Summary",
  experience: "Experience",
  education: "Education",
  skills: "Skills",
  formatting: "Formatting",
};

const STATUS_LABEL: Record<Status, string> = {
  pass: "Pass",
  warn: "Needs work",
  fail: "Missing",
};

const BAR_TONE: Record<Status, string> = {
  pass: "bg-success",
  warn: "bg-warning",
  fail: "bg-danger",
};

interface SectionBreakdownProps {
  sections: SectionScore[];
}

export function SectionBreakdown({ sections }: SectionBreakdownProps) {
  return (
    <ul className="flex flex-col gap-4">
      {sections.map((section) => (
        <li key={section.name}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink">
              {SECTION_LABEL[section.name] ?? section.name}
            </span>
            <div className="flex items-center gap-2">
              <Badge tone={section.status}>
                {STATUS_LABEL[section.status]}
              </Badge>
              <span className="w-9 text-right text-[13px] font-semibold text-ink tabular-nums">
                {section.score}
              </span>
            </div>
          </div>

          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gauge-track">
            <div
              className={cn("h-full rounded-full", BAR_TONE[section.status])}
              style={{ width: `${Math.min(100, Math.max(0, section.score))}%` }}
            />
          </div>

          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
            {section.note}
          </p>
        </li>
      ))}
    </ul>
  );
}
