import "server-only";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

import { PrismaClient } from "@/lib/generated/prisma/client";
import { getEnv } from "@/lib/env";

/**
 * Database access for Phase 7's resume history.
 *
 * Everything here is optional by design. The app's core promise is that it
 * runs on a fresh clone with no infrastructure, so the database is a feature
 * you switch on (`PERSISTENCE=db`) rather than a dependency you must satisfy.
 * Every call goes through `withDb`, which returns a fallback instead of
 * throwing — a stopped database costs the user their cross-tab history, never
 * the analysis they just waited for.
 *
 * Prisma 7 connects through a driver adapter rather than a bundled engine, so
 * moving to Postgres is a change of adapter and datasource provider here and
 * in `prisma/schema.prisma` — no change to any caller.
 */

/**
 * Cached on `globalThis` because Next's dev server re-evaluates modules on
 * every hot reload; without this each edit would open another SQLite handle
 * until the process ran out of them.
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const url = getEnv().DATABASE_URL ?? "file:./prisma/dev.db";
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = createClient();
  return globalForPrisma.prisma;
}

/** True when the deployment asked for database-backed history. */
export function isDatabaseEnabled(): boolean {
  return getEnv().PERSISTENCE === "db";
}

/**
 * Runs a database operation, returning `fallback` if anything at all goes
 * wrong — including the database being switched off entirely.
 *
 * Swallowing errors is usually a mistake, so it is worth being explicit about
 * why it is right here: the caller is an API route whose failure mode is
 * already covered by the client falling back to session storage. What this
 * prevents is a database outage turning into a 500 on a page that had a
 * perfectly good answer to show. The error is always logged, never silent.
 */
export async function withDb<T>(
  operation: string,
  run: (prisma: PrismaClient) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (!isDatabaseEnabled()) return fallback;

  try {
    return await run(getPrisma());
  } catch (cause) {
    console.error(
      `[db] ${operation} failed, degrading to session-only:`,
      cause instanceof Error ? cause.message : cause,
    );
    return fallback;
  }
}
