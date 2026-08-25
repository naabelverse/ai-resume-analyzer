/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { BulletRewrites } from "@/components/analysis/bullet-rewrites";
import type { BulletRewrite } from "@/types";

function rewrite(overrides: Partial<BulletRewrite> = {}): BulletRewrite {
  return {
    original: "Responsible for maintaining the booking service.",
    improved: "Maintained the booking service, cutting p95 latency by [X%].",
    why: "Names the outcome instead of the duty.",
    ...overrides,
  };
}

describe("<BulletRewrites> — the placeholder convention", () => {
  it("explains the brackets once, not once per card", () => {
    render(<BulletRewrites rewrites={[rewrite(), rewrite(), rewrite()]} />);

    expect(
      screen.getAllByText(/Square brackets mark numbers only you know/),
    ).toHaveLength(1);
  });

  it("does not explain them when there is nothing to explain", () => {
    render(<BulletRewrites rewrites={[]} />);

    expect(screen.queryByText(/Square brackets mark numbers/)).toBeNull();
  });

  it("highlights each placeholder in the improved text", () => {
    render(
      <BulletRewrites
        rewrites={[
          rewrite({
            improved: "Cut build time from [X ms] to [X ms] across [X] services.",
          }),
        ]}
      />,
    );

    const marks = [...document.querySelectorAll("mark")];
    expect(marks.map((m) => m.textContent)).toEqual(["[X ms]", "[X ms]", "[X]"]);
  });

  /**
   * The token carries a space, and without `whitespace-nowrap` it breaks across
   * lines at that space and stops reading as one thing. Asserted on the class
   * because jsdom has no layout engine to measure the break itself.
   */
  it("keeps a placeholder from breaking mid-token", () => {
    render(
      <BulletRewrites rewrites={[rewrite({ improved: "Served [X req/s]." })]} />,
    );

    expect(document.querySelector("mark")?.className).toContain(
      "whitespace-nowrap",
    );
  });

  /**
   * The no-op path. A string with no match must render exactly what shipped
   * before — no <mark>, and the text intact in one node.
   */
  it("renders unchanged when there is no placeholder", () => {
    const improved =
      "Cut p95 checkout latency from 820ms to 140ms across three services.";
    render(<BulletRewrites rewrites={[rewrite({ improved })]} />);

    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByText(improved)).toBeTruthy();
  });

  it("leaves an unmatched bracket alone rather than swallowing the line", () => {
    const improved = "Reduced cost [by a third and shipped it.";
    render(<BulletRewrites rewrites={[rewrite({ improved })]} />);

    expect(document.querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByText(improved)).toBeTruthy();
  });
});

describe("<BulletRewrites> — Copy", () => {
  /**
   * The point of the whole feature: the candidate must receive the brackets so
   * they know what to replace. Copying the rendered text instead would hand
   * them whatever whitespace the split fragments produced, which is not
   * guaranteed to equal the string the model wrote.
   */
  it("copies the source string, brackets intact", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const improved = "Maintained the booking service, cutting p95 latency by [X%].";
    render(<BulletRewrites rewrites={[rewrite({ improved })]} />);

    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledWith(improved);
  });

  it("copies the source even when the text was split for highlighting", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const improved = "Cut build time from [X ms] to [X ms] across [X] services.";
    render(<BulletRewrites rewrites={[rewrite({ improved })]} />);

    await userEvent.click(screen.getByRole("button", { name: /copy/i }));

    // Not the concatenated DOM text — the string that came in.
    expect(writeText).toHaveBeenCalledWith(improved);
    expect(writeText.mock.calls[0]![0]).toContain("[X ms]");
  });
});
