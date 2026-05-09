import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/export/history — list the current user's recent exports.
 *
 * Returns at most 100 rows. Sorted newest-first. Each row includes the
 * dataset-scope tag captured at export time plus (when applicable) the
 * resolved dataset name so the UI can render "Dataset: Q3 2025" even if
 * the dataset is later renamed.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ exports: [] });
  }
  const exports = await prisma.exportHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      query: true,
      rowCount: true,
      dataQuality: true,
      providerName: true,
      datasetScope: true,
      datasetId: true,
      paramsJson: true,
      createdAt: true,
    },
  });

  // Resolve dataset names for the subset that reference a still-existing
  // dataset owned by this user. Archived datasets are still resolvable so
  // the history row stays useful; hard-deleted ones will just show
  // "(deleted)".
  const ids = Array.from(
    new Set(
      exports
        .map((e) => e.datasetId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  const nameLookup: Record<string, { name: string; archived: boolean }> = {};
  if (ids.length > 0) {
    const rows = await prisma.importedDataset.findMany({
      where: { id: { in: ids }, userId: session.user.id },
      select: { id: true, name: true, archived: true },
    });
    for (const r of rows) {
      nameLookup[r.id] = { name: r.name, archived: r.archived };
    }
  }

  return NextResponse.json({
    exports: exports.map((e) => ({
      id: e.id,
      type: e.type,
      query: e.query,
      rowCount: e.rowCount,
      dataQuality: e.dataQuality,
      providerName: e.providerName,
      datasetScope: e.datasetScope,
      datasetId: e.datasetId,
      // "null" when the dataset was hard-deleted, leaving only the audit
      // trail behind. "archived: true" when the user archived it.
      datasetName: e.datasetId ? (nameLookup[e.datasetId]?.name ?? null) : null,
      datasetArchived: e.datasetId
        ? (nameLookup[e.datasetId]?.archived ?? null)
        : null,
      createdAt: e.createdAt,
    })),
  });
}
