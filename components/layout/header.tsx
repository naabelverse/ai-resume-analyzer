import { FileText } from "lucide-react";

/**
 * Document icon in a rounded blue-tinted square, wordmark in the display
 * face carrying the brand gradient, subtitle beneath.
 */
export function Header() {
  return (
    <header className="shell pt-10 pb-8">
      <div className="flex items-center gap-3.5">
        <span
          aria-hidden="true"
          className="grid size-11 shrink-0 place-items-center rounded-[14px] bg-brand-tint text-brand-600"
        >
          <FileText className="size-5" strokeWidth={2.2} />
        </span>

        <div className="min-w-0">
          <h1 className="gradient-text text-[26px] leading-none sm:text-[28px]">
            AI Resume Analyzer
          </h1>
          <p className="mt-2 text-sm text-ink-soft">
            Get AI-powered feedback to improve your resume
          </p>
        </div>
      </div>
    </header>
  );
}
