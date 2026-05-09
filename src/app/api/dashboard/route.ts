import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDatasetScope, scopedDatasetIds } from "@/lib/dataset-scope";

/**
 * GET /api/dashboard — top-of-page activity counters + recent searches.
 *
 * The imported-asset counter respects the user's dataset scope, so the
 * dashboard number matches what they'll see in Search / Portfolio / etc.
 * Everything else (saved, exports, tracked contributors) is account-wide
 * regardless of scope — that matches the heuristic "my activity across
 * the whole app", not "my activity against this dataset".
 *
 * Anonymous callers get all-zero counters and a `signedIn:false` flag so
 * the dashboard renders without errors but tells the user to sign in for
 * real stats.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({
      signedIn: false,
      hasImportedData: false,
      searchesToday: 0,
      savedAssets: 0,
      exportsMade: 0,
      trackedContributors: 0,
      importedAssets: 0,
      datasetScope: { kind: "demo" },
      datasetName: null,
      scopeReason: "guest",
      recentSearches: [],
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const scopeInfo = await resolveDatasetScope(userId);

  // Count imported assets within the current dataset scope. "demo" scope
  // -> 0 (even if the user has datasets, they asked to see demo data).
  // Any other scope -> sum of matching assets. Ownership is guaranteed
  // because scopedDatasetIds filters on userId.
  let importedAssets = 0;
  if (scopeInfo.scope.kind !== "demo") {
    const datasetIds = await scopedDatasetIds(userId, scopeInfo.scope);
    if (datasetIds.length > 0) {
      importedAssets = await prisma.importedAsset.count({
        where: { datasetId: { in: datasetIds } },
      });
    }
  }

  const [
    searchesToday,
    savedAssets,
    exportsMade,
    trackedContributors,
    recentSearches,
  ] = await Promise.all([
    prisma.searchHistory.count({
      where: { userId, createdAt: { gte: startOfToday } },
    }),
    prisma.favorite.count({ where: { userId } }),
    prisma.exportHistory.count({ where: { userId } }),
    // "Tracked contributors" approximated as distinct contributors among
    // the user's saved assets. Not authoritative, just a useful counter.
    prisma.favorite
      .findMany({
        where: { userId, contributorName: { not: null } },
        select: { contributorName: true },
        distinct: ["contributorName"],
      })
      .then((rows) => rows.length),
    prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        keyword: true,
        sort: true,
        contentType: true,
        aiFilter: true,
        resultCount: true,
        createdAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    signedIn: true,
    hasImportedData: scopeInfo.hasAnyDatasets,
    searchesToday,
    savedAssets,
    exportsMade,
    trackedContributors,
    importedAssets,
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    recentSearches,
  });
}
