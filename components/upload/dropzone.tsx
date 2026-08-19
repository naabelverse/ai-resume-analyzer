"use client";

import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { FileChip } from "./file-chip";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type DropzoneStatus =
  | "idle"
  | "dragging"
  | "uploading"
  | "success"
  | "error";

interface DropzoneProps {
  /** Name of the currently held file, or null when none. */
  fileName?: string | null;
  /** User-facing error message rendered under the zone. */
  error?: string | null;
  /** 0-100 while status is "uploading". */
  progress?: number;
  status?: DropzoneStatus;
  /**
   * Phase 2 wires real validation and extraction in here. Phase 1 leaves it
   * optional so the layout can be reviewed before any logic exists.
   */
  onFileSelected?: (file: File) => void;
}

/**
 * Accessibility: the dashed area is a <label> wrapping a visually hidden file
 * input. That gives Tab reachability and Enter/Space activation natively,
 * rather than reimplementing them on a div with role="button".
 */
export function Dropzone({
  fileName = null,
  error = null,
  progress = 0,
  status = "idle",
  onFileSelected,
}: DropzoneProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

  const effectiveStatus: DropzoneStatus = isDragging ? "dragging" : status;

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    // Single file only — a second drop replaces the first.
    const file = event.dataTransfer.files?.[0];
    if (file) onFileSelected?.(file);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFileSelected?.(file);
    // Reset so re-selecting the same filename still fires a change event.
    event.target.value = "";
  }

  return (
    <div>
      <label
        htmlFor={inputId}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "panel flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center transition-colors",
          "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600",
          effectiveStatus === "dragging"
            ? "border-brand-600 bg-brand-tint"
            : "hover:bg-muted-tint/60",
          effectiveStatus === "error" && "border-danger",
        )}
      >
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept={`${PDF_MIME},${DOCX_MIME},.pdf,.docx`}
          onChange={handleChange}
        />

        <span
          aria-hidden="true"
          className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand-600"
        >
          <UploadCloud className="size-5" strokeWidth={2.2} />
        </span>

        <span className="text-sm font-medium text-ink">
          Drop your resume here, or{" "}
          <span className="text-brand-600 underline underline-offset-2">
            browse
          </span>
        </span>
        <span className="text-xs text-ink-soft">PDF or DOCX, up to 5MB</span>
      </label>

      {effectiveStatus === "uploading" && (
        <div className="mt-4">
          <Progress value={progress} aria-label="Upload progress" />
        </div>
      )}

      {fileName && effectiveStatus !== "uploading" && (
        <FileChip name={fileName} />
      )}

      {/* Errors persist under the zone; the zone itself stays usable. */}
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
