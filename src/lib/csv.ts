import type { SearchAsset, SimilarAsset } from "@/types/search";
import type {
  HeatmapFilters,
  HeatmapTile,
  ProviderContributorResult,
  ProviderHeatmapResult,
} from "@/lib/providers/types";
import { describeHeatmapPeriod } from "@/lib/heatmap";

const CSV_HEADERS = [
  "ID",
  "Title",
  "Downloads",
  "Performance Score",
  "Downloads/Month",
  "Content Type",
  "Categories",
  "Upload Date",
  "Contributor",
  "Keywords",
  "Adobe Stock URL",
  "Is Premium",
  "Is AI",
];

function escape(value: string | number | boolean): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function assetsToCsv(assets: SearchAsset[]): string {
  const rows = [CSV_HEADERS.join(",")];
  for (const a of assets) {
    rows.push(
      [
        a.id,
        a.title,
        a.downloads,
        a.performanceScore,
        a.downloadsPerMonth,
        a.contentType,
        a.categories.join("; "),
        a.uploadDate.slice(0, 10),
        a.contributorName,
        a.keywords.join("; "),
        a.adobeStockUrl,
        a.isPremium,
        a.isAiGenerated,
      ]
        .map(escape)
        .join(","),
    );
  }
  return rows.join("\n");
}

/**
 * CSV variant for the Similar Image Search export. Adds a leading
 * `Similarity Score` column, and honors `similarityAvailable === false`
 * + `metricsAvailable === false` so unavailable cells render
 * "Unavailable" instead of fake zeros (matching the UI).
 */
export function similarAssetsToCsv(assets: SimilarAsset[]): string {
  const headers = [
    "Similarity Score",
    ...CSV_HEADERS,
  ];
  const rows = [headers.join(",")];
  for (const a of assets) {
    const score =
      a.similarityAvailable === false
        ? "Unavailable"
        : a.similarityScore;
    const metricsOff = a.metricsAvailable === false;
    rows.push(
      [
        score,
        a.id,
        a.title,
        metricsOff ? "Unavailable" : a.downloads,
        metricsOff ? "Unavailable" : a.performanceScore,
        metricsOff ? "Unavailable" : a.downloadsPerMonth,
        a.contentType,
        a.categories.join("; "),
        a.uploadDate.slice(0, 10),
        a.contributorName,
        a.keywords.join("; "),
        a.adobeStockUrl,
        a.isPremium,
        a.isAiGenerated,
      ]
        .map(escape)
        .join(","),
    );
  }
  return rows.join("\n");
}

/**
 * Builds a multi-section CSV for a Portfolio Tracker export. Sections are
 * separated by blank rows so spreadsheets render them as distinct tables:
 *
 *   1. Contributor overview (single row of summary stats)
 *   2. Asset list (full grid)
 *   3. Keyword analysis (frequency + avg downloads)
 *
 * Honors `metricsAvailable` and `capabilities.downloadsAvailable` so we
 * never emit fake `0` numbers — unavailable cells render as `Unavailable`.
 */
export function portfolioToCsv(data: ProviderContributorResult): string {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;
  const dl = (n: number, metricsAvailable?: boolean) =>
    !downloadsAvailable || metricsAvailable === false ? "Unavailable" : String(n);

  const out: string[] = [];

  // Section 1 — overview
  out.push(
    [
      "Section",
      "Contributor",
      "Total Assets",
      "Total Downloads",
      "Avg Downloads",
      "Best Asset",
      "Best Asset Downloads",
      "Join Date",
      "Data Quality",
      "Provider",
    ]
      .map(escape)
      .join(","),
  );
  out.push(
    [
      "overview",
      data.name,
      data.totalAssets,
      dl(data.totalDownloads),
      dl(data.avgDownloads),
      data.bestAsset.title,
      dl(data.bestAsset.downloads),
      data.joinDate.slice(0, 10),
      data.dataQuality,
      data.providerName,
    ]
      .map(escape)
      .join(","),
  );

  // Section 2 — assets
  out.push("");
  out.push(
    [
      "Section",
      "Asset ID",
      "Title",
      "Content Type",
      "Downloads",
      "Performance",
      "Upload Date",
      "Keywords",
      "Adobe Stock URL",
    ]
      .map(escape)
      .join(","),
  );
  for (const a of data.assets) {
    out.push(
      [
        "asset",
        a.id,
        a.title,
        a.contentType,
        dl(a.downloads, a.metricsAvailable),
        a.metricsAvailable === false ? "Unavailable" : a.performanceScore,
        a.uploadDate.slice(0, 10),
        a.keywords.join("; "),
        a.adobeStockUrl,
      ]
        .map(escape)
        .join(","),
    );
  }

  // Section 3 — keyword analysis
  const stats = new Map<string, { count: number; downloadSum: number }>();
  for (const a of data.assets) {
    for (const k of a.keywords) {
      const key = k.toLowerCase();
      const cur = stats.get(key) ?? { count: 0, downloadSum: 0 };
      cur.count += 1;
      if (downloadsAvailable && a.metricsAvailable !== false) {
        cur.downloadSum += a.downloads;
      }
      stats.set(key, cur);
    }
  }
  out.push("");
  out.push(["Section", "Keyword", "Frequency", "Avg Downloads"].map(escape).join(","));
  const rows = Array.from(stats.entries())
    .map(([keyword, v]) => ({
      keyword,
      count: v.count,
      avg: v.count > 0 ? Math.round(v.downloadSum / v.count) : 0,
    }))
    .sort((a, b) => b.count - a.count);
  for (const r of rows) {
    out.push(
      [
        "keyword",
        r.keyword,
        r.count,
        downloadsAvailable ? r.avg : "Unavailable",
      ]
        .map(escape)
        .join(","),
    );
  }

  return out.join("\n");
}

/**
 * Build a CSV for the heat-map page. Two modes:
 *
 *   - `mode = "list"`: dump the niche grid currently visible in the UI.
 *     One row per niche, summary stats only.
 *
 *   - `mode = "detail"`: drilldown for a single niche. Multi-section CSV:
 *       1. Niche overview (one row of summary stats)
 *       2. Top assets (one row each)
 *       3. Related keywords (frequency)
 *       4. Content-type breakdown (one row per content type)
 *
 * Honors `result.capabilities.downloadsAvailable` and the per-tile
 * `metricsAvailable` so we never emit fake `0` numbers when the
 * provider couldn't supply real ones.
 */
export function heatmapToCsv(
  result: ProviderHeatmapResult,
  mode: "list" | "detail",
): string {
  const downloadsAvailable = result.capabilities?.downloadsAvailable !== false;
  const dl = (n: number, available?: boolean) =>
    !downloadsAvailable || available === false ? "Unavailable" : String(n);
  const filters: HeatmapFilters = result.appliedFilters ?? {};
  const filterSummary = [
    `Content type: ${filters.contentType ?? "all"}`,
    `Period: ${describeHeatmapPeriod(filters.period ?? "all")}`,
    `Min downloads: ${filters.minDownloads ?? 0}`,
    `Sort: ${filters.sort ?? "opportunity"}`,
  ].join("; ");

  const out: string[] = [];

  // Header section — same for list and detail.
  out.push(
    [
      "Section",
      "Provider",
      "Data Quality",
      "Filters",
      "Generated",
    ]
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

  if (mode === "list") {
    out.push("");
    out.push(
      [
        "Section",
        "Niche",
        "Downloads",
        "Assets",
        "Competition",
        "Trend",
        "Opportunity Score",
        "Avg Performance",
        "Metrics Available",
      ]
        .map(escape)
        .join(","),
    );
    for (const n of result.niches) {
      out.push(
        [
          "niche",
          n.keyword,
          dl(n.downloads, n.metricsAvailable),
          n.assets,
          n.competition,
          n.trendAvailable ? n.trend : "Unavailable",
          n.opportunityScore,
          n.metricsAvailable ? n.avgPerformanceScore : "Unavailable",
          n.metricsAvailable ? "true" : "false",
        ]
          .map(escape)
          .join(","),
      );
    }
    return out.join("\n");
  }

  // Detail mode — single niche. The caller is expected to have already
  // ensured `result.niches.length === 1`; we still defensively handle the
  // empty case so the CSV isn't broken.
  const niche: HeatmapTile | undefined = result.niches[0];
  out.push("");
  out.push(
    [
      "Section",
      "Niche",
      "Downloads",
      "Assets",
      "Competition",
      "Trend",
      "Opportunity Score",
      "Avg Performance",
    ]
      .map(escape)
      .join(","),
  );
  if (niche) {
    out.push(
      [
        "overview",
        niche.keyword,
        dl(niche.downloads, niche.metricsAvailable),
        niche.assets,
        niche.competition,
        niche.trendAvailable ? niche.trend : "Unavailable",
        niche.opportunityScore,
        niche.metricsAvailable ? niche.avgPerformanceScore : "Unavailable",
      ]
        .map(escape)
        .join(","),
    );
  }

  // Top assets
  out.push("");
  out.push(
    [
      "Section",
      "Asset ID",
      "Title",
      "Content Type",
      "Downloads",
      "Performance",
      "Upload Date",
      "Contributor",
      "Keywords",
      "Adobe Stock URL",
    ]
      .map(escape)
      .join(","),
  );
  for (const a of niche?.topAssets ?? []) {
    out.push(
      [
        "asset",
        a.id,
        a.title,
        a.contentType,
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

  // Related keywords
  out.push("");
  out.push(["Section", "Related Keyword"].map(escape).join(","));
  for (const k of niche?.relatedKeywords ?? []) {
    out.push(["related", k].map(escape).join(","));
  }

  // Content-type breakdown
  out.push("");
  out.push(["Section", "Content Type", "Count"].map(escape).join(","));
  for (const c of niche?.contentTypeBreakdown ?? []) {
    out.push(["breakdown", c.contentType, c.count].map(escape).join(","));
  }

  return out.join("\n");
}
