/**
 * Trending shared logic.
 *
 * Provider-agnostic helpers used by mock + manual + official trending
 * implementations and by the `/api/search/trending` route + CSV export.
 *
 * Keeping this in one module guarantees:
 *   - Filters behave the same across providers (PRD \u00a75.8).
 *   - `/api/search/trending` normalizes URL params once, server-side.
 *   - Trending CSV export and the UI render the exact same numbers.
 */
import { csvWithBom, CSV_CRLF } from "@/lib/csv";
import type {
  ProviderTrendingResult,
  RisingNiche,
  SeasonalTrend,
  TopPerformer,
  TrendingContentType,
  TrendingFilters,
  TrendingKeyword,
  TrendingPeriod,
  TrendingSort,
} from "./providers/types";

const KNOWN_CONTENT_TYPES = new Set<TrendingContentType>([
  "photo",
  "illustration",
  "vector",
  "video",
  "template",
  "3d",
]);

export const DEFAULT_TRENDING_LIMIT = 12;

/** Default filter values. Providers always echo these back. */
export const DEFAULT_TRENDING_FILTERS: Required<TrendingFilters> = {
  period: "30d",
  contentType: "all",
  minVolume: 0,
  sort: "growth",
  limit: DEFAULT_TRENDING_LIMIT,
};

/** "Other" matches anything not in the known set. */
export function matchesTrendingContentType(
  asset: { contentType: string },
  filter: TrendingContentType,
): boolean {
  if (filter === "all") return true;
  if (filter === "other") {
    return !KNOWN_CONTENT_TYPES.has(asset.contentType as TrendingContentType);
  }
  return asset.contentType === filter;
}

/**
 * Convert a `TrendingPeriod` into a millisecond cutoff.
 */
export function trendingPeriodMs(period: TrendingPeriod): number {
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
    default:
      return 30 * day;
  }
}

/**
 * Parse raw query-string values into a normalized `TrendingFilters`.
 * Unknown values fall back to defaults so no client error can crash the
 * API route.
 */
export function parseTrendingFilters(params: {
  period?: string | null;
  contentType?: string | null;
  minVolume?: string | null;
  sort?: string | null;
  limit?: string | null;
}): TrendingFilters {
  const p = params.period?.toLowerCase();
  const period: TrendingPeriod =
    p === "7d" || p === "30d" || p === "90d" || p === "1y" ? p : "30d";

  const ct = params.contentType?.toLowerCase();
  const contentType: TrendingContentType =
    ct === "photo" ||
    ct === "illustration" ||
    ct === "vector" ||
    ct === "video" ||
    ct === "template" ||
    ct === "3d" ||
    ct === "other"
      ? ct
      : "all";

  let minVolume = 0;
  if (params.minVolume) {
    const n = Number(params.minVolume);
    if (Number.isFinite(n) && n > 0) minVolume = Math.floor(n);
  }

  const s = params.sort?.toLowerCase();
  const sort: TrendingSort = s === "volume" ? "volume" : "growth";

  let limit = DEFAULT_TRENDING_LIMIT;
  if (params.limit) {
    const n = Number(params.limit);
    if (Number.isFinite(n) && n > 0) {
      // Cap the limit so a malicious URL can't ask the server to allocate
      // a 100k-row response. UI never asks for more than 50.
      limit = Math.min(50, Math.floor(n));
    }
  }

  return { period, contentType, minVolume, sort, limit };
}

/** Sort trending keywords by the requested dimension. Stable secondary sort. */
export function sortTrending<T extends { volume: number; growth: number }>(
  items: T[],
  sort: TrendingSort,
): T[] {
  const arr = [...items];
  if (sort === "volume") {
    return arr.sort((a, b) => b.volume - a.volume || b.growth - a.growth);
  }
  return arr.sort((a, b) => b.growth - a.growth || b.volume - a.volume);
}

/** Human-readable label for the period filter (used in CSV / UI). */
export function describeTrendingPeriod(p: TrendingPeriod): string {
  switch (p) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "1y":
      return "Last 1 year";
    default:
      return "Last 30 days";
  }
}

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function describeMonth(idx: number): string {
  if (idx < 0 || idx > 11) return "Unknown";
  return MONTH_LABELS[idx];
}

export function describeSeasonalStatus(s: SeasonalTrend["status"]): string {
  switch (s) {
    case "in_season":
      return "In season";
    case "approaching":
      return "Approaching peak";
    case "off_season":
      return "Off season";
    default:
      return "Unknown";
  }
}

/** Status decision: "approaching" if within 2 months of peak, "in_season"
 *  on the peak month exactly, "off_season" otherwise. */
export function seasonalStatus(
  peakMonth: number,
  currentMonth: number = new Date().getMonth(),
): SeasonalTrend["status"] {
  if (peakMonth === currentMonth) return "in_season";
  // distance forward in the calendar (peak from now)
  let forward = peakMonth - currentMonth;
  if (forward < 0) forward += 12;
  if (forward <= 2) return "approaching";
  return "off_season";
}

function escape(value: string | number | boolean): string {
  const s = String(value);
  // Quote any field containing a comma, double-quote, CR, or LF. `\r`
  // is the PR #20 addition — without it a bare carriage return inside
  // a keyword/title could split a row across lines in Excel.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build a multi-section CSV for a Trending export.
 *
 * Sections:
 *   1. Meta header (provider, data quality, applied filters, generated)
 *   2. Trending keywords (one row per keyword)
 *   3. Rising niches
 *   4. Top performers this period (one row per asset)
 *   5. Seasonal trends
 *
 * Honors `metricsAvailable` and `capabilities.downloadsAvailable` so we
 * never emit fake `0` numbers \u2014 unavailable cells render `Unavailable`.
 */
export function trendingToCsv(result: ProviderTrendingResult): string {
  const downloadsAvailable = result.capabilities?.downloadsAvailable !== false;
  const dl = (n: number, available?: boolean) =>
    !downloadsAvailable || available === false ? "Unavailable" : String(n);
  const filters = result.appliedFilters ?? {};
  const filterSummary = [
    `Period: ${describeTrendingPeriod(filters.period ?? "30d")}`,
    `Content type: ${filters.contentType ?? "all"}`,
    `Min volume: ${filters.minVolume ?? 0}`,
    `Sort: ${filters.sort ?? "growth"}`,
    `Limit: ${filters.limit ?? DEFAULT_TRENDING_LIMIT}`,
  ].join("; ");

  const out: string[] = [];

  // Section 1 \u2014 meta header
  out.push(
    ["Section", "Provider", "Data Quality", "Filters", "Generated"]
      .map(escape)
      .join(","),
  );
  out.push(
    [
      "meta",
      result.providerName,
      result.dataQuality,
      filterSummary,
      new Date().toISOString(),
    ]
      .map(escape)
      .join(","),
  );

  // Section 2 \u2014 trending keywords
  out.push("");
  out.push(
    [
      "Section",
      "Keyword",
      "Volume",
      "Growth %",
      "Metrics Available",
    ]
      .map(escape)
      .join(","),
  );
  for (const t of result.trending as TrendingKeyword[]) {
    out.push(
      [
        "trending",
        t.keyword,
        dl(t.volume, t.metricsAvailable),
        t.metricsAvailable === false ? "Unavailable" : t.growth,
        t.metricsAvailable === false ? "false" : "true",
      ]
        .map(escape)
        .join(","),
    );
  }

  // Section 3 \u2014 rising niches
  out.push("");
  out.push(
    [
      "Section",
      "Niche",
      "Downloads",
      "Assets",
      "Growth %",
      "Competition",
      "Metrics Available",
    ]
      .map(escape)
      .join(","),
  );
  for (const n of result.risingNiches as RisingNiche[]) {
    out.push(
      [
        "rising",
        n.keyword,
        dl(n.downloads, n.metricsAvailable),
        n.assets,
        n.metricsAvailable === false ? "Unavailable" : n.growth,
        n.competition,
        n.metricsAvailable === false ? "false" : "true",
      ]
        .map(escape)
        .join(","),
    );
  }

  // Section 4 \u2014 top performers this period
  out.push("");
  out.push(
    [
      "Section",
      "Asset ID",
      "Title",
      "Content Type",
      "Recent Downloads",
      "Total Downloads",
      "Performance",
      "Upload Date",
      "Contributor",
      "Keywords",
      "Adobe Stock URL",
    ]
      .map(escape)
      .join(","),
  );
  for (const p of result.topPerformers as TopPerformer[]) {
    const a = p.asset;
    out.push(
      [
        "performer",
        a.id,
        a.title,
        a.contentType,
        dl(p.recentDownloads, a.metricsAvailable),
        dl(a.downloads, a.metricsAvailable),
        a.metricsAvailable === false ? "Unavailable" : a.performanceScore,
        a.uploadDate.slice(0, 10),
        a.contributorName,
        a.keywords.join("; "),
        a.adobeStockUrl,
      ]
        .map(escape)
        .join(","),
    );
  }

  // Section 5 \u2014 seasonal trends
  out.push("");
  out.push(
    [
      "Section",
      "Keyword",
      "Peak Month",
      "Peak Lift",
      "Status",
      "Available",
    ]
      .map(escape)
      .join(","),
  );
  for (const s of result.seasonal as SeasonalTrend[]) {
    out.push(
      [
        "seasonal",
        s.keyword,
        s.available ? describeMonth(s.peakMonth) : "Unavailable",
        s.available ? s.peakLift.toFixed(2) : "Unavailable",
        s.available ? describeSeasonalStatus(s.status) : "Unavailable",
        s.available ? "true" : "false",
      ]
        .map(escape)
        .join(","),
    );
  }

  return csvWithBom(out.join(CSV_CRLF));
}
