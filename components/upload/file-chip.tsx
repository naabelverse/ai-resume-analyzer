import { AlertTriangle, Check } from "lucide-react";

import { cn } from "@/lib/utils";

interface FileChipProps {
  name: string;
  /**
   * The file was rejected but is still held — a dropzone that silently
   * discards what you just gave it is the worse failure. What it must not do
   * is wear the success tick while the error directly below says the opposite.
   */
  invalid?: boolean;
}

/**
 * Filename left, status mark right, separated from the drop area above by a
 * subtle top border.
 */
export function FileChip({ name, invalid = false }: FileChipProps) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
      <span className="truncate text-body font-medium text-ink" title={name}>
        {name}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "grid size-5 shrink-0 place-items-center rounded-full",
          invalid ? "bg-danger-tint text-danger" : "bg-success-tint text-success",
        )}
      >
        {invalid ? (
          <AlertTriangle className="size-3.5" strokeWidth={3} />
        ) : (
          <Check className="size-3.5" strokeWidth={3} />
        )}
      </span>
      <span className="sr-only">{invalid ? "File not accepted" : "File ready"}</span>
    </div>
  );
}
