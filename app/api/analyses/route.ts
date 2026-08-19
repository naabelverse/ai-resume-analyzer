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

export async function GET(): Promise<Response> {
  const records = await withDb<AnalysisSummary[]>(
    "list",
    async (prisma) => {
      const rows = await prisma.analysis.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, fileName: true, score: true, createdAt: true },
      });

      return rows.map((row) => ({
        id: row.id,
        fileName: row.fileName,
        createdAt: row.createdAt.toISOString(),
        overallScore: row.score,
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
