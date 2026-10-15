import { describe, expect, it, vi } from "vitest";

import { AiSchemaError, AiUnavailableError } from "@/lib/errors";
import { withTransportRetry } from "./helpers";

/**
 * The live suites' retry, checked offline: it must forgive one dropped call
 * and nothing else, because a schema failure is a measurement.
 */
describe("withTransportRetry", () => {
  it("retries once after a dropped call and reports the drop", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(new AiUnavailableError())
      .mockResolvedValueOnce("scored");
    const onDrop = vi.fn();

    await expect(withTransportRetry(call, onDrop)).resolves.toBe("scored");
    expect(call).toHaveBeenCalledTimes(2);
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("gives up after a second drop", async () => {
    const call = vi.fn().mockRejectedValue(new AiUnavailableError());

    await expect(withTransportRetry(call, vi.fn())).rejects.toBeInstanceOf(AiUnavailableError);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("never retries a schema failure", async () => {
    const call = vi.fn().mockRejectedValue(new AiSchemaError());
    const onDrop = vi.fn();

    await expect(withTransportRetry(call, onDrop)).rejects.toBeInstanceOf(AiSchemaError);
    expect(call).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
