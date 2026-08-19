// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ErrorState } from "@/components/error-state";
import { ERROR_COPY, type ErrorCode } from "@/lib/errors";

describe("ErrorState", () => {
  const codes = Object.keys(ERROR_COPY) as ErrorCode[];

  it.each(codes)("renders a title, cause and next action for %s", (code) => {
    render(<ErrorState code={code} />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(ERROR_COPY[code].title);
    expect(alert).toHaveTextContent(ERROR_COPY[code].message);
    expect(alert).toHaveTextContent(ERROR_COPY[code].action);
  });

  it("uses the exact required wording for a legacy .doc", () => {
    render(<ErrorState code="LEGACY_DOC" />);
    expect(
      screen.getByText(
        "Old .doc format isn't supported. Save as PDF or .docx and try again.",
      ),
    ).toBeInTheDocument();
  });

  it("uses the exact required wording for a scanned resume", () => {
    render(<ErrorState code="EMPTY_RESUME" />);
    expect(
      screen.getByText(
        "This looks like a scanned image. Upload a text-based PDF, or export a fresh copy from Word or Google Docs.",
      ),
    ).toBeInTheDocument();
  });
});
