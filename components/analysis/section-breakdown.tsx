import { cn } from "@/lib/utils";
import { statusFor } from "@/lib/scoring";
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
  /**
   * Drops the score, the bar and the badge, leaving the section name and what
   * was found in it.
   *
   * Suppressing only the gauge upstream would have moved the problem 400px
   * down rather than fixed it: these six rows carry 0-100 numbers, green/amber/
   * red bars and badges reading "Pass" or "Poor", all derived from the same
   * structural signals the gauge was. Six small misleading grades in place of
   * one large one is not an improvement.
   *
   * The notes survive because they are the honest part. `lib/scoring.ts` writes
   * them as measurements — "Email, phone and GitHub are all present", "12
   * bullet lines, 612 words, 2 pages" — which is what this state actually has
   * the standing to report.
   */
  degraded?: boolean;
}

export function SectionBreakdown({
  sections,
  degraded = false,
}: SectionBreakdownProps) {
  return (
    <ul className="flex flex-col gap-4">
      {sections.map((section) => {
        /*
          Derived here, not read from `section.status`.

          `2b44aaf` stopped the MODEL supplying a status, but the field is still
          part of a stored `SectionScore`, so anything that authors a result by
          hand can still carry one that disagrees with its own score — the demo
          fixture did, which is how a section scoring 45 kept an amber "Needs
          work" beside it. Deriving at the point of display means score, label
          and bar cannot disagree on ANY path: the AI one, the degraded one,
          hand-written fixtures, and records stored before that commit.

          `statusFor` rather than a second set of thresholds here, so this and
          `lib/scoring.ts` cannot drift on what "warn" means.
        */
        const status = statusFor(section.score);

        return (
        <li key={section.name}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body font-medium text-ink">
              {SECTION_LABEL[section.name] ?? section.name}
            </span>
            {!degraded && (
              <div className="flex items-center gap-2">
                <Badge tone={status}>{STATUS_LABEL[status]}</Badge>
                <span className="w-9 text-right text-note font-semibold text-ink tabular-nums">
                  {section.score}
                </span>
              </div>
            )}
          </div>

          {!degraded && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gauge-track">
              <div
                className={cn("h-full rounded-full", BAR_TONE[status])}
                style={{ width: `${Math.min(100, Math.max(0, section.score))}%` }}
              />
            </div>
          )}

          <p className="mt-1.5 text-note leading-relaxed text-ink-soft">
            {section.note}
          </p>
        </li>
        );
      })}
    </ul>
  );
}
