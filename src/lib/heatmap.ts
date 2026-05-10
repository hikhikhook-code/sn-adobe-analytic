/**
 * Heat Map shared logic.
 *
 * Provider-agnostic helpers used by both the manual provider (real CSV
 * data) and the mock provider (synthetic demo data). Keeping these in
 * one module guarantees:
 *
 *   - Filters behave the same across providers (so the "Demo Data" badge
 *     never hides a regression in real data behavior, and vice versa).
 *   - The opportunity score formula has one source of truth. Tweaking
 *     the weights changes every provider at once.
 *   - The /api/heatmap route can normalize URL params once.
 */
import type { SearchAsset } from "@/types/search";
import type {
  HeatmapContentType,
  HeatmapFilters,
  HeatmapPeriod,
  HeatmapSort,
  HeatmapTile,
} from "./providers/types";

/** Default filter values. The provider always echoes these back. */
export const DEFAULT_HEATMAP_FILTERS: Required<
  Omit<HeatmapFilters, "niche">
> & { niche?: string } = {
  contentType: "all",
  period: "all",
  minDownloads: 0,
  sort: "opportunity",
};

const KNOWN_CONTENT_TYPES = new Set<HeatmapContentType>([
  "photo",
  "illustration",
  "vector",
  "video",
  "template",
  "3d",
]);

/** "Other" matches anything not in the known set. */
export function matchesContentType(
  asset: { contentType: string },
  filter: HeatmapContentType,
): boolean {
  if (filter === "all") return true;
  if (filter === "other") {
    return !KNOWN_CONTENT_TYPES.has(asset.contentType as HeatmapContentType);
  }
  return asset.contentType === filter;
}

/**
 * Convert a `HeatmapPeriod` into a millisecond cutoff. `"all"` returns
 * `null` so callers know to skip the date filter entirely.
 */
export function periodCutoffMs(period: HeatmapPeriod): number | null {
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case "7d":
      return 7 * day;
    case "30d":
      return 30 * day;
    case "90d":
      return 90 * day;
    case "1y":
      return 365 * day;
    case "all":
    default:
      return null;
  }
}

/**
 * Filter assets by upload date relative to "now". Returns the input
 * unchanged for `"all"`. Asset rows missing an upload date are dropped
 * for any non-`"all"` period (we can't honestly include them).
 */
export function filterAssetsByPeriod<T extends { uploadDate: string | Date }>(
  assets: T[],
  period: HeatmapPeriod,
): T[] {
  const cutoff = periodCutoffMs(period);
  if (cutoff == null) return assets;
  const now = Date.now();
  return assets.filter((a) => {
    const t = new Date(a.uploadDate).getTime();
    if (Number.isNaN(t) || t === 0) return false;
    return now - t <= cutoff;
  });
}

/**
 * Parse a raw query-string value into a normalized `HeatmapFilters`
 * object. Unknown values fall back to defaults so no client error can
 * crash the API route.
 */
export function parseHeatmapFilters(params: {
  contentType?: string | null;
  period?: string | null;
  minDownloads?: string | null;
  sort?: string | null;
  niche?: string | null;
}): HeatmapFilters {
  const ct = params.contentType?.toLowerCase();
  const contentType: HeatmapContentType =
    ct === "photo" ||
    ct === "illustration" ||
    ct === "vector" ||
    ct === "video" ||
    ct === "template" ||
    ct === "3d" ||
    ct === "other"
      ? ct
      : "all";

  const p = params.period?.toLowerCase();
  const period: HeatmapPeriod =
    p === "7d" || p === "30d" || p === "90d" || p === "1y" ? p : "all";

  let minDownloads = 0;
  if (params.minDownloads) {
    const n = Number(params.minDownloads);
    if (Number.isFinite(n) && n > 0) minDownloads = Math.floor(n);
  }

  const s = params.sort?.toLowerCase();
  const sort: HeatmapSort =
    s === "demand" || s === "competition" || s === "trend"
      ? (s as HeatmapSort)
      : "opportunity";

  const niche = params.niche ? params.niche.trim() : "";
  return { contentType, period, minDownloads, sort, niche: niche || undefined };
}

/**
 * Compute the opportunity score for a niche.
 *
 * Weights:
 *   - 50  demand     (log-scaled vs the largest niche in the response)
 *   - 25  competition (inverse — lower competition = higher score)
 *   - 15  performance (avg perf score scaled to 0..15)
 *   - 10  trend      (up = 10, stable = 5, down = 0)
 *
 * Total range 0..100. `metricsAvailable=false` callers should still
 * compute (the score becomes a function of competition + content alone)
 * so the UI has *something* to rank by; the data-quality badge already
 * tells the user the inputs aren't verified.
 */
export function calculateOpportunityScore(input: {
  downloads: number;
  competition: number;
  avgPerformanceScore: number;
  trend: "up" | "down" | "stable";
  /** The largest `downloads` in the current response, used to normalize. */
  maxDownloads: number;
}): number {
  const { downloads, competition, avgPerformanceScore, trend, maxDownloads } =
    input;
  const denom = Math.log(Math.max(1, maxDownloads) + 1);
  const demandPart =
    denom > 0 ? (Math.log(Math.max(0, downloads) + 1) / denom) * 50 : 0;
  const competitionPart =
    ((100 - Math.max(0, Math.min(100, competition))) / 100) * 25;
  const perfPart =
    (Math.max(0, Math.min(100, avgPerformanceScore)) / 100) * 15;
  const trendPart = trend === "up" ? 10 : trend === "stable" ? 5 : 0;
  const score = demandPart + competitionPart + perfPart + trendPart;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/** Sort niches in-place by the requested dimension. */
export function sortNiches(
  niches: HeatmapTile[],
  sort: HeatmapSort,
): HeatmapTile[] {
  const arr = [...niches];
  switch (sort) {
    case "demand":
      return arr.sort((a, b) => b.downloads - a.downloads);
    case "competition":
      // Lower competition first — that's what users actually want when
      // they sort by "competition".
      return arr.sort((a, b) => a.competition - b.competition);
    case "trend": {
      const rank = (t: HeatmapTile["trend"]) =>
        t === "up" ? 2 : t === "stable" ? 1 : 0;
      return arr.sort((a, b) => rank(b.trend) - rank(a.trend) || b.opportunityScore - a.opportunityScore);
    }
    case "opportunity":
    default:
      return arr.sort((a, b) => b.opportunityScore - a.opportunityScore);
  }
}

/** Build a `contentTypeBreakdown` for a set of assets. */
export function contentTypeBreakdown(
  assets: { contentType: string }[],
): { contentType: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const a of assets) {
    counts[a.contentType] = (counts[a.contentType] ?? 0) + 1;
  }
  return Object.entries(counts)
    .map(([contentType, count]) => ({ contentType, count }))
    .sort((a, b) => b.count - a.count);
}

/** Human-readable label for the period filter (used in CSV / UI). */
export function describeHeatmapPeriod(p: HeatmapPeriod): string {
  switch (p) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "1y":
      return "Last 1 year";
    case "all":
    default:
      return "All time";
  }
}

/** Find related keywords by co-occurrence with the given niche keyword. */
export function findRelatedKeywords(
  assets: SearchAsset[],
  niche: string,
  limit = 8,
): string[] {
  const target = niche.toLowerCase();
  const freq = new Map<string, number>();
  for (const a of assets) {
    if (!a.keywords.some((k) => k.toLowerCase() === target)) continue;
    for (const kw of a.keywords) {
      const key = kw.toLowerCase();
      if (key === target) continue;
      freq.set(key, (freq.get(key) ?? 0) + 1);
    }
  }
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}
