// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KeywordMatchPanel } from "@/components/analysis/keyword-match";

describe("KeywordMatchPanel", () => {
  it("renders matched and missing keywords together", () => {
    render(
      <KeywordMatchPanel
        data={{
          matched: ["TypeScript", "React"],
          missing: ["Kubernetes"],
          matchPercent: 67,
        }}
      />,
    );

    expect(screen.getByText("TypeScript")).toBeInTheDocument();
    expect(screen.getByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("Matched 2/3 keywords")).toBeInTheDocument();
    expect(screen.getByText("67%")).toBeInTheDocument();
  });

  it("prompts for a job description when there is no match to show", () => {
    // The null case is a first-class state, not an error: no job description
    // means keyword matching was skipped, and an empty panel would read as a
    // bug rather than as a choice the user made.
    render(<KeywordMatchPanel data={null} />);

    expect(
      screen.getByText(/paste a job description to see how well your resume matches/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/matched/i)).not.toBeInTheDocument();
  });

  it("handles a resume that matched nothing without dividing by zero", () => {
    render(
      <KeywordMatchPanel
        data={{ matched: [], missing: ["Go", "Rust"], matchPercent: 0 }}
      />,
    );

    expect(screen.getByText("Matched 0/2 keywords")).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });
});

describe("KeywordMatchPanel — the two groups", () => {
  const both = {
    matched: ["TypeScript", "React"],
    missing: ["Kubernetes", "Go"],
    matchPercent: 50,
  };

  it("labels each group and puts the actionable one second", () => {
    const { container } = render(<KeywordMatchPanel data={both} />);

    const labels = [...container.querySelectorAll("p")]
      .map((p) => p.textContent?.trim())
      .filter((t) => t === "In your resume" || t === "Not found");

    expect(labels).toEqual(["In your resume", "Not found"]);
  });

  it("puts each keyword under its own group", () => {
    render(<KeywordMatchPanel data={both} />);

    const matched = screen.getByRole("list", { name: "In your resume" });
    const missing = screen.getByRole("list", { name: "Not found" });

    expect(matched).toHaveTextContent("TypeScript");
    expect(matched).not.toHaveTextContent("Kubernetes");
    expect(missing).toHaveTextContent("Kubernetes");
    expect(missing).not.toHaveTextContent("TypeScript");
  });

  /**
   * A label over nothing reads as a rendering fault, and "In your resume" over
   * an empty row states something untrue.
   */
  it("renders no 'Not found' label when everything matched", () => {
    render(
      <KeywordMatchPanel
        data={{ matched: ["Go", "Rust"], missing: [], matchPercent: 100 }}
      />,
    );

    expect(screen.getByText("In your resume")).toBeInTheDocument();
    expect(screen.queryByText("Not found")).not.toBeInTheDocument();
    expect(screen.getByText("Matched 2/2 keywords")).toBeInTheDocument();
  });

  it("renders no 'In your resume' label when nothing matched", () => {
    render(
      <KeywordMatchPanel
        data={{ matched: [], missing: ["Go", "Rust"], matchPercent: 0 }}
      />,
    );

    expect(screen.queryByText("In your resume")).not.toBeInTheDocument();
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  /**
   * The markers are a second signal beyond colour, which is the whole point for
   * a colour-blind reader. Labelling the groups does not replace them.
   */
  it("keeps a marker icon on every pill", () => {
    const { container } = render(<KeywordMatchPanel data={both} />);

    const pills = container.querySelectorAll("li > span");
    expect(pills).toHaveLength(4);
    for (const pill of pills) {
      expect(pill.querySelector("svg")).not.toBeNull();
    }
  });

  it("gives the percentage context without claiming a measured figure", () => {
    render(<KeywordMatchPanel data={both} />);

    expect(
      screen.getByText(/a full match is rare and not the goal/i),
    ).toBeInTheDocument();
    // No invented benchmark: the only percentage on screen is the computed one.
    expect(screen.queryByText(/70%/)).not.toBeInTheDocument();
  });
});
