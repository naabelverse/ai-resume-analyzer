import { Check } from "lucide-react";

interface FileChipProps {
  name: string;
}

/**
 * Filename left, green check right, separated from the drop area above by a
 * subtle top border.
 */
export function FileChip({ name }: FileChipProps) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
      <span className="truncate text-sm font-medium text-ink" title={name}>
        {name}
      </span>
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center rounded-full bg-success-tint text-success"
      >
        <Check className="size-3.5" strokeWidth={3} />
      </span>
      <span className="sr-only">File ready</span>
    </div>
  );
}
