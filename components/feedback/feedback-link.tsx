"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isNarrowRoute } from "@/components/layout/narrow-routes";
import { cn } from "@/lib/utils";
import { FeedbackForm } from "./feedback-form";
import { useFeedbackForm } from "./use-feedback-form";

/**
 * The one entry point to the feedback form, at the end of every page.
 *
 * Placement is most of the design here, so it is written down.
 *
 * Not in the header. That row's rule — recorded in `<Header>` — is at most one
 * nav item, arrived at by moving the demo link out when two links there
 * competed with each other and with the wordmark. It is also the worst
 * available spot at 390px, where the row wraps around 600px and a second item
 * would stack under an already two-line wordmark, above the drop target.
 *
 * Not the centred link row that used to sit under the card either. That was
 * two brand-blue body-size links reading as navigation, at `Reveal index={1}`,
 * on the first screen beside the submit button. This is one caption-size line
 * in `--ink-soft`, aligned left on the shell edge, below `main`'s own bottom
 * padding — past every primary action by position rather than by restraint,
 * which is the only version of "does not compete" that survives someone
 * restyling it later.
 *
 * `<footer>` for the landmark, not for the row. One control at the end of a
 * document is what `contentinfo` is for, and it gives a screen-reader user a
 * way to reach this without tabbing through a full report.
 *
 * Focus trapping, Escape, and returning focus to the trigger are Radix's, not
 * reimplemented here. That is the reason to take the dependency: hand-rolled
 * focus traps are where this kind of component quietly stops being keyboard
 * accessible.
 */

/** The route whose next segment is an analysis id. */
const ANALYZE_PREFIX = "/analyze/";

/**
 * The id of the report being read, or null anywhere else.
 *
 * Derived from the pathname rather than passed in by each page, for the reason
 * `<HeaderNav>` and `<HeaderShell>` both record: App Router gives a server
 * component no way to read a path, and a prop from every page makes the
 * default for a route nobody has thought about yet "whatever the last author
 * remembered to pass".
 *
 * `demo` is a real answer rather than an exclusion. Someone sending feedback
 * from the sample report is telling you they were looking at the sample, and a
 * subject line that says so is worth more than one that says nothing.
 *
 * Exported for its test, which is the only other caller.
 */
export function analysisIdFrom(pathname: string): string | null {
  if (!pathname.startsWith(ANALYZE_PREFIX)) return null;

  const id = pathname.slice(ANALYZE_PREFIX.length).split("/")[0] ?? "";
  return id.length > 0 ? id : null;
}

export function FeedbackLink() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const form = useFeedbackForm();

  const analysisId = analysisIdFrom(pathname);

  function handleOpenChange(next: boolean) {
    setOpen(next);

    /*
      Cleared on close only when the message actually went.

      Closing on a draft — or on a failure — keeps every field as it was.
      Escape is easy to hit by accident, and losing five minutes of writing to
      a stray key is the same loss whether a modal caused it or a crash did.

      Radix unmounts the content on close, so this state has to live out here
      to survive at all. That is why `useFeedbackForm` is called in this
      component rather than inside the form.
    */
    if (!next && form.phase.kind === "sent") form.reset();
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <footer
        className={cn(
          // Lines up with the card above it on both widths. `.shell` alone
          // would leave this 132px left of the card on /dashboard — the
          // offset `<HeaderShell>` exists to remove for the header.
          "shell pb-12",
          isNarrowRoute(pathname) && "shell-narrow",
        )}
      >
        <Dialog.Trigger
          className={cn(
            // A resting underline rather than hover-only: there is no hover on
            // a touch screen, and a bare grey line of text is not obviously
            // something you can press.
            "inline-flex min-h-10 items-center text-caption text-ink-soft underline decoration-line-strong underline-offset-4 transition-colors",
            "hover:text-ink hover:decoration-ink-soft",
          )}
        >
          Send feedback
        </Dialog.Trigger>
      </footer>

      <Dialog.Portal>
        {/*
          The overlay scrolls, not the content.

          A dialog centred with `place-items-center` inside a fixed box clips
          its own top the moment it outgrows the viewport — which is exactly
          what a five-row textarea plus a soft keyboard does on a phone. Making
          the overlay the scroll container and centring inside a `min-h-full`
          child keeps the whole modal reachable at any height.

          `items-start` below 640px on purpose: a vertically centred dialog is
          the one a keyboard covers. Anchored near the top, the message field
          stays above it.
        */}
        <Dialog.Overlay className="fixed inset-0 z-50 overflow-y-auto bg-scrim">
          <div className="flex min-h-full items-start justify-center p-4 sm:items-center sm:p-6">
            {/*
              `.card` is the app's surface — the same face, edge, radius and
              shadow as every other box on the page. `relative` is what the
              off-screen honeypot inside the form positions against.
            */}
            <Dialog.Content className="card relative w-full max-w-[30rem]">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Dialog.Title className="text-title">Send feedback</Dialog.Title>
                  {/*
                    Says the report is noted, without printing the id. The
                    silent part of the payload is the id itself; that something
                    was attached is not a secret, and a person who has just
                    described a bug deserves to know which report it will
                    arrive against.
                  */}
                  <Dialog.Description className="mt-1.5 text-note leading-relaxed text-ink-soft">
                    {analysisId
                      ? "Tell me what's wrong, missing, or worth adding. The report you're on is noted, so I can look at the same one."
                      : "Tell me what's wrong, missing, or worth adding."}
                  </Dialog.Description>
                </div>

                <Dialog.Close asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-mt-2 -mr-2 shrink-0"
                  >
                    <X aria-hidden="true" />
                    <span className="sr-only">Close</span>
                  </Button>
                </Dialog.Close>
              </div>

              <FeedbackForm form={form} analysisId={analysisId} />
            </Dialog.Content>
          </div>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
