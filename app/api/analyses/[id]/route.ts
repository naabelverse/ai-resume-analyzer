import { withDb } from "@/lib/db";
import type { AnalysisRecord } from "@/types";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/analyses/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;

  const record = await withDb<AnalysisRecord | null>(
    "load",
    async (prisma) => {
      const row = await prisma.analysis.findUnique({ where: { id } });
      if (!row) return null;

      return {
        id: row.id,
        fileName: row.fileName,
        createdAt: row.createdAt.toISOString(),
        data: JSON.parse(row.result) as AnalysisRecord["data"],
        meta: JSON.parse(row.meta) as AnalysisRecord["meta"],
      };
    },
    null,
  );

  return Response.json({ record });
}

export async function DELETE(
  _request: Request,
  ctx: RouteContext<"/api/analyses/[id]">,
): Promise<Response> {
  const { id } = await ctx.params;

  const deleted = await withDb(
    "delete",
    async (prisma) => {
      // deleteMany rather than delete: removing something already gone is the
      // outcome the caller wanted, not an error worth reporting.
      await prisma.analysis.deleteMany({ where: { id } });
      return true;
    },
    false,
  );

  return Response.json({ ok: deleted });
}
