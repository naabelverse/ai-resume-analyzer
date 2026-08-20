"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { toErrorCode, type ErrorCode } from "@/lib/errors";
import { MAX_FILE_BYTES } from "@/lib/limits";
import type { ExtractPreview, ExtractResponse } from "@/types";

/**
 * Owns the held file and its extraction.
 *
 * Split out of `<AnalyzeForm>` because the interesting behaviour here is a
 * race rather than a render: the user can pick a second file while the first
 * is still extracting, and the wrong outcome — the first file's text sitting
 * under the second file's name — looks entirely plausible on screen. As its
 * own hook it can be driven directly by a test instead of through the form.
 *
 * Two defences, because they cover different halves of the race:
 *
 *   - The `AbortController` cancels the request still on the wire.
 *   - The generation counter discards a response that had *already* arrived
 *     when the newer selection landed. Abort cannot help there; the bytes were
 *     in hand and the continuation was queued.
 *
 * Neither is redundant. Dropping the abort would leave a pointless request
 * running; dropping the counter would leave the bug.
 */

export type PreviewStatus = "empty" | "extracting" | "ready" | "rejected";

export interface FilePreviewState {
  file: File | null;
  /** Non-null only when `status` is "ready". */
  preview: ExtractPreview | null;
  status: PreviewStatus;
  errorCode: ErrorCode | null;
  select(file: File): void;
  /** Back to the empty dropzone, from any state including a rejection. */
  clear(): void;
}

/**
 * The two rejections worth catching before spending a round trip on them.
 *
 * Deliberately not full validation: the server sniffs magic bytes and remains
 * the authority on what a file actually is. This only avoids uploading five
 * megabytes to be told it is five megabytes.
 */
function clientSideProblem(file: File): ErrorCode | null {
  if (file.size > MAX_FILE_BYTES) return "FILE_TOO_LARGE";
  if (file.name.toLowerCase().endsWith(".doc")) return "LEGACY_DOC";
  return null;
}

export function useFilePreview(): FilePreviewState {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExtractPreview | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("empty");
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  /** Cancels whatever is in flight and invalidates its pending continuation. */
  const supersede = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const select = useCallback(
    (selected: File) => {
      const generation = supersede();

      // The name appears immediately rather than after the round trip — the
      // user should never be looking at an empty zone that is holding a file.
      setFile(selected);
      setPreview(null);

      const problem = clientSideProblem(selected);
      if (problem) {
        setErrorCode(problem);
        setStatus("rejected");
        return;
      }

      setErrorCode(null);
      setStatus("extracting");

      const controller = new AbortController();
      abortRef.current = controller;

      void (async () => {
        try {
          const body = new FormData();
          body.set("file", selected);

          const response = await fetch("/api/extract", {
            method: "POST",
            body,
            signal: controller.signal,
          });
          const payload = (await response.json()) as ExtractResponse;

          if (generationRef.current !== generation) return;

          if (payload.ok) {
            setPreview(payload.data);
            setStatus("ready");
          } else {
            setErrorCode(toErrorCode(payload.error.code));
            setStatus("rejected");
          }
        } catch (cause) {
          if (generationRef.current !== generation) return;
          // An abort is this app cancelling its own request. Reporting it as a
          // network failure would blame the user for their own second pick.
          if (cause instanceof DOMException && cause.name === "AbortError") return;

          setErrorCode("NETWORK");
          setStatus("rejected");
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
        }
      })();
    },
    [supersede],
  );

  const clear = useCallback(() => {
    supersede();
    setFile(null);
    setPreview(null);
    setErrorCode(null);
    setStatus("empty");
  }, [supersede]);

  return { file, preview, status, errorCode, select, clear };
}
