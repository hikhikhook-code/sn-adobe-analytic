import type { SearchAsset } from "@/types/search";

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
