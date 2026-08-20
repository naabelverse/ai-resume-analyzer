"use client";

import { FileText, Loader2, X } from "lucide-react";

import { InlineError } from "@/components/error-state";
import type { ErrorCode } from "@/lib/errors";
import { MAX_TEXT_CHARS } from "@/lib/limits";
import type { ExtractPreview } from "@/types";
import type { PreviewStatus } from "./use-file-preview";

/**
 * What stands in the drop target's place once a file is held.
 *
 * It shows the extracted text rather than a rendering of the document, and
 * says so, because the text is what the model reads: a mangled extraction is
 * invisible in a page thumbnail and obvious here, which is the whole point of
 * spending a round trip before spending an analysis.
 *
 * Everything factual on screen comes from the extraction — page count
 * included. Nothing is inferred from the filename, which is the one thing
 * about an uploaded file guaranteed to be a guess.
 */

interface FilePreviewProps {
  file: File;
  /** Non-null only when `status` is "ready". */
  preview: ExtractPreview | null;
  status: PreviewStatus;
  errorCode: ErrorCode | null;
  onRemove(): void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;

  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/** Fixed locale so the thousands separator does not depend on the machine. */
function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

export function FilePreview({
  file,
  preview,
  status,
  errorCode,
  onRemove,
}: FilePreviewProps) {
  /*
    Built from what is actually known. During extraction that is the size and
    nothing else — the format comes from the server's magic-byte sniff and the
    page count from the parse, so both would be invented if shown early.
  */
  const facts = [
    preview && preview.kind.toUpperCase(),
    formatBytes(file.size),
    preview?.pageCount != null &&
      `${preview.pageCount} page${preview.pageCount === 1 ? "" : "s"}`,
  ].filter(Boolean);

  return (
    <div className="panel flex flex-1 flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-tint text-brand-600"
        >
          <FileText className="size-5" strokeWidth={2.2} />
        </span>

        {/* min-w-0 so the filename truncates instead of forcing the row wider
            than the column and pushing the remove control out of it. */}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-body font-medium text-ink" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 text-caption text-ink-soft">{facts.join(" · ")}</p>
        </div>

        {/*
          40px square. It has to clear the minimum on its own rather than by
          borrowing the row's height, because it is the only way back to an
          empty dropzone — including out of the rejected state, where there is
          nothing else on screen to act on.
        */}
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          className="grid size-10 shrink-0 place-items-center rounded-control text-ink-soft transition-colors hover:bg-muted-tint hover:text-ink"
        >
          <X className="size-4" strokeWidth={2.4} />
        </button>
      </div>

      {status === "extracting" && (
        <p className="flex items-center gap-2 text-caption text-ink-soft">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Reading the file…
        </p>
      )}

      {status === "rejected" && errorCode && <InlineError code={errorCode} />}

      {status === "ready" && preview && (
        <>
          {preview.truncated && (
            <p
              role="status"
              className="rounded-control bg-warning-tint px-3 py-2 text-caption text-ink"
            >
              Clipped to {formatCount(MAX_TEXT_CHARS)} characters for analysis —{" "}
              {formatCount(preview.charCount)} were extracted. The start and end
              are kept; the middle is dropped.
            </p>
          )}

          {/*
            tabIndex on the scroll container: a region only a mouse wheel can
            move is unreachable by keyboard, and an unnamed one gives a screen
            reader nothing to announce on the way in.
          */}
          <div
            role="region"
            aria-label="Extracted text"
            tabIndex={0}
            className="max-h-[22rem] min-h-[8.5rem] flex-1 overflow-auto rounded-control border border-line bg-surface p-3"
          >
            <pre className="font-mono text-caption leading-relaxed whitespace-pre-wrap text-ink-soft">
              {preview.text}
            </pre>
          </div>

          <p className="text-caption text-ink-soft">
            This is the text that gets analysed, not a rendering of your file. If
            it reads wrong here, it will read wrong to the model.
          </p>
        </>
      )}
    </div>
  );
}
