import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SECTION_LABEL, type SectionScore, type Status } from "@/types";

/**
 * `fail` is every section scoring below 50, not an absent one. This read
 * "Missing", which was untrue of a section scoring 40 whose note said the
 * bullets were present but described duties instead of outcomes. The label has
 * to be a grade so that it stays true at 0 and at 49 alike.
 */
const STATUS_LABEL: Record<Status, string> = {
  pass: "Pass",
  warn: "Needs work",
  fail: "Poor",
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
            <span className="text-body font-medium text-ink">
              {SECTION_LABEL[section.name] ?? section.name}
            </span>
            <div className="flex items-center gap-2">
              <Badge tone={section.status}>
                {STATUS_LABEL[section.status]}
              </Badge>
              <span className="w-9 text-right text-note font-semibold text-ink tabular-nums">
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

          <p className="mt-1.5 text-note leading-relaxed text-ink-soft">
            {section.note}
          </p>
        </li>
      ))}
    </ul>
  );
}
