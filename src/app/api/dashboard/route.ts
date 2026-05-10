import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDatasetScope, scopedDatasetIds } from "@/lib/dataset-scope";
import { runDashboard } from "@/lib/providers";
import {
  ProviderNoDataError,
  ProviderRequiresUserError,
} from "@/lib/providers/types";
import { parseJsonArray } from "@/lib/utils";

/**
 * GET /api/dashboard — provider-aware dashboard analytics + account-wide
 * activity counters.
 *
 * The response is split into three concerns:
 *
 *   1. **Activity counters** (account-wide, DB-backed) — searchesToday,
 *      savedAssets, exportsMade, trackedContributors, importedAssets.
 *      These never depend on which provider answered; they are always a
 *      truthful read of the user's own database rows. The `importedAssets`
 *      counter respects the active dataset scope so the figure matches
 *      what they'll see in Search / Portfolio / etc.
 *
 *   2. **Analytics rollup** (provider-derived) — totalDownloads,
 *      averagePerformanceScore, contentBreakdown, topPerformers,
 *      keywordHighlights, trendingKeywords. These come from
 *      `runDashboard()`, which honors the active dataset scope and falls
 *      back to mock when the chosen provider can't fulfill the request.
 *      Each metric carries an `*Available` companion so the UI can render
 *      `Unavailable` instead of fake zeros (e.g. official public-metadata
 *      source has no verified download counts).
 *
 *   3. **Activity feeds** — recentSearches (persisted history) and
 *      savedAssetsPreview (latest favorites). Both DB-backed; the saved
 *      preview includes a per-row data-quality tag so the UI can label
 *      saved-from-demo rows distinctly from saved-from-import rows.
 *
 * Anonymous callers receive zero counters + a demo provider envelope and
 * a `signedIn:false` flag so the dashboard renders without errors but
 * honestly tells the user to sign in for real stats.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    // Anonymous: still call the mock provider so the UI gets the same
    // analytics envelope shape (just labeled `Demo Data`). Skipping the
    // provider call would force the page to render two different shapes
    // and add a special-case branch we don't actually need.
    const analytics = await runDashboard();
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
      savedAssetsPreview: [],
      analytics,
      provider: {
        id: analytics.providerId ?? "mock",
        name: analytics.providerName,
        dataQuality: analytics.dataQuality,
        capabilities: analytics.capabilities,
        notice: analytics.notice,
      },
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

  const ctx = { userId, datasetScope: scopeInfo.scope };

  // PR #23: runDashboard may throw ProviderNoDataError for signed-in
  // users with no imported data (and not in demo mode). We catch that
  // and produce an honest empty analytics envelope rather than silently
  // substituting mock data.
  let analytics;
  try {
    analytics = await runDashboard(ctx);
  } catch (err) {
    if (
      err instanceof ProviderNoDataError ||
      err instanceof ProviderRequiresUserError
    ) {
      analytics = {
        importedAssets: 0,
        importedAssetsAvailable: false,
        totalDownloads: 0,
        totalDownloadsAvailable: false,
        averagePerformanceScore: 0,
        averagePerformanceScoreAvailable: false,
        contentBreakdown: [],
        contentBreakdownAvailable: false,
        topPerformers: [],
        topPerformersAvailable: false,
        keywordHighlights: [],
        keywordHighlightsAvailable: false,
        trendingKeywords: [],
        trendingKeywordsAvailable: false,
        dataQuality: "demo" as const,
        providerName: "No data source",
        providerId: "none",
        capabilities: null,
        notice:
          "No data source is configured. Import a CSV, configure the public metadata provider, or switch to demo mode.",
        noDataConfigured: true,
      };
    } else {
      throw err;
    }
  }

  const [
    searchesToday,
    savedAssets,
    exportsMade,
    trackedContributors,
    recentSearches,
    savedAssetsPreviewRows,
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
    prisma.favorite.findMany({
      where: { userId },
      orderBy: { savedAt: "desc" },
      take: 6,
      select: {
        id: true,
        assetId: true,
        thumbnailUrl: true,
        title: true,
        contributorName: true,
        downloads: true,
        performanceScore: true,
        savedAt: true,
        keywordsJson: true,
        // Track-changes snapshot. When present, the dashboard preview
        // badge reflects the tier of the most recent refresh instead of
        // the active provider's default — a manual-imported saved row
        // remains `Verified` even if the user flipped to mock since.
        lastCheckedDataQuality: true,
        lastCheckedProviderId: true,
      },
    }),
  ]);

  // Saved-asset preview is "what the user saved", not "what the active
  // provider says". To stay honest, we prefer each favorite's most
  // recent tracked data-quality (populated by `/api/saved/track`).
  // Falling back to the active provider's quality keeps the UI
  // consistent for rows that haven't been refreshed yet; that fallback
  // never upgrades the row — a demo-era save stays tagged `Demo Data`
  // when the current provider is also demo, and only moves up once the
  // user explicitly refreshes with a matching imported row.
  const savedAssetsPreview = savedAssetsPreviewRows.map((f) => {
    const dq =
      (f.lastCheckedDataQuality as typeof analytics.dataQuality | null) ??
      analytics.dataQuality;
    const providerName =
      f.lastCheckedProviderId === "manual"
        ? "User imported data"
        : analytics.providerName;
    return {
      id: f.id,
      assetId: f.assetId,
      thumbnailUrl: f.thumbnailUrl,
      title: f.title,
      contributorName: f.contributorName,
      downloads: f.downloads,
      performanceScore: f.performanceScore,
      keywords: parseJsonArray<string>(f.keywordsJson),
      savedAt: f.savedAt,
      dataQuality: dq,
      providerName,
    };
  });

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
    savedAssetsPreview,
    analytics,
    provider: {
      id: analytics.providerId ?? "mock",
      name: analytics.providerName,
      dataQuality: analytics.dataQuality,
      capabilities: analytics.capabilities,
      notice: analytics.notice,
    },
  });
}
