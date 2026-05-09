import { prisma } from "@/lib/prisma";
import {
  calculateCompetitionLevel,
  calculateDownloadsPerMonth,
  calculatePerformanceScore,
} from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import type { SearchAsset } from "@/types/search";
import type { DatasetScope } from "@/lib/dataset-scope";
import {
  ProviderNoDataError,
  ProviderRequiresUserError,
} from "./types";
import type {
  DataProvider,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderTrendingResult,
} from "./types";

const PROVIDER_ID = "manual";
const PROVIDER_NAME = "User imported data";

interface ImportedAssetRow {
  id: string;
  externalId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  downloads: number | null;
  performanceScore: number | null;
  downloadsPerMonth: number | null;
  contentType: string | null;
  categoriesJson: string;
  uploadDate: Date | null;
  contributorName: string | null;
  contributorId: string | null;
  isPremium: boolean;
  isAiGenerated: boolean;
  keywordsJson: string;
  adobeStockUrl: string | null;
}

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Hydrate a stored ImportedAsset into a SearchAsset for the UI.
 *
 * Fields the user did NOT upload are filled with safe defaults so the UI
 * doesn't crash, but they are NOT fabricated to look like real numbers
 * (downloads → 0, performanceScore → 0 when truly unknown). The caller is
 * responsible for tagging the result with the right `dataQuality`.
 */
function toSearchAsset(row: ImportedAssetRow): SearchAsset {
  const uploadDate = row.uploadDate ?? new Date(0);
  const downloads = row.downloads ?? 0;
  // If the user supplied performanceScore, trust it. Otherwise estimate from
  // downloads + uploadDate when we have both; otherwise 0.
  let perfScore = row.performanceScore ?? 0;
  if (row.performanceScore == null && row.downloads != null && row.uploadDate) {
    perfScore = calculatePerformanceScore(downloads, uploadDate);
  }
  let dpm = row.downloadsPerMonth ?? 0;
  if (
    row.downloadsPerMonth == null &&
    row.downloads != null &&
    row.uploadDate
  ) {
    dpm = calculateDownloadsPerMonth(downloads, uploadDate);
  }
  return {
    id: row.externalId || row.id,
    thumbnailUrl: row.thumbnailUrl || "",
    title: row.title || "(untitled)",
    downloads,
    performanceScore: perfScore,
    downloadsPerMonth: dpm,
    categories: parseJsonArray(row.categoriesJson),
    contentType: row.contentType || "unknown",
    uploadDate: uploadDate.toISOString(),
    contributorName: row.contributorName || "(unknown contributor)",
    contributorId: row.contributorId || "",
    isPremium: row.isPremium,
    isAiGenerated: row.isAiGenerated,
    keywords: parseJsonArray(row.keywordsJson),
    adobeStockUrl: row.adobeStockUrl || "",
  };
}

async function loadUserAssets(
  userId: string,
  scope?: DatasetScope,
): Promise<ImportedAssetRow[]> {
  // Ownership check is belt-and-braces: even if the caller forgot to
  // resolve scope, we only ever look at datasets that belong to this user
  // and aren't archived. One dev mistake can't leak another user's data.
  let datasetIds: string[];
  if (scope?.kind === "specific") {
    const owned = await prisma.importedDataset.findFirst({
      where: {
        id: scope.datasetId,
        userId,
        archived: false,
      },
      select: { id: true },
    });
    if (!owned) {
      // Specific dataset no longer accessible to this user. Treat as
      // "no data" so the caller falls back to mock via runProvider(),
      // rather than silently broadening to all datasets (that would
      // surprise a user who had explicitly picked one).
      throw new ProviderNoDataError(
        PROVIDER_ID,
        "selected dataset is no longer available",
      );
    }
    datasetIds = [owned.id];
  } else {
    const owned = await prisma.importedDataset.findMany({
      where: { userId, archived: false },
      select: { id: true },
    });
    datasetIds = owned.map((d) => d.id);
  }
  if (datasetIds.length === 0) return [];
  return prisma.importedAsset.findMany({
    where: { datasetId: { in: datasetIds } },
    orderBy: { createdAt: "desc" },
  });
}

function matchesKeyword(asset: SearchAsset, keyword: string): boolean {
  if (!keyword) return true;
  const k = keyword.toLowerCase();
  if (asset.title.toLowerCase().includes(k)) return true;
  if (asset.keywords.some((kw) => kw.toLowerCase().includes(k))) return true;
  if (asset.categories.some((c) => c.toLowerCase().includes(k))) return true;
  if (asset.contentType.toLowerCase().includes(k)) return true;
  if (asset.contributorName.toLowerCase().includes(k)) return true;
  return false;
}

function applyFilters(
  results: SearchAsset[],
  req: ProviderSearchRequest,
): SearchAsset[] {
  let out = results;
  if (req.contentType && req.contentType !== "all") {
    out = out.filter((r) => r.contentType === req.contentType);
  }
  if (req.aiFilter === "ai_only") out = out.filter((r) => r.isAiGenerated);
  if (req.aiFilter === "exclude_ai") out = out.filter((r) => !r.isAiGenerated);
  return out;
}

function applySort(
  results: SearchAsset[],
  req: ProviderSearchRequest,
): SearchAsset[] {
  const out = [...results];
  switch (req.sort) {
    case "newest":
      return out.sort(
        (a, b) =>
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
      );
    case "most_downloaded":
      return out.sort((a, b) => b.downloads - a.downloads);
    case "undiscovered":
      return out.sort(
        (a, b) =>
          b.performanceScore - a.performanceScore || a.downloads - b.downloads,
      );
    case "featured":
      return out.sort((a, b) => Number(b.isPremium) - Number(a.isPremium));
    default:
      return out;
  }
}

function aiSaturation(results: SearchAsset[]): number {
  if (!results.length) return 0;
  const ai = results.filter((r) => r.isAiGenerated).length;
  return Math.round((ai / results.length) * 100);
}

function contentBreakdown(
  results: SearchAsset[],
): { type: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.contentType] = (counts[r.contentType] ?? 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export const manualImportProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "verified",

  async search(req, ctx) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0) throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const all = rows.map(toSearchAsset);
    const matched = all.filter((a) => matchesKeyword(a, req.keyword));
    const filtered = applyFilters(matched, req);
    const sorted = applySort(filtered, req);
    const page = req.page ?? 1;
    const start = (page - 1) * RESULTS_PER_PAGE;
    const paged = sorted.slice(start, start + RESULTS_PER_PAGE);
    return {
      totalResults: sorted.length,
      competitionLevel: calculateCompetitionLevel(sorted.length),
      aiSaturation: aiSaturation(sorted),
      contentBreakdown: contentBreakdown(sorted),
      results: paged,
      dataQuality: "verified",
      providerName: PROVIDER_NAME,
    } satisfies ProviderSearchResult;
  },

  async contributor(query, ctx) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0) throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const assets = rows.map(toSearchAsset);
    const q = query.trim().toLowerCase();
    const filtered = q
      ? assets.filter(
          (a) =>
            a.contributorName.toLowerCase().includes(q) ||
            a.contributorId.toLowerCase().includes(q),
        )
      : assets;
    if (filtered.length === 0) {
      throw new ProviderNoDataError(
        PROVIDER_ID,
        `no imported assets match contributor "${query}"`,
      );
    }
    const totalDownloads = filtered.reduce((s, a) => s + a.downloads, 0);
    const best = [...filtered].sort((a, b) => b.downloads - a.downloads)[0];
    const earliest = [...filtered].sort(
      (a, b) =>
        new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime(),
    )[0];
    const breakdownMap = new Map<string, number>();
    for (const a of filtered)
      breakdownMap.set(a.contentType, (breakdownMap.get(a.contentType) ?? 0) + 1);
    const breakdown = Array.from(breakdownMap.entries())
      .map(([type, count]) => ({
        type,
        count,
        pct: Math.round((count / filtered.length) * 100),
      }))
      .sort((a, b) => b.count - a.count);
    const kwFreq = new Map<string, number>();
    for (const a of filtered)
      for (const k of a.keywords) kwFreq.set(k, (kwFreq.get(k) ?? 0) + 1);
    const topKeywords = Array.from(kwFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([keyword, count]) => ({ keyword, count }));
    // Bucket downloads into the last 12 months by uploadDate. This is a
    // best-effort visualization derived from imported data — tag as estimated.
    const months = Array.from({ length: 12 }).map((_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (11 - i));
      return {
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString("en-US", {
          month: "short",
          year: "2-digit",
        }),
      };
    });
    const monthlyTrend = months.map(({ key, label }) => {
      const downloads = filtered
        .filter((a) => {
          const d = new Date(a.uploadDate);
          return `${d.getFullYear()}-${d.getMonth()}` === key;
        })
        .reduce((s, a) => s + a.downloads, 0);
      return { month: label, downloads };
    });
    return {
      name: best.contributorName,
      joinDate: earliest.uploadDate,
      totalAssets: filtered.length,
      totalDownloads,
      avgDownloads: Math.round(totalDownloads / Math.max(1, filtered.length)),
      bestAsset: { id: best.id, title: best.title, downloads: best.downloads },
      contentBreakdown: breakdown,
      topKeywords,
      monthlyTrend,
      assets: filtered,
      dataQuality: "verified",
      providerName: PROVIDER_NAME,
    } satisfies ProviderContributorResult;
  },

  async heatmap(ctx) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0) throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const assets = rows.map(toSearchAsset);
    // Group by keyword. Each keyword tile aggregates downloads + asset count
    // + competition signal. Trend is heuristic: compare last 90d uploads vs
    // the previous 90d.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const byKeyword = new Map<
      string,
      { downloads: number; assets: number; recent: number; prev: number }
    >();
    for (const a of assets) {
      const ts = new Date(a.uploadDate).getTime();
      const isRecent = now - ts <= 90 * day;
      const isPrev = now - ts <= 180 * day && now - ts > 90 * day;
      for (const kw of a.keywords) {
        const key = kw.toLowerCase();
        const cur = byKeyword.get(key) ?? {
          downloads: 0,
          assets: 0,
          recent: 0,
          prev: 0,
        };
        cur.downloads += a.downloads;
        cur.assets += 1;
        if (isRecent) cur.recent += a.downloads;
        if (isPrev) cur.prev += a.downloads;
        byKeyword.set(key, cur);
      }
    }
    if (byKeyword.size === 0) {
      throw new ProviderNoDataError(
        PROVIDER_ID,
        "imported assets have no keywords",
      );
    }
    const niches = Array.from(byKeyword.entries())
      .map(([keyword, v]) => ({
        keyword,
        downloads: v.downloads,
        assets: v.assets,
        // Competition: ratio of total assets vs downloads, normalized 0..100.
        // High asset count + low downloads ⇒ high competition.
        competition: Math.min(
          100,
          Math.round((v.assets / Math.max(1, v.downloads / 100)) * 10),
        ),
        trend: (v.recent > v.prev
          ? "up"
          : v.recent < v.prev
            ? "down"
            : "stable") as "up" | "down" | "stable",
      }))
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 24);
    return {
      niches,
      dataQuality: "verified",
      providerName: PROVIDER_NAME,
    } satisfies ProviderHeatmapResult;
  },

  async trending(ctx) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0) throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const assets = rows.map(toSearchAsset);
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const byKeyword = new Map<
      string,
      { volume: number; recent: number; prev: number }
    >();
    for (const a of assets) {
      const ts = new Date(a.uploadDate).getTime();
      const isRecent = now - ts <= 90 * day;
      const isPrev = now - ts <= 180 * day && now - ts > 90 * day;
      for (const kw of a.keywords) {
        const key = kw.toLowerCase();
        const cur = byKeyword.get(key) ?? { volume: 0, recent: 0, prev: 0 };
        cur.volume += a.downloads;
        if (isRecent) cur.recent += a.downloads;
        if (isPrev) cur.prev += a.downloads;
        byKeyword.set(key, cur);
      }
    }
    if (byKeyword.size === 0) {
      throw new ProviderNoDataError(
        PROVIDER_ID,
        "imported assets have no keywords",
      );
    }
    const trending = Array.from(byKeyword.entries())
      .map(([keyword, v]) => {
        const growth =
          v.prev > 0
            ? Math.round(((v.recent - v.prev) / v.prev) * 100)
            : v.recent > 0
              ? 100
              : 0;
        return { keyword, volume: v.volume, growth };
      })
      .sort((a, b) => b.growth - a.growth || b.volume - a.volume)
      .slice(0, 12);
    return {
      trending,
      dataQuality: "verified",
      providerName: PROVIDER_NAME,
    } satisfies ProviderTrendingResult;
  },
};
