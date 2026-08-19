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
