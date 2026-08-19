import type { AnalysisRecord, AnalysisSummary } from "@/types";
import { sessionStore } from "./session";
import type { AnalysisStore } from "./types";

/**
 * Database-backed store, reached over the API routes in `app/api/analyses/`.
 *
 * Every method falls back to `sessionStore` when the request fails. That is
 * the point of this file: a stopped database degrades the app to session-only
 * behaviour instead of breaking it. The user loses history across tabs, which
 * is a feature they may not have noticed they had — not the analysis they just
 * waited thirty seconds for.
 *
 * Writes go to both stores. If the database is up, session is a harmless
 * duplicate; if it is down, session is the only copy, and the read path finds
 * it there.
 */

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function warn(operation: string, cause: unknown): void {
  console.warn(
    `[store] database ${operation} failed, using session storage:`,
    cause instanceof Error ? cause.message : cause,
  );
}

export const remoteStore: AnalysisStore = {
  async save(record) {
    await sessionStore.save(record);

    try {
      await json(
        await fetch("/api/analyses", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(record),
        }),
      );
    } catch (cause) {
      warn("save", cause);
    }
  },

  async load(id) {
    try {
      const { record } = await json<{ record: AnalysisRecord | null }>(
        await fetch(`/api/analyses/${encodeURIComponent(id)}`),
      );
      if (record) return record;
    } catch (cause) {
      warn("load", cause);
    }

    return sessionStore.load(id);
  },

  async remove(id) {
    await sessionStore.remove(id);

    try {
      await json(
        await fetch(`/api/analyses/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
    } catch (cause) {
      warn("remove", cause);
    }
  },

  async list() {
    try {
      const { records } = await json<{ records: AnalysisSummary[] }>(
        await fetch("/api/analyses"),
      );
      return records;
    } catch (cause) {
      warn("list", cause);
      return sessionStore.list();
    }
  },
};
