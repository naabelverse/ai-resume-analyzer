// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { analysisIdFrom, FeedbackLink } from "@/components/feedback/feedback-link";
import { ERROR_COPY } from "@/lib/errors";
import { HONEYPOT_FIELD } from "@/lib/feedback";

/**
 * The feedback entry point and its modal.
 *
 * Four promises are kept here, and each one is a test rather than a comment:
 * the modal never opens by itself, the analysis id travels silently, a failure
 * never clears what was typed, and the confirmation appears only after a send
 * that actually succeeded.
 */

const pathname = vi.hoisted(() => ({ current: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const fetchMock = vi.fn();

/** The route's success envelope — no data, just the fact. */
function sent() {
  return { ok: true, json: async () => ({ ok: true }) };
}

function refused(code: keyof typeof ERROR_COPY) {
  return {
    ok: false,
    json: async () => ({
      ok: false,
      error: { code, message: ERROR_COPY[code].message },
    }),
  };
}

/** The JSON body of the one request made. */
function requestBody(): Record<string, unknown> {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const init = fetchMock.mock.calls[0]![1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

const EMAIL_LABEL = "Your email (optional, if you’d like a reply)";

async function open() {
  const user = userEvent.setup();
  render(<FeedbackLink />);

  const trigger = screen.getByRole("button", { name: "Send feedback" });
  await user.click(trigger);

  return { user, trigger, dialog: await screen.findByRole("dialog") };
}

beforeEach(() => {
  pathname.current = "/";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(sent());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("analysisIdFrom", () => {
  it.each([
    ["/analyze/a1b2c3d4e5f6a7b8", "a1b2c3d4e5f6a7b8"],
    // The sample is a real answer, not an exclusion: it tells the operator the
    // person was looking at the demo.
    ["/analyze/demo", "demo"],
    ["/analyze/abc/extra", "abc"],
  ])("reads the id out of %s", (path, expected) => {
    expect(analysisIdFrom(path)).toBe(expected);
  });

  it.each(["/", "/dashboard", "/analyze/", "/analyzed/abc"])(
    "returns null for %s, which carries no analysis",
    (path) => {
      expect(analysisIdFrom(path)).toBeNull();
    },
  );
});

describe("<FeedbackLink>", () => {
  it("shows a quiet trigger and no dialog until it is clicked", () => {
    // No modal on load, no prompt on scroll. The trigger is the only way in.
    render(<FeedbackLink />);

    expect(screen.getByRole("button", { name: "Send feedback" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("sits in a contentinfo landmark at the end of the page", () => {
    render(<FeedbackLink />);

    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("button", { name: "Send feedback" }),
    ).toBeInTheDocument();
  });

  it("credits the author beside the trigger, on one line", async () => {
    render(<FeedbackLink />);

    const footer = screen.getByRole("contentinfo");
    const credit = within(footer).getByRole("link", { name: "Muhammad Nabil" });

    expect(credit).toHaveAttribute(
      "href",
      "https://www.linkedin.com/in/muhammad-nabil-82b16642b",
    );
    // A new tab, and `noopener` so the opened page cannot reach back through
    // `window.opener`. `noreferrer` for good measure.
    expect(credit).toHaveAttribute("target", "_blank");
    expect(credit).toHaveAttribute("rel", "noopener noreferrer");

    // One line, so both sit in the same element.
    const line = credit.closest("p");
    expect(line).not.toBeNull();
    expect(within(line!).getByRole("button", { name: "Send feedback" })).toBeInTheDocument();
    // A real space, not a flex gap: a gap looks the same and vanishes from
    // textContent, so the credit would copy-paste as "Built byMuhammad Nabil".
    expect(line).toHaveTextContent("Built by Muhammad Nabil");
    expect(credit.parentElement?.textContent).toBe("Built by Muhammad Nabil");
  });

  it("does not announce the separator", () => {
    // Decoration between two elements that are already distinct to a screen
    // reader — reading "middot" aloud adds nothing.
    render(<FeedbackLink />);

    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByText("·")).toHaveAttribute("aria-hidden", "true");
  });

  it("opens a labelled dialog with the three types and both fields", async () => {
    const { dialog } = await open();

    expect(
      within(dialog).getByRole("heading", { name: "Send feedback" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("radio", { name: "Feedback on the analysis" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Bug" })).toBeInTheDocument();
    expect(within(dialog).getByRole("radio", { name: "Suggestion" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Your message")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(EMAIL_LABEL)).toBeInTheDocument();
  });

  it("keeps submit disabled until the message has content", async () => {
    const { user, dialog } = await open();

    const submit = within(dialog).getByRole("button", { name: "Send feedback" });
    expect(submit).toBeDisabled();

    // Whitespace is not content — the server trims before judging, and the
    // button has to agree or it enables for something that will be refused.
    await user.type(within(dialog).getByLabelText("Your message"), "   ");
    expect(submit).toBeDisabled();

    await user.type(within(dialog).getByLabelText("Your message"), "it broke");
    expect(submit).toBeEnabled();
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user, trigger } = await open();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  describe("the payload", () => {
    it("carries the analysis id when opened from a report, without showing it", async () => {
      pathname.current = "/analyze/a1b2c3d4e5f6a7b8";
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Gauge reads 0");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(requestBody().analysisId).toBe("a1b2c3d4e5f6a7b8");
      // Silent: the id is in the payload and nowhere on screen.
      expect(dialog).not.toHaveTextContent("a1b2c3d4e5f6a7b8");
    });

    it("sends a null id from a page that has no analysis", async () => {
      pathname.current = "/dashboard";
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "A thought");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(requestBody().analysisId).toBeNull();
    });

    it("carries the chosen type and the optional address", async () => {
      const { user, dialog } = await open();

      await user.click(within(dialog).getByRole("radio", { name: "Suggestion" }));
      await user.type(within(dialog).getByLabelText("Your message"), "Add dark mode");
      await user.type(within(dialog).getByLabelText(EMAIL_LABEL), "user@example.com");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const body = requestBody();
      expect(body.type).toBe("suggestion");
      expect(body.message).toBe("Add dark mode");
      expect(body.email).toBe("user@example.com");
    });

    it("sends an empty honeypot, because a person cannot reach the field", async () => {
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Hello");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(requestBody()[HONEYPOT_FIELD]).toBe("");
    });

    it("keeps the honeypot out of the accessibility tree and the tab order", async () => {
      // Anyone who can reach it can have their message silently discarded, so
      // it must be unreachable by keyboard and invisible to a screen reader
      // while staying visible to a parser.
      const { dialog } = await open();

      // `queryByRole` rather than `queryByLabelText`: only the role queries
      // respect `aria-hidden`, and the accessibility tree is exactly what is
      // being asserted about here.
      expect(
        within(dialog).queryByRole("textbox", { name: "Website" }),
      ).not.toBeInTheDocument();

      const honeypot = dialog.querySelector(`input[name="${HONEYPOT_FIELD}"]`);
      expect(honeypot).not.toBeNull();
      expect(honeypot).toHaveAttribute("tabindex", "-1");
      expect(honeypot!.closest("[aria-hidden='true']")).not.toBeNull();
    });
  });

  describe("submitting", () => {
    it("disables the button and says so while the request is in flight", async () => {
      let release: (value: unknown) => void = () => {};
      fetchMock.mockReturnValue(new Promise((resolve) => (release = resolve)));

      const { user, dialog } = await open();
      await user.type(within(dialog).getByLabelText("Your message"), "Slow one");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      const sending = await within(dialog).findByRole("button", { name: /Sending/ });
      expect(sending).toBeDisabled();

      release(sent());
      await within(dialog).findByText(/been sent/);
    });

    it("confirms only after the server said it was sent", async () => {
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "It worked");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      expect(await within(dialog).findByText(/been sent/)).toBeInTheDocument();
      // The form is gone, replaced by the confirmation.
      expect(within(dialog).queryByLabelText("Your message")).not.toBeInTheDocument();
      // And nothing closed it — the reader does that.
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("names the address a reply would go to", async () => {
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Question");
      await user.type(within(dialog).getByLabelText(EMAIL_LABEL), "user@example.com");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      expect(await within(dialog).findByText(/user@example.com/)).toBeInTheDocument();
    });

    it("says no reply is coming when no address was given", async () => {
      // Better than implying one might arrive. The form asked, they declined.
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "No reply needed");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      expect(await within(dialog).findByText(/no reply coming/)).toBeInTheDocument();
    });
  });

  describe("when it fails", () => {
    it("keeps what was typed, shows the reason, and allows a retry", async () => {
      fetchMock.mockResolvedValue(refused("FEEDBACK_SEND_FAILED"));
      const { user, dialog } = await open();

      const message = within(dialog).getByLabelText("Your message");
      await user.type(message, "Please do not lose this");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      const alert = await within(dialog).findByRole("alert");
      expect(alert).toHaveTextContent(ERROR_COPY.FEEDBACK_SEND_FAILED.message);

      // The one thing that must never happen on a failure.
      expect(message).toHaveValue("Please do not lose this");
      expect(within(dialog).getByRole("button", { name: "Send feedback" })).toBeEnabled();

      fetchMock.mockResolvedValue(sent());
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));
      expect(await within(dialog).findByText(/been sent/)).toBeInTheDocument();
    });

    it("reports a dropped connection as a failure to send, not as success", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      const { user, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Offline");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));

      expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        ERROR_COPY.FEEDBACK_SEND_FAILED.message,
      );
      expect(within(dialog).queryByText(/been sent/)).not.toBeInTheDocument();
    });

    it("keeps the draft when the modal is closed and reopened", async () => {
      // Escape is easy to hit by accident, and Radix unmounts the content —
      // losing five minutes of writing to a stray key is the same loss whether
      // a modal caused it or a crash did.
      const { user, trigger, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Half written");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(trigger);
      const reopened = await screen.findByRole("dialog");
      expect(within(reopened).getByLabelText("Your message")).toHaveValue("Half written");
    });

    it("starts clean after a message that did send", async () => {
      const { user, trigger, dialog } = await open();

      await user.type(within(dialog).getByLabelText("Your message"), "Sent and done");
      await user.click(within(dialog).getByRole("button", { name: "Send feedback" }));
      await within(dialog).findByText(/been sent/);

      await user.click(within(dialog).getByRole("button", { name: "Done" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

      await user.click(trigger);
      const reopened = await screen.findByRole("dialog");
      expect(within(reopened).getByLabelText("Your message")).toHaveValue("");
    });
  });
});
