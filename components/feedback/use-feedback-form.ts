"use client";

import { useCallback, useState } from "react";

import { toErrorCode, type ErrorCode } from "@/lib/errors";
import { HONEYPOT_FIELD, type FeedbackType } from "@/lib/feedback";
import { FEEDBACK_MAX_CHARS } from "@/lib/limits";
import type { FeedbackResponse } from "@/types";

/**
 * The feedback form's state and its one request.
 *
 * A hook rather than state inside the form, for a reason specific to living in
 * a modal: Radix unmounts dialog content when it closes, so anything the form
 * owns is destroyed the moment someone presses Escape. This lives in the
 * trigger, which stays mounted, and a half-written message survives a
 * mis-hit key.
 *
 * The same split `useFilePreview` uses on the upload page — the request and
 * its state machine here, the markup next door.
 */

/**
 * Idle, sending, sent, failed. No "validating" phase: the button is disabled
 * until the message has content, which is the only client-side rule there is,
 * and everything else is the server's answer.
 */
export type FeedbackPhase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "failed"; code: ErrorCode };

export interface FeedbackDraft {
  type: FeedbackType;
  message: string;
  email: string;
  /** Bound to the off-screen input. Always empty when a person filled it in. */
  honeypot: string;
}

const EMPTY_DRAFT: FeedbackDraft = {
  type: "analysis",
  message: "",
  email: "",
  honeypot: "",
};

export interface FeedbackForm {
  draft: FeedbackDraft;
  phase: FeedbackPhase;
  /** False while the message is blank or a send is in flight. */
  canSubmit: boolean;
  set: <K extends keyof FeedbackDraft>(key: K, value: FeedbackDraft[K]) => void;
  submit: (analysisId: string | null) => Promise<void>;
  /** Clears everything back to a blank form. */
  reset: () => void;
}

export function useFeedbackForm(): FeedbackForm {
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_DRAFT);
  const [phase, setPhase] = useState<FeedbackPhase>({ kind: "idle" });

  const set = useCallback<FeedbackForm["set"]>((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setPhase({ kind: "idle" });
  }, []);

  const sending = phase.kind === "sending";
  const canSubmit = draft.message.trim().length > 0 && !sending;

  const submit = useCallback(
    async (analysisId: string | null) => {
      if (draft.message.trim().length === 0 || sending) return;

      setPhase({ kind: "sending" });

      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          /*
            The message, the type, the optional address, the honeypot, and the
            id of whatever report was on screen. Nothing else — in particular
            not the resume text or the uploaded filename, which this component
            has no access to and the route would drop anyway.
          */
          body: JSON.stringify({
            type: draft.type,
            message: draft.message.slice(0, FEEDBACK_MAX_CHARS),
            email: draft.email,
            analysisId,
            [HONEYPOT_FIELD]: draft.honeypot,
          }),
        });

        const payload = (await response.json()) as FeedbackResponse;

        if (!payload.ok) {
          setPhase({ kind: "failed", code: toErrorCode(payload.error.code) });
          return;
        }

        setPhase({ kind: "sent" });
      } catch {
        /*
          `fetch` only rejects on a transport failure; every HTTP status
          resolves. Reported as a send failure rather than as NETWORK because
          that code's copy ends "run the analysis again", which is not what
          this person was doing — and from where they sit the two are the same
          event anyway: it did not send, and what they wrote is still here.
        */
        setPhase({ kind: "failed", code: "FEEDBACK_SEND_FAILED" });
      }
    },
    [draft, sending],
  );

  return { draft, phase, canSubmit, set, submit, reset };
}
