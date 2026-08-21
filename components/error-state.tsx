import {
  AlertTriangle,
  AtSign,
  Ban,
  Clock,
  CreditCard,
  Gauge,
  FileWarning,
  MailX,
  MessageSquareText,
  MessageSquareWarning,
  ScanLine,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { ERROR_COPY, type ErrorCode } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * One component for every failure mode.
 *
 * Failures render as persistent state, never as a toast that vanishes before
 * the user has finished reading it. Each one says what happened and gives a
 * single next action — the copy lives in `ERROR_COPY`, so this file decides
 * only how it looks, never what it says.
 */

const ICON: Record<ErrorCode, LucideIcon> = {
  UNSUPPORTED_FILE: FileWarning,
  LEGACY_DOC: FileWarning,
  FILE_TOO_LARGE: FileWarning,
  EMPTY_RESUME: ScanLine,
  EXTRACTION_FAILED: FileWarning,
  JD_TOO_LONG: FileWarning,
  AI_UNAVAILABLE: AlertTriangle,
  AI_SCHEMA: AlertTriangle,
  AI_RATE_LIMITED: Gauge,
  AI_CREDITS_EXHAUSTED: CreditCard,
  RATE_LIMITED: Clock,
  /* The feedback codes borrow their analysis counterparts' glyphs where the
     event is the same kind of thing — a ceiling is a clock either way. Only
     the wording differs, which is where the difference actually is. */
  FEEDBACK_EMPTY: MessageSquareText,
  FEEDBACK_TOO_LONG: MessageSquareText,
  FEEDBACK_EMAIL_INVALID: AtSign,
  FEEDBACK_INVALID: MessageSquareWarning,
  FEEDBACK_RATE_LIMITED: Clock,
  FEEDBACK_SEND_FAILED: MailX,
  NETWORK: WifiOff,
  UNKNOWN: Ban,
};

interface ErrorStateProps {
  code: ErrorCode;
  /** Rendered under the action line — a retry button, usually. */
  children?: React.ReactNode;
  className?: string;
}

export function ErrorState({ code, children, className }: ErrorStateProps) {
  const copy = ERROR_COPY[code];
  const Icon = ICON[code];

  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center", className)}
    >
      <span
        aria-hidden="true"
        className="grid size-11 place-items-center rounded-full bg-danger-tint text-danger"
      >
        <Icon className="size-5" strokeWidth={2.2} />
      </span>

      <div className="max-w-[46ch]">
        <h2 className="text-title">{copy.title}</h2>
        <p className="mt-2 text-body leading-relaxed text-ink-soft">{copy.message}</p>
        <p className="mt-2 text-body leading-relaxed font-medium text-ink">
          {copy.action}
        </p>
      </div>

      {children}
    </div>
  );
}

/**
 * The inline variant used under the dropzone: same wording, no icon block,
 * because the surrounding card already establishes the context.
 */
export function InlineError({ code }: { code: ErrorCode }) {
  const copy = ERROR_COPY[code];

  return (
    <p role="alert" className="mt-3 text-body text-danger">
      <span className="font-medium">{copy.message}</span>{" "}
      <span className="text-ink-soft">{copy.action}</span>
    </p>
  );
}
