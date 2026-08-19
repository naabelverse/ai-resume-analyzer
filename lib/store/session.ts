import type { AnalysisRecord, AnalysisSummary } from "@/types";
import type { AnalysisStore } from "./types";

/**
 * sessionStorage-backed store: no database, no network, survives a refresh,
 * and is gone when the tab closes. That last part is a feature for a tool that
 * handles resumes — nothing outlives the visit unless the user opts into the
 * database mode.
 */

const PREFIX = "ara:analysis:";
const INDEX_KEY = "ara:index";

/** Server render and any browser with storage disabled both land here. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

function readIndex(store: Storage): AnalysisSummary[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as AnalysisSummary[]) : [];
  } catch {
    return [];
  }
}

export const sessionStore: AnalysisStore = {
  async save(record) {
    const store = storage();
    if (!store) return;

    store.setItem(PREFIX + record.id, JSON.stringify(record));

    const summary: AnalysisSummary = {
      id: record.id,
      fileName: record.fileName,
      createdAt: record.createdAt,
      overallScore: record.data.overallScore,
    };
    const index = [
      summary,
      ...readIndex(store).filter((entry) => entry.id !== record.id),
    ];
    store.setItem(INDEX_KEY, JSON.stringify(index));
  },

  async load(id) {
    const store = storage();
    if (!store) return null;

    try {
      const raw = store.getItem(PREFIX + id);
      return raw ? (JSON.parse(raw) as AnalysisRecord) : null;
    } catch {
      // A corrupt entry is indistinguishable from a missing one to the caller,
      // and both want the same UI: "we couldn't find that analysis".
      return null;
    }
  },

  async remove(id) {
    const store = storage();
    if (!store) return;

    store.removeItem(PREFIX + id);
    store.setItem(
      INDEX_KEY,
      JSON.stringify(readIndex(store).filter((entry) => entry.id !== id)),
    );
  },

  async list() {
    const store = storage();
    return store ? readIndex(store) : [];
  },
};
