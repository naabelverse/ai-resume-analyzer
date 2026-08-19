import { FileText } from "lucide-react";

/**
 * Document icon in a rounded blue-tinted square, wordmark in the display
 * face carrying the brand gradient, subtitle beneath.
 */
export function Header() {
  return (
    <header className="shell pt-12 pb-9">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="grid size-12 shrink-0 place-items-center rounded-[16px] bg-brand-tint text-brand-600 shadow-[0_1px_2px_rgb(28_16_66/0.06)]"
        >
          <FileText className="size-5.5" strokeWidth={2.2} />
        </span>

        <div className="min-w-0">
          {/* The one place the display face gets to be the size it was chosen for. */}
          <h1 className="gradient-text text-display">AI Resume Analyzer</h1>
          <p className="mt-2 text-body text-ink-soft">
            Get AI-powered feedback to improve your resume
          </p>
        </div>
      </div>
    </header>
  );
}
