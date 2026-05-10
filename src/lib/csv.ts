import type { SearchAsset } from "@/types/search";
import type { ProviderContributorResult } from "@/lib/providers/types";

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
