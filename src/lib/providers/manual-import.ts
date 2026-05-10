import { prisma } from "@/lib/prisma";
import {
  calculateCompetitionLevel,
  calculateDownloadsPerMonth,
  calculatePerformanceScore,
} from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import {
  DEFAULT_HEATMAP_FILTERS,
  calculateOpportunityScore,
  contentTypeBreakdown as buildContentTypeBreakdown,
  filterAssetsByPeriod,
  findRelatedKeywords,
  matchesContentType,
  sortNiches,
} from "@/lib/heatmap";
import {
  DEFAULT_TRENDING_FILTERS,
  matchesTrendingContentType,
  seasonalStatus,
  sortTrending,
  trendingPeriodMs,
} from "@/lib/trending";
import type { SearchAsset } from "@/types/search";
import type { DatasetScope } from "@/lib/dataset-scope";
import {
  ProviderNoDataError,
  ProviderRequiresUserError,
} from "./types";
import type {
  DataProvider,
  HeatmapFilters,
  HeatmapTile,
  ProviderCapabilities,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderTrendingResult,
  RisingNiche,
  SeasonalTrend,
  TopPerformer,
  TrendingFilters,
  TrendingKeyword,
} from "./types";

const PROVIDER_ID = "manual";
const PROVIDER_NAME = "User imported data";

const CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  contributor: "supported",
  heatmap: "supported",
  trending: "supported",
  // Manual provider has no per-asset reverse-image index (the user just
  // uploaded a CSV). UI surfaces "Coming Soon" until a future PR wires up
  // perceptual hashing or a remote similar-image API.
  similarImage: "unsupported",
  // The user uploaded these numbers themselves — we trust them as
  // verified-from-import. The UI still shows the data-quality badge so
  // the source is always visible.
  downloadsAvailable: true,
};

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
    // The user uploaded these numbers; treat them as available even if they
    // happen to be zero.
    metricsAvailable: row.downloads != null,
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
  capabilities: CAPABILITIES,

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
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
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
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      providerName: PROVIDER_NAME,
    } satisfies ProviderContributorResult;
  },

  async heatmap(ctx, filters) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0) throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const allAssets = rows.map(toSearchAsset);

    const applied: HeatmapFilters = {
      contentType: filters?.contentType ?? DEFAULT_HEATMAP_FILTERS.contentType,
      period: filters?.period ?? DEFAULT_HEATMAP_FILTERS.period,
      minDownloads:
        filters?.minDownloads ?? DEFAULT_HEATMAP_FILTERS.minDownloads,
      sort: filters?.sort ?? DEFAULT_HEATMAP_FILTERS.sort,
      niche: filters?.niche?.trim() || undefined,
    };

    // Stage 1: cut by period + content type. Anything filtered here
    // doesn't contribute to demand, competition, or trend.
    const periodFiltered = filterAssetsByPeriod(allAssets, applied.period!);
    const filtered = periodFiltered.filter((a) =>
      matchesContentType(a, applied.contentType!),
    );

    if (filtered.length === 0) {
      // Don't fall back to mock — the user has data, just nothing matches.
      // Honest empty result so the UI can render "No matching niches".
      return {
        niches: [],
        appliedFilters: applied,
        dataQuality: "verified",
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        providerName: PROVIDER_NAME,
        notice: "No imported assets match the current heat-map filters.",
      } satisfies ProviderHeatmapResult;
    }

    // Stage 2: group by keyword. We compute trend over a 90/90 split of
    // the *period-filtered* set. For "all time", that becomes "last 90d
    // vs previous 90d" — the same heuristic the original implementation
    // used. For "7d" / "30d", the window auto-shrinks proportionally so
    // a niche that all happened in the last 7 days still produces a
    // sensible trend signal.
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const periodSpanDays =
      applied.period === "7d"
        ? 7
        : applied.period === "30d"
          ? 30
          : applied.period === "90d"
            ? 90
            : applied.period === "1y"
              ? 365
              : 180; // "all" — use 90/90 split (180 day window)
    const halfMs = (periodSpanDays / 2) * day;

    interface NicheAccum {
      keyword: string;
      downloads: number;
      assets: SearchAsset[];
      recent: number;
      prev: number;
      perfSum: number;
      perfCount: number;
      hasRecent: boolean;
      hasPrev: boolean;
    }
    const byKeyword = new Map<string, NicheAccum>();
    for (const a of filtered) {
      const ts = new Date(a.uploadDate).getTime();
      const age = Number.isFinite(ts) ? now - ts : Number.POSITIVE_INFINITY;
      const isRecent = age <= halfMs;
      const isPrev = age <= halfMs * 2 && age > halfMs;
      for (const kw of a.keywords) {
        const key = kw.toLowerCase().trim();
        if (!key) continue;
        const cur = byKeyword.get(key) ?? {
          keyword: key,
          downloads: 0,
          assets: [],
          recent: 0,
          prev: 0,
          perfSum: 0,
          perfCount: 0,
          hasRecent: false,
          hasPrev: false,
        };
        cur.downloads += a.downloads;
        cur.assets.push(a);
        // Only roll an asset's performance score into the niche average
        // when we actually have a non-zero number to average. The CSV
        // importer leaves performanceScore at 0 when the user omits the
        // column AND we couldn't derive it (no downloads or no upload
        // date). Including those zeros depresses the average for niches
        // dominated by minimally-tagged rows; gating on `> 0` keeps
        // imported-but-incomplete data from poisoning the score.
        if (a.performanceScore > 0) {
          cur.perfSum += a.performanceScore;
          cur.perfCount += 1;
        }
        if (isRecent) {
          cur.recent += a.downloads;
          cur.hasRecent = true;
        }
        if (isPrev) {
          cur.prev += a.downloads;
          cur.hasPrev = true;
        }
        byKeyword.set(key, cur);
      }
    }

    if (byKeyword.size === 0) {
      return {
        niches: [],
        appliedFilters: applied,
        dataQuality: "verified",
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        providerName: PROVIDER_NAME,
        notice: "Imported assets have no keywords for the current filters.",
      } satisfies ProviderHeatmapResult;
    }

    // Stage 3: minDownloads threshold + niche cap.
    const thresholded = Array.from(byKeyword.values()).filter(
      (v) => v.downloads >= (applied.minDownloads ?? 0),
    );
    if (thresholded.length === 0) {
      return {
        niches: [],
        appliedFilters: applied,
        dataQuality: "verified",
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        providerName: PROVIDER_NAME,
        notice:
          "No niches meet the minimum-downloads threshold for the current filters.",
      } satisfies ProviderHeatmapResult;
    }

    const maxDownloads = Math.max(...thresholded.map((v) => v.downloads));

    // Stage 4: build tiles. Cap to top 48 by downloads BEFORE applying
    // the requested sort — the heatmap is a viewport, not a paginated
    // list, but the previous top-24 cap was too aggressive for users
    // with broad keyword spreads (small niches got hidden even when
    // they would visibly fit on screen). Top-48 keeps perf reasonable
    // while restoring more of the long tail.
    const top = thresholded
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 48);

    function buildTile(v: NicheAccum): HeatmapTile {
      const competition = Math.min(
        100,
        Math.round((v.assets.length / Math.max(1, v.downloads / 100)) * 10),
      );
      const trendAvailable = v.hasRecent || v.hasPrev;
      const trend: HeatmapTile["trend"] = !trendAvailable
        ? "stable"
        : v.recent > v.prev
          ? "up"
          : v.recent < v.prev
            ? "down"
            : "stable";
      const avgPerformanceScore =
        v.perfCount > 0 ? Math.round(v.perfSum / v.perfCount) : 0;
      const opportunityScore = calculateOpportunityScore({
        downloads: v.downloads,
        competition,
        avgPerformanceScore,
        trend,
        maxDownloads,
      });
      return {
        keyword: v.keyword,
        downloads: v.downloads,
        assets: v.assets.length,
        competition,
        trend,
        opportunityScore,
        avgPerformanceScore,
        contentTypeBreakdown: buildContentTypeBreakdown(v.assets),
        relatedKeywords: [],
        topAssets: [],
        metricsAvailable: true,
        trendAvailable,
      };
    }

    // Niche detail mode: don't bother with the top-24 cap — we need the
    // requested niche specifically, even if it's far down the list.
    if (applied.niche) {
      const target = applied.niche.toLowerCase();
      const accum = byKeyword.get(target);
      if (!accum || accum.downloads < (applied.minDownloads ?? 0)) {
        return {
          niches: [],
          appliedFilters: applied,
          detail: true,
          dataQuality: "verified",
          providerId: PROVIDER_ID,
          capabilities: CAPABILITIES,
          providerName: PROVIDER_NAME,
          notice: `Niche "${applied.niche}" not found in the current filters.`,
        } satisfies ProviderHeatmapResult;
      }
      const tile = buildTile(accum);
      const detailTile: HeatmapTile = {
        ...tile,
        topAssets: [...accum.assets]
          .sort(
            (a, b) =>
              b.downloads - a.downloads ||
              b.performanceScore - a.performanceScore,
          )
          .slice(0, 8),
        relatedKeywords: findRelatedKeywords(filtered, target, 8),
      };
      return {
        niches: [detailTile],
        appliedFilters: applied,
        detail: true,
        dataQuality: "verified",
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        providerName: PROVIDER_NAME,
      } satisfies ProviderHeatmapResult;
    }

    const tiles: HeatmapTile[] = top.map(buildTile);
    return {
      niches: sortNiches(tiles, applied.sort!),
      appliedFilters: applied,
      dataQuality: "verified",
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      providerName: PROVIDER_NAME,
    } satisfies ProviderHeatmapResult;
  },

  async trending(ctx, filters) {
    if (!ctx?.userId) throw new ProviderRequiresUserError(PROVIDER_ID);
    const rows = await loadUserAssets(ctx.userId, ctx.datasetScope);
    if (rows.length === 0)
      throw new ProviderNoDataError(PROVIDER_ID, "no datasets imported");
    const assets = rows.map(toSearchAsset);

    const applied: TrendingFilters = {
      period: filters?.period ?? DEFAULT_TRENDING_FILTERS.period,
      contentType:
        filters?.contentType ?? DEFAULT_TRENDING_FILTERS.contentType,
      minVolume: filters?.minVolume ?? DEFAULT_TRENDING_FILTERS.minVolume,
      sort: filters?.sort ?? DEFAULT_TRENDING_FILTERS.sort,
      limit: filters?.limit ?? DEFAULT_TRENDING_FILTERS.limit,
    };

    // Apply content-type filter to the underlying asset set BEFORE
    // grouping. PRD: filters must affect provider aggregation, not
    // just the displayed list.
    const ctFiltered = assets.filter((a) =>
      matchesTrendingContentType(a, applied.contentType!),
    );

    if (ctFiltered.length === 0) {
      return emptyTrendingEnvelope(
        applied,
        "Imported assets do not match the current content-type filter.",
      );
    }

    const now = Date.now();
    // Half-window split for recent vs previous. Period N → last N is
    // recent, the previous N is prev. The trendingPeriodMs helper is
    // the single source of truth for these durations.
    const halfMs = trendingPeriodMs(applied.period!);

    interface KwAccum {
      keyword: string;
      volume: number;
      assets: SearchAsset[];
      recent: number;
      prev: number;
      hasRecent: boolean;
      hasPrev: boolean;
    }
    const byKeyword = new Map<string, KwAccum>();
    for (const a of ctFiltered) {
      const ts = new Date(a.uploadDate).getTime();
      const age = Number.isFinite(ts) ? now - ts : Number.POSITIVE_INFINITY;
      const isRecent = age <= halfMs;
      const isPrev = age <= halfMs * 2 && age > halfMs;
      for (const kw of a.keywords) {
        const key = kw.toLowerCase().trim();
        if (!key) continue;
        const cur = byKeyword.get(key) ?? {
          keyword: key,
          volume: 0,
          assets: [],
          recent: 0,
          prev: 0,
          hasRecent: false,
          hasPrev: false,
        };
        cur.volume += a.downloads;
        cur.assets.push(a);
        if (isRecent) {
          cur.recent += a.downloads;
          cur.hasRecent = true;
        }
        if (isPrev) {
          cur.prev += a.downloads;
          cur.hasPrev = true;
        }
        byKeyword.set(key, cur);
      }
    }

    if (byKeyword.size === 0) {
      return emptyTrendingEnvelope(
        applied,
        "Imported assets have no keywords for the current filters.",
      );
    }

    function growthFor(v: { recent: number; prev: number }): number {
      if (v.prev > 0) {
        return Math.round(((v.recent - v.prev) / v.prev) * 100);
      }
      // No prev-window data — if recent is non-zero, treat as +100% rather
      // than infinity. If both windows are empty, growth is 0.
      return v.recent > 0 ? 100 : 0;
    }

    // Section 1 — Trending keywords. Honor minVolume + sort + limit.
    const trendingPool: TrendingKeyword[] = Array.from(byKeyword.values())
      .filter((v) => v.volume >= (applied.minVolume ?? 0))
      .map((v) => ({
        keyword: v.keyword,
        volume: v.volume,
        growth: growthFor(v),
        metricsAvailable: true,
      }));
    const trending = sortTrending(trendingPool, applied.sort!).slice(
      0,
      applied.limit,
    );

    // Section 2 — Rising niches. Same pool but require non-trivial
    // growth and at least 2 assets (a single asset can't be a "niche").
    const competitionFor = (assetsCount: number, downloads: number) => {
      if (downloads <= 0) return 0;
      return Math.min(
        100,
        Math.round((assetsCount / Math.max(1, downloads / 100)) * 10),
      );
    };
    const risingPool: RisingNiche[] = Array.from(byKeyword.values())
      .filter((v) => v.assets.length >= 2)
      .filter((v) => v.volume >= (applied.minVolume ?? 0))
      .map((v) => ({
        keyword: v.keyword,
        downloads: v.volume,
        assets: v.assets.length,
        growth: growthFor(v),
        competition: competitionFor(v.assets.length, v.volume),
        metricsAvailable: true,
      }))
      .filter((n) => n.growth > 0);
    const risingNiches = risingPool
      .sort((a, b) =>
        applied.sort === "volume"
          ? b.downloads - a.downloads || b.growth - a.growth
          : b.growth - a.growth || b.downloads - a.downloads,
      )
      .slice(0, applied.limit);

    // Section 3 — Top performers in the active period. Filter by upload
    // date so only assets uploaded within the period qualify, then sort
    // by downloads. We expose `recentDownloads` as the asset's lifetime
    // downloads here (we don't have time-series telemetry from a CSV
    // import) and rely on the period filter on the asset to honor the
    // user's chosen window.
    const topPerformers: TopPerformer[] = ctFiltered
      .filter((a) => {
        const ts = new Date(a.uploadDate).getTime();
        if (!Number.isFinite(ts) || ts === 0) return false;
        return now - ts <= halfMs;
      })
      .filter((a) => a.metricsAvailable !== false && a.downloads > 0)
      .sort(
        (a, b) =>
          b.downloads - a.downloads ||
          b.performanceScore - a.performanceScore,
      )
      .slice(0, applied.limit)
      .map((a) => ({ asset: a, recentDownloads: a.downloads }));

    // Section 4 — Seasonal trends. Bucket each keyword's lifetime
    // downloads by upload month, find the peak month, and report the
    // peak vs avg lift. Requires at least 6 distinct upload months
    // across the keyword's assets to qualify (otherwise the seasonal
    // signal is too noisy to label honestly).
    const seasonalCandidates = Array.from(byKeyword.values()).filter(
      (v) => v.assets.length >= 4 && v.volume >= (applied.minVolume ?? 0),
    );
    const seasonal: SeasonalTrend[] = seasonalCandidates
      .map((v) => {
        const monthBuckets = new Array<number>(12).fill(0);
        const monthsSeen = new Set<number>();
        for (const a of v.assets) {
          const ts = new Date(a.uploadDate).getTime();
          if (!Number.isFinite(ts) || ts === 0) continue;
          const m = new Date(ts).getMonth();
          monthBuckets[m] += a.downloads;
          monthsSeen.add(m);
        }
        const total = monthBuckets.reduce((s, n) => s + n, 0);
        if (total <= 0 || monthsSeen.size < 6) {
          return {
            keyword: v.keyword,
            peakMonth: 0,
            peakLift: 0,
            status: "off_season" as const,
            available: false,
          };
        }
        const avg = total / 12;
        let peakMonth = 0;
        let peakValue = monthBuckets[0];
        for (let i = 1; i < 12; i++) {
          if (monthBuckets[i] > peakValue) {
            peakValue = monthBuckets[i];
            peakMonth = i;
          }
        }
        const peakLift = avg > 0 ? peakValue / avg : 0;
        return {
          keyword: v.keyword,
          peakMonth,
          peakLift,
          status: seasonalStatus(peakMonth),
          available: peakLift >= 1.5, // require a meaningful spike
        };
      })
      .filter((s) => s.available)
      .sort((a, b) => {
        const rank = (st: SeasonalTrend["status"]) =>
          st === "in_season" ? 0 : st === "approaching" ? 1 : 2;
        return rank(a.status) - rank(b.status) || b.peakLift - a.peakLift;
      })
      .slice(0, applied.limit);

    return {
      trending,
      risingNiches,
      topPerformers,
      seasonal,
      appliedFilters: applied,
      dataQuality: "verified",
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      providerName: PROVIDER_NAME,
    } satisfies ProviderTrendingResult;
  },
};

function emptyTrendingEnvelope(
  applied: TrendingFilters,
  notice: string,
): ProviderTrendingResult {
  return {
    trending: [],
    risingNiches: [],
    topPerformers: [],
    seasonal: [],
    appliedFilters: applied,
    dataQuality: "verified",
    providerId: PROVIDER_ID,
    capabilities: CAPABILITIES,
    providerName: PROVIDER_NAME,
    notice,
  };
}
