"use client";

import { useId, useState, type ChangeEvent, type DragEvent } from "react";
import { UploadCloud } from "lucide-react";

import { cn } from "@/lib/utils";

const PDF_MIME = "application/pdf";
const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

interface DropzoneProps {
  onFileSelected(file: File): void;
}

/**
 * The empty state, and only the empty state.
 *
 * It used to carry the held filename, the upload progress and the error too,
 * which meant the drop target stayed on screen at full height showing nothing
 * while a chip underneath described a file the user could neither see nor
 * remove. Once a file is held, `<FilePreview>` takes this space instead — so
 * every status this component once modelled now belongs to something else, and
 * what is left is genuinely one state plus the drag.
 *
 * Accessibility: the dashed area is a <label> wrapping a visually hidden file
 * input. That gives Tab reachability and Enter/Space activation natively,
 * rather than reimplementing them on a div with role="button".
 */
export function Dropzone({ onFileSelected }: DropzoneProps) {
  const inputId = useId();
  const [isDragging, setIsDragging] = useState(false);

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
    if (file) onFileSelected(file);
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onFileSelected(file);
    // Reset so re-selecting the same filename still fires a change event.
    event.target.value = "";
  }

  return (
    // Grows to the foot of its grid row rather than leaving the left half of
    // the card short — and a larger target is a better one to throw a file at.
    <label
      htmlFor={inputId}
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "dropzone flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center transition-colors",
        "focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600",
        // Resting, hover and drag all live on `.dropzone*` in globals.css, so
        // no state can ship with a fill and no border.
        isDragging && "dropzone-active",
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

      <span className="text-body font-medium text-ink">
        Drop your resume here, or{" "}
        <span className="text-brand-600 underline underline-offset-2">
          browse
        </span>
      </span>
      <span className="text-caption text-ink-soft">PDF or DOCX, up to 5MB</span>
    </label>
  );
}
