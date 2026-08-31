// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DegradedBanner } from "@/components/analysis/degraded-banner";
import { DEGRADED_COPY, ERROR_COPY, GENERIC_RETRY } from "@/lib/errors";

/** The four codes the route can degrade on, and the only ones this renders. */
const DEGRADABLE = [
  "AI_UNAVAILABLE",
  "AI_SCHEMA",
  "AI_RATE_LIMITED",
  "AI_CREDITS_EXHAUSTED",
] as const;

describe("DegradedBanner", () => {
  it("says what happened without blaming the reader's file", () => {
    render(<DegradedBanner reason="AI_SCHEMA" />);

    expect(
      screen.getByText(/We couldn't finish this analysis/),
    ).toBeInTheDocument();
    expect(screen.getByText(/your resume is fine/)).toBeInTheDocument();
  });

  /*
    The specific words that sent this round of work, asserted absent rather
    than described in a comment.

    "unreadable" is the one that mattered. It was about our own response and it
    read as a verdict on the reader's document — the single misreading here
    that would send someone off to rebuild a file that was never at fault.
  */
  it.each(DEGRADABLE)("renders no internal vocabulary for %s", (code) => {
    const { container } = render(<DegradedBanner reason={code} />);
    const text = (container.textContent ?? "").toLowerCase();

    for (const word of [
      "unreadable",
      "transient",
      "schema",
      "nvidia",
      "expected format",
      "structural checks",
      "the model",
    ]) {
      expect(text).not.toContain(word);
    }
  });

  /*
    A link, not a button, and it has to point at the upload page: the file's
    bytes are gone by the time this renders, so there is nothing here to
    re-submit. See the component for the full reasoning.
  */
  it("offers a way out that admits the file must be chosen again", () => {
    render(<DegradedBanner reason="AI_UNAVAILABLE" />);
    const link = screen.getByRole("link", { name: DEGRADED_COPY.linkLabel });

    expect(link).toHaveAttribute("href", "/");
    expect(link.textContent).not.toMatch(/try again/i);
  });

  /*
    Why this component still takes a `reason` at all. Waiting fixes a rate
    limit and never fixes exhausted credit, so the two must not give the same
    advice — folding them together is what would have someone retrying a wall.
  */
  it("gives advice that differs by cause", () => {
    const { container: limited } = render(
      <DegradedBanner reason="AI_RATE_LIMITED" />,
    );
    const { container: broke } = render(
      <DegradedBanner reason="AI_CREDITS_EXHAUSTED" />,
    );

    expect(limited.textContent).toContain(ERROR_COPY.AI_RATE_LIMITED.action);
    expect(broke.textContent).toContain(ERROR_COPY.AI_CREDITS_EXHAUSTED.action);
    expect(broke.textContent).toMatch(/won't help/i);
  });

  /*
    The banner must not print the one instruction its own button already is.

    "Running it again usually works." sat beside a button reading "Upload it
    again" from `95ae0c9`, the commit that wrote both — never a regression,
    just a pairing that was wrong from the first render. Asserted on the two
    codes that carry `GENERIC_RETRY`, and asserted as the absence of the string
    rather than of a rendered node, so reinstating it in any form fails here.

    The button is checked in the same breath: dropping the line is only correct
    while something else on the banner still tells the reader what to do.
  */
  it.each(["AI_UNAVAILABLE", "AI_SCHEMA"] as const)(
    "drops the generic retry line for %s, because the button already says it",
    (code) => {
      const { container } = render(<DegradedBanner reason={code} />);

      expect(ERROR_COPY[code].action).toBe(GENERIC_RETRY);
      expect(container.textContent).not.toContain(GENERIC_RETRY);
      expect(
        screen.getByRole("link", { name: DEGRADED_COPY.linkLabel }),
      ).toHaveAttribute("href", "/");
    },
  );

  it("still renders the state when the cause is unknown", () => {
    render(<DegradedBanner reason={null} />);

    expect(
      screen.getByText(/We couldn't finish this analysis/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/");
  });
});
