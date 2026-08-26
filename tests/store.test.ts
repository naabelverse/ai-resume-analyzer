// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { sessionStore } from "@/lib/store/session";
import { validResult } from "./helpers";
import type { AnalysisRecord } from "@/types";

function record(id: string, overrides: Partial<AnalysisRecord> = {}): AnalysisRecord {
  return {
    id,
    fileName: `${id}.pdf`,
    createdAt: "2026-08-19T10:00:00.000Z",
    data: validResult(),
    meta: {
      degraded: false,
      degradedReason: null,
      truncated: false,
      timings: {},
      pageCount: 1,
      wordCount: 400,
    },
    ...overrides,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("sessionStore", () => {
  it("round-trips a saved analysis", async () => {
    await sessionStore.save(record("abc"));
    const loaded = await sessionStore.load("abc");

    expect(loaded?.fileName).toBe("abc.pdf");
    expect(loaded?.data.overallScore).toBe(72);
  });

  it("survives a page refresh, which sessionStorage guarantees within a tab", async () => {
    await sessionStore.save(record("abc"));
    // A refresh re-imports the module but keeps sessionStorage; reading again
    // through a fresh call is the closest honest simulation.
    expect(await sessionStore.load("abc")).not.toBeNull();
  });

  it("returns null for an unknown id instead of throwing", async () => {
    expect(await sessionStore.load("nope")).toBeNull();
  });

  it("returns null for a corrupted entry rather than crashing the page", async () => {
    window.sessionStorage.setItem("ara:analysis:broken", "{not json");
    expect(await sessionStore.load("broken")).toBeNull();
  });

  it("lists saved analyses newest first", async () => {
    await sessionStore.save(record("one"));
    await sessionStore.save(record("two"));

    expect((await sessionStore.list()).map((entry) => entry.id)).toEqual(["two", "one"]);
  });

  it("does not duplicate an id that is saved twice", async () => {
    await sessionStore.save(record("one"));
    await sessionStore.save(record("one", { fileName: "renamed.pdf" }));

    const listed = await sessionStore.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.fileName).toBe("renamed.pdf");
  });

  it("removes an analysis from both the entry and the index", async () => {
    await sessionStore.save(record("one"));
    await sessionStore.remove("one");

    expect(await sessionStore.load("one")).toBeNull();
    expect(await sessionStore.list()).toEqual([]);
  });

  it("summarises entries with the score, for the dashboard list", async () => {
    await sessionStore.save(record("one"));

    expect((await sessionStore.list())[0]).toEqual({
      id: "one",
      fileName: "one.pdf",
      createdAt: "2026-08-19T10:00:00.000Z",
      overallScore: 72,
      degraded: false,
    });
  });

  /*
    The index is a CACHE of the records beside it, not a second source, and the
    dashboard now withholds the score for a degraded run. So an entry written
    before `degraded` existed must not read as a healthy one — it resolves from
    the record, which has carried the flag all along.

    Set up by editing storage directly rather than through `save`, because
    `save` is exactly what can no longer produce this shape. The only way to
    hold a stale index entry is to have written it before the field existed,
    which is the state real browsers are in right now.
  */
  it("backfills degraded from the record for an index entry that predates it", async () => {
    const stored = record("two");
    stored.meta.degraded = true;
    await sessionStore.save(stored);

    const index = JSON.parse(
      window.sessionStorage.getItem("ara:index")!,
    ) as Record<string, unknown>[];
    delete index[0]!.degraded;
    window.sessionStorage.setItem("ara:index", JSON.stringify(index));

    expect((await sessionStore.list())[0]!.degraded).toBe(true);
  });

  /*
    Unknown stays unknown. Defaulting a missing flag to `false` would put a
    bare score back on the dashboard for the one kind of run that must not
    carry one — the failure this whole field exists to prevent, arriving
    through the back door.
  */
  it("reports degraded as unknown when the record is gone, never as healthy", async () => {
    await sessionStore.save(record("three"));

    const index = JSON.parse(
      window.sessionStorage.getItem("ara:index")!,
    ) as Record<string, unknown>[];
    delete index[0]!.degraded;
    window.sessionStorage.setItem("ara:index", JSON.stringify(index));
    window.sessionStorage.removeItem("ara:analysis:three");

    expect((await sessionStore.list())[0]!.degraded).toBeUndefined();
  });
});
