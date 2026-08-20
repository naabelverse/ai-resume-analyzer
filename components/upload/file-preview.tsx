"use client";

import { FileText, Loader2, X } from "lucide-react";

import { InlineError } from "@/components/error-state";
import type { ErrorCode } from "@/lib/errors";
import { MAX_TEXT_CHARS, TRUNCATION_MARKER } from "@/lib/limits";
import { cn } from "@/lib/utils";
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

/* No colour: the ink is inherited from `.quote-well`, so the well and its text
   cannot be restyled apart from each other. */
const RESUME_TEXT = "font-mono text-caption leading-relaxed whitespace-pre-wrap";

/**
 * The extracted text, with the truncation marker lifted out of it.
 *
 * `truncateText` splices a plain-text marker into the middle of the string it
 * returns, which is right for the model — it reads one string — and wrong for
 * a reader, who gets the app's own words in the resume's face and colour, one
 * more line to scroll past. Splitting on the marker lets the gap render as a
 * gap: same amber as the banner above, so the two read as one system saying
 * one thing in two places.
 *
 * The marker is imported rather than retyped. It is spliced in by `lib/extract`
 * and matched here, and two copies of that string would fail silently — the
 * split would simply never match and the band would quietly stop appearing.
 */
function ExtractedText({ preview }: { preview: ExtractPreview }) {
  const parts = preview.text.split(TRUNCATION_MARKER);

  // Untruncated text, or a marker that somehow is not there: one plain block.
  // Never assume the split matched — a missing band is better than a crash.
  if (parts.length !== 2) {
    return <pre className={cn(RESUME_TEXT, "p-3")}>{preview.text}</pre>;
  }

  const [head, tail] = parts;
  // `charCount` is the pre-truncation length and `text` still carries the
  // marker, so the marker comes back off before the difference means anything.
  const dropped = Math.max(
    0,
    preview.charCount - (preview.text.length - TRUNCATION_MARKER.length),
  );

  return (
    <>
      <pre className={cn(RESUME_TEXT, "px-3 pt-3")}>{head}</pre>

      {/*
        Full-bleed, which is why the padding sits on these children rather than
        on the scroll container: a band inset by the container's own padding
        reads as another paragraph, and the point of it is to read as a cut.
        Sans face on purpose — nothing in the resume's own face should be the
        app talking.

        Same amber as the banner above the panel, on purpose: one summarises
        the clip, the other marks where it happened, and they should read as
        one system saying one thing in two places.
      */}
      <p className="my-2 border-y border-warning bg-warning-tint px-3 py-2 text-caption font-medium text-ink">
        {formatCount(dropped)} characters cut from here. This part of your resume
        is not sent to the model.
      </p>

      <pre className={cn(RESUME_TEXT, "px-3 pb-3")}>{tail}</pre>
    </>
  );
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

            Radius and overflow live on the SAME element, and must keep doing
            so. Splitting them — radius on a clipping wrapper, overflow on an
            inner scroller — was an attempt to round the scrollbar's corners
            and it detached the scrollbar from the well instead.

            The scrollbar is the browser's own, recoloured and not otherwise
            touched. It sits inside this element because that is what a native
            scrollbar does in its own scroll container; every version that
            reached for width, pseudo-elements or a gutter broke either the
            corners or the placement. See `.quote-well` in globals.css.
          */}
          <div
            role="region"
            aria-label="Extracted text"
            tabIndex={0}
            /*
              `.quote-well` owns the surface, the edge, the inset and the
              scrollbar — the last of which is why it is a class and not a
              stack of utilities.

              This was white inside a tinted panel, so the innermost element
              was the brightest thing on screen and the nesting read
              inside-out. The fill now sits below the panel's, at a cool
              214deg where the card's surfaces are lavender at 249deg — which
              is what says the text is a document quoted back rather than a
              surface the app owns, without leaving the page's colour world to
              say it. The amber band below depends on that hue gap: see the
              token's own note for why lightness cannot carry it.
            */
            className="quote-well max-h-[22rem] min-h-[8.5rem] flex-1 overflow-auto"
          >
            <ExtractedText preview={preview} />
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
