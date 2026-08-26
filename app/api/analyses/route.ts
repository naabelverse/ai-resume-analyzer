import { withDb } from "@/lib/db";
import { AnalysisResultSchema } from "@/lib/schema/analysis";
import type { AnalysisRecord, AnalysisSummary } from "@/types";
import { z } from "zod";

/**
 * The history collection. Both handlers degrade rather than fail: `withDb`
 * returns the fallback when the database is off or unreachable, and the
 * client's remote store then falls back to session storage on its side.
 */

const RecordSchema = z.object({
  id: z.string().min(1).max(64),
  fileName: z.string().min(1).max(255),
  createdAt: z.iso.datetime(),
  data: AnalysisResultSchema,
  meta: z.looseObject({}),
});

/**
 * Reads `degraded` out of a stored `meta` blob.
 *
 * Yields `undefined` rather than `false` when the column will not parse or
 * carries no boolean there. "We could not tell" and "the AI ran fine" are
 * different claims, and only one of them is safe to make by accident — this
 * whole field exists to stop a failed run reading as a healthy one.
 */
function degradedFrom(meta: string): boolean | undefined {
  try {
    const parsed: unknown = JSON.parse(meta);
    const value =
      parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>).degraded
        : undefined;
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function GET(): Promise<Response> {
  const records = await withDb<AnalysisSummary[]>(
    "list",
    async (prisma) => {
      /*
        `meta` is selected for exactly one field — `degraded` — so the
        dashboard can stop showing a bare score for a run whose AI portion
        failed.

        No migration and no new column, which is what made this cheap. `meta`
        has held the serialised `AnalysisMeta` since the table existed and
        `degraded` has been in it the whole time; the list query simply never
        asked. Every row already written answers correctly.
      */
      const rows = await prisma.analysis.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          fileName: true,
          score: true,
          createdAt: true,
          meta: true,
        },
      });

      return rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        createdAt: row.createdAt.toISOString(),
        overallScore: row.score,
        degraded: degradedFrom(row.meta),
      }));
    },
    [],
  );

  return Response.json({ records });
}

export async function POST(request: Request): Promise<Response> {
  // The body arrives from the browser, so it is untrusted: validate against
  // the same schema the model output was held to before any of it is stored.
  const parsed = RecordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false }, { status: 400 });
  }

  const record = parsed.data as unknown as AnalysisRecord;

  const saved = await withDb(
    "save",
    async (prisma) => {
      await prisma.analysis.upsert({
        where: { id: record.id },
        create: {
          id: record.id,
          fileName: record.fileName,
          score: record.data.overallScore,
          createdAt: new Date(record.createdAt),
          result: JSON.stringify(record.data),
          meta: JSON.stringify(record.meta),
        },
        update: {
          result: JSON.stringify(record.data),
          meta: JSON.stringify(record.meta),
        },
      });
      return true;
    },
    false,
  );

  return Response.json({ ok: saved });
}
