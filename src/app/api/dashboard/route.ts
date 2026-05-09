import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/dashboard — top-of-page activity counters + recent searches.
 *
 * Anonymous callers get all-zero counters and a `signedIn:false` flag so the
 * dashboard renders without errors but tells the user to sign in for real
 * stats.
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
      recentSearches: [],
    });
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [
    searchesToday,
    savedAssets,
    exportsMade,
    trackedContributors,
    importedDatasets,
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
    prisma.importedDataset.count({ where: { userId, archived: false } }),
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
    hasImportedData: importedDatasets > 0,
    searchesToday,
    savedAssets,
    exportsMade,
    trackedContributors,
    recentSearches,
  });
}
