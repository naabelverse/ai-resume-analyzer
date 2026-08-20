"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/error-state";
import { ScanningCard } from "@/components/analysis/scanning-card";
import { Dropzone } from "./dropzone";
import { FilePreview } from "./file-preview";
import { useFilePreview } from "./use-file-preview";
import { JobDescriptionInput } from "./jd-input";
import { WhatYouGet } from "./what-you-get";
import { toErrorCode, type ErrorCode } from "@/lib/errors";
import { newAnalysisId, store } from "@/lib/store";
import type { AnalysisRecord, AnalyzeResponse } from "@/types";

/**
 * Owns the whole upload-to-results flow: the request, the progress display,
 * and the hand-off to `/analyze/[id]`.
 *
 * File selection and its extraction belong to `useFilePreview`, which carries
 * a race worth testing on its own. What is left here is the submit.
 *
 * It is the only client component on the landing page. The page itself stays a
 * server component so the header and card shell render without waiting for
 * this bundle.
 */

/**
 * Advances the scanning card while the request is in flight.
 *
 * The bar approaches 90% and stops there. It completes only when the response
 * actually lands, so it can never claim to be finished before the work is —
 * the specific dishonesty that makes most progress bars useless.
 *
 * Driven by the request's start timestamp rather than an elapsed counter the
 * effect has to reset: elapsed time is derived during render, so there is no
 * synchronous setState on the way in or out of the busy state.
 */
function useScanProgress(startedAt: number | null) {
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;

    const timer = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const elapsed = startedAt === null ? 0 : Math.max(0, now - startedAt);

  return {
    // Asymptotic: fast at first, never reaching the ceiling on its own. The
    // time constant is tuned for open-weight inference on shared capacity,
    // which runs far slower than a frontier hosted model — a curve tuned for a
    // 5s response would sit pinned at 90% for most of a 40s one, which reads as
    // a hang rather than as progress.
    progress: Math.round(90 * (1 - Math.exp(-elapsed / 22_000))),
    stageIndex:
      elapsed < 1_200 ? 0 : elapsed < 4_000 ? 1 : elapsed < 30_000 ? 2 : 3,
  };
}

export function AnalyzeForm() {
  const router = useRouter();
  const selection = useFilePreview();

  const [jobDescription, setJobDescription] = useState("");
  const [submitError, setSubmitError] = useState<ErrorCode | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const busy = startedAt !== null;
  const { progress, stageIndex } = useScanProgress(startedAt);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const { file, preview, status } = selection;
  /*
    Only a file whose text we have already seen can be submitted. That is a
    stronger guarantee than the old pre-flight check gave: the server has
    already sniffed these bytes and got readable text out of them, so the
    button is enabled on evidence rather than on the filename's say-so.
  */
  const ready = file !== null && status === "ready";

  function handleFile(selected: File) {
    setSubmitError(null);
    selection.select(selected);
  }

  function handleRemove() {
    setSubmitError(null);
    selection.clear();
  }

  async function submit() {
    if (!ready || busy) return;

    setSubmitError(null);
    setStartedAt(Date.now());

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const body = new FormData();
      // The file, not the text we already hold. The route re-extracts from
      // these bytes, which keeps the magic-byte sniff and the character cap on
      // the server where they are enforceable — roughly 20ms for not having to
      // trust the browser about what it is sending.
      body.set("file", file);
      if (jobDescription.trim()) body.set("jobDescription", jobDescription.trim());

      const response = await fetch("/api/analyze", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      const payload = (await response.json()) as AnalyzeResponse;

      if (!payload.ok) {
        setSubmitError(toErrorCode(payload.error.code));
        return;
      }

      const record: AnalysisRecord = {
        id: newAnalysisId(),
        fileName: file.name,
        createdAt: new Date().toISOString(),
        data: payload.data,
        meta: payload.meta,
      };

      await store.save(record);
      router.push(`/analyze/${record.id}`);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      // fetch only rejects on a transport failure; every HTTP status resolves.
      setSubmitError("NETWORK");
    } finally {
      abortRef.current = null;
      setStartedAt(null);
    }
  }

  return (
    <div>
      {/*
        Two columns once there is room for them: the drop target is the
        primary action and keeps the left, the optional job description and
        the submit sit right. Below the breakpoint the grid collapses to one
        column and its gap supplies the vertical rhythm the children no
        longer carry themselves.
      */}
      <div className="grid gap-5 min-[880px]:grid-cols-2 min-[880px]:gap-7">
        {/* Flex column so the zone — or the preview standing in for it — can
            claim the height the right-hand column sets, with the submit error
            keeping its own space beneath. */}
        <div className="flex flex-col">
          {file ? (
            <FilePreview
              file={file}
              preview={preview}
              status={status}
              errorCode={selection.errorCode}
              onRemove={handleRemove}
            />
          ) : (
            <Dropzone onFileSelected={handleFile} />
          )}

          {/* A rejected file states its own reason inside the panel above, so
              only a failed submit needs saying here. */}
          {submitError && <InlineError code={submitError} />}
        </div>

        {/*
          The job description keeps the top of the column because it is the
          control; what the report contains sits beneath it in both states,
          so the column is never empty and never reflows when the textarea
          opens and closes.
        */}
        <div className="flex flex-col gap-4">
          <JobDescriptionInput value={jobDescription} onChange={setJobDescription} />
          {/*
            Two columns only. Below the breakpoint the grid collapses and there
            is no empty column left to fill, so this stops earning its place and
            starts pushing the submit button off the first screen on a phone.
          */}
          <div className="hidden min-[880px]:block">
            <WhatYouGet />
          </div>
        </div>
      </div>

      {/* Full width: this is the progress of the form, not of either column. */}
      {busy && (
        <div className="panel mt-5">
          <ScanningCard stageIndex={stageIndex} progress={progress} />
        </div>
      )}

      {/*
        The action spans both columns rather than sitting under the job
        description. Pinning it to the foot of the right column left a hole
        between it and the collapsed trigger above; as a footer it closes the
        card and reads as belonging to the whole form, which it does.
      */}
      {/*
        `--line-strong`, not `--line`. This rule divides the form body from the
        action row, which is a heavier boundary than the one `--line` is for —
        that token divides two things already sharing a surface, and against
        the card's foot it measures dL* 6.31 (1.17:1), which is why it read as
        a smudge rather than a division. `--line-strong` is dL* 11.10 (1.33:1),
        near enough to twice the separation.

        It stops there rather than taking a darker value. `.card` draws its own
        edge in `--line-strong`, and a rule inside a container has no business
        out-weighing the container's border — that inverts the hierarchy it is
        supposed to express. This is the ceiling for an internal division, and
        anything heavier is a different problem than a faint rule.
      */}
      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line-strong pt-5">
        <p className="text-caption text-ink-soft">
          {busy
            ? "Working — open-weight models take a little longer, usually 20 to 60 seconds."
            : "Takes up to a minute to analyse."}
        </p>
        <Button type="button" onClick={submit} disabled={!ready || busy}>
          {busy ? "Analysing…" : "Analyse resume"}
        </Button>
      </div>
    </div>
  );
}
