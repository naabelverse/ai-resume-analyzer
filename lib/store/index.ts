import { remoteStore } from "./remote";
import { sessionStore } from "./session";
import type { AnalysisStore } from "./types";

export type { AnalysisStore } from "./types";
export { sessionStore } from "./session";

/**
 * The flag is `NEXT_PUBLIC_` because this choice is made in the browser. A
 * server-only variable would read as `undefined` here and silently pin every
 * user to session mode no matter what the deployment was configured for —
 * a bug that looks exactly like "the database feature doesn't work".
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so it has to be
 * written out in full rather than looked up dynamically.
 */
export const persistenceMode: "session" | "db" =
  process.env.NEXT_PUBLIC_PERSISTENCE === "db" ? "db" : "session";

export const store: AnalysisStore =
  persistenceMode === "db" ? remoteStore : sessionStore;

/**
 * Short, URL-safe, unguessable enough that a shared link is not trivially
 * enumerable. `crypto.randomUUID` is available in every browser this app
 * targets and in Node 24.
 */
export function newAnalysisId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 16);
}
