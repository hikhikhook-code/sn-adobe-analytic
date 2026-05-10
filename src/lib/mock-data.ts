// Mock Adobe Stock data for development. Replace with real scraper output in
// Phase 2 (see lib/scraper/adobe-stock.ts).

import type { SearchAsset } from "@/types/search";
import { calculateDownloadsPerMonth, calculatePerformanceScore } from "./scoring";

const CONTRIBUTORS = [
  { id: "201234567", name: "Anna Visual" },
  { id: "208877123", name: "Studio Lumen" },
  { id: "211100456", name: "Marko Imagery" },
  { id: "215553388", name: "Sasha Frames" },
  { id: "219977220", name: "Pixel Vault" },
];

const CATEGORY_BANK: Record<string, string[]> = {
  business: ["Business", "Office", "Corporate"],
  nature: ["Nature", "Landscape", "Outdoor"],
  technology: ["Technology", "Computer", "Digital"],
  food: ["Food", "Cuisine", "Cooking"],
  travel: ["Travel", "Vacation", "Adventure"],
  default: ["Lifestyle", "Concept"],
};

const CONTENT_TYPES = ["photo", "illustration", "vector", "video"] as const;

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function pseudoRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

function pickThumb(seed: number, kw: string): string {
  // Use picsum.photos for stable demo thumbnails (royalty-free placeholder)
  const id = (seed % 1000) + 10;
  return `https://picsum.photos/seed/${encodeURIComponent(kw)}-${id}/400/400`;
}

function pickKeywords(keyword: string, rng: () => number): string[] {
  const base = keyword.toLowerCase().split(/\s+/).filter(Boolean);
  const extras = [
    "background",
    "concept",
    "design",
    "creative",
    "modern",
    "abstract",
    "minimal",
    "professional",
    "vibrant",
    "natural",
    "lifestyle",
    "studio",
    "isolated",
    "white",
    "vintage",
    "trendy",
  ];
  const picked = new Set<string>(base);
  while (picked.size < 8 + Math.floor(rng() * 12)) {
    picked.add(extras[Math.floor(rng() * extras.length)]);
  }
  return Array.from(picked);
}

export interface MockSearchResult {
  totalResults: number;
  results: SearchAsset[];
}

export function generateMockSearchResults(
  keyword: string,
  page = 1,
  pageSize = 30,
): MockSearchResult {
  const seed = hash(`${keyword}|${page}`);
  const rng = pseudoRandom(seed);
  const totalResults = 5_000 + Math.floor(rng() * 200_000_000);
  const categoryKey =
    Object.keys(CATEGORY_BANK).find((k) => keyword.toLowerCase().includes(k)) ??
    "default";

  const results: SearchAsset[] = Array.from({ length: pageSize }).map((_, i) => {
    const localSeed = seed + i;
    const localRng = pseudoRandom(localSeed);
    const monthsOld = 1 + Math.floor(localRng() * 96);
    const upload = new Date();
    upload.setMonth(upload.getMonth() - monthsOld);
    const downloads = Math.floor(50 + localRng() * 12_000);
    const contributor = CONTRIBUTORS[Math.floor(localRng() * CONTRIBUTORS.length)];
    const contentType =
      CONTENT_TYPES[Math.floor(localRng() * CONTENT_TYPES.length)];
    const isAi = localRng() > 0.75;
    const isPremium = localRng() > 0.7;
    const id = `${100_000_000 + localSeed % 900_000_000}`;
    return {
      id,
      thumbnailUrl: pickThumb(localSeed, keyword),
      title: `${keyword.charAt(0).toUpperCase()}${keyword.slice(1)} ${
        ["scene", "concept", "background", "composition", "shot", "view"][
          Math.floor(localRng() * 6)
        ]
      } #${i + 1 + (page - 1) * pageSize}`,
      downloads,
      performanceScore: calculatePerformanceScore(downloads, upload),
      downloadsPerMonth: calculateDownloadsPerMonth(downloads, upload),
      categories: CATEGORY_BANK[categoryKey],
      contentType,
      uploadDate: upload.toISOString(),
      contributorName: contributor.name,
      contributorId: contributor.id,
      isPremium,
      isAiGenerated: isAi,
      keywords: pickKeywords(keyword, localRng),
      // Demo rows intentionally ship an EMPTY adobeStockUrl. A
      // synthetic 9-digit id would look real but 404 on stock.adobe.com,
      // so the resolver in src/lib/adobe-stock-link.ts routes demo
      // assets to a safe keyword-search fallback instead of a fake
      // detail page. See PR #19.
      adobeStockUrl: "",
    };
  });

  return { totalResults, results };
}

/**
 * Demo trending keywords. Each row tags the dominant content type so the
 * mock provider can honor the trending content-type filter without
 * synthesising fake per-asset metrics. Anything missing a contentType
 * defaults to "photo" in the provider.
 */
export const TRENDING_KEYWORDS: ReadonlyArray<{
  keyword: string;
  growth: number;
  volume: number;
  contentType: "photo" | "illustration" | "vector" | "video" | "template" | "3d";
}> = [
  { keyword: "ai generated background", growth: 187, volume: 32_400, contentType: "illustration" },
  { keyword: "minimalist office", growth: 142, volume: 18_900, contentType: "photo" },
  { keyword: "remote work lifestyle", growth: 121, volume: 15_200, contentType: "photo" },
  { keyword: "sustainable living", growth: 98, volume: 12_100, contentType: "photo" },
  { keyword: "abstract gradient", growth: 86, volume: 21_700, contentType: "vector" },
  { keyword: "diverse team meeting", growth: 73, volume: 9_800, contentType: "photo" },
  { keyword: "futuristic technology", growth: 65, volume: 14_600, contentType: "3d" },
  { keyword: "watercolor texture", growth: 58, volume: 11_300, contentType: "illustration" },
  { keyword: "cozy home interior", growth: 52, volume: 13_400, contentType: "photo" },
  { keyword: "fitness motivation", growth: 47, volume: 8_700, contentType: "video" },
  { keyword: "summer travel scene", growth: 39, volume: 22_500, contentType: "photo" },
  { keyword: "holiday seasonal banner", growth: 33, volume: 17_200, contentType: "vector" },
];

/**
 * Demo seasonal trends. Calendar-month index (0-11) marks the historical
 * peak; `peakLift` is "peak month vs avg" multiplier. The mock provider
 * uses these verbatim and labels them Demo Data.
 */
export const SEASONAL_TRENDS: ReadonlyArray<{
  keyword: string;
  peakMonth: number;
  peakLift: number;
}> = [
  { keyword: "winter holiday", peakMonth: 11, peakLift: 4.8 },
  { keyword: "valentines day", peakMonth: 1, peakLift: 5.2 },
  { keyword: "spring fashion", peakMonth: 2, peakLift: 2.4 },
  { keyword: "easter celebration", peakMonth: 3, peakLift: 3.1 },
  { keyword: "summer vacation", peakMonth: 6, peakLift: 3.7 },
  { keyword: "back to school", peakMonth: 7, peakLift: 2.9 },
  { keyword: "halloween decor", peakMonth: 9, peakLift: 4.4 },
  { keyword: "thanksgiving table", peakMonth: 10, peakLift: 3.5 },
  { keyword: "new year fireworks", peakMonth: 0, peakLift: 4.0 },
  { keyword: "back to office", peakMonth: 8, peakLift: 2.2 },
];

export const HEATMAP_NICHES = [
  { keyword: "business meeting", downloads: 184_000, assets: 21_000, competition: 88, trend: "stable" as const },
  { keyword: "ai illustration", downloads: 162_000, assets: 8_400, competition: 41, trend: "up" as const },
  { keyword: "nature landscape", downloads: 154_000, assets: 32_000, competition: 92, trend: "stable" as const },
  { keyword: "minimalist wallpaper", downloads: 121_000, assets: 5_200, competition: 28, trend: "up" as const },
  { keyword: "food photography", downloads: 118_000, assets: 19_500, competition: 76, trend: "down" as const },
  { keyword: "sustainable energy", downloads: 96_000, assets: 4_800, competition: 33, trend: "up" as const },
  { keyword: "fashion editorial", downloads: 89_000, assets: 12_700, competition: 64, trend: "stable" as const },
  { keyword: "fitness lifestyle", downloads: 81_000, assets: 14_200, competition: 71, trend: "up" as const },
  { keyword: "tech device", downloads: 74_000, assets: 16_800, competition: 79, trend: "stable" as const },
  { keyword: "travel destination", downloads: 67_000, assets: 22_400, competition: 84, trend: "down" as const },
  { keyword: "abstract texture", downloads: 64_000, assets: 6_900, competition: 36, trend: "up" as const },
  { keyword: "remote work setup", downloads: 58_000, assets: 5_600, competition: 31, trend: "up" as const },
];

/**
 * Static "primary content type" tag for each demo niche. Lets the mock
 * provider honor the heatmap content-type filter without inventing fake
 * per-asset numbers \u2014 the niche itself self-identifies. Anything not
 * listed here defaults to `"photo"` in the provider.
 */
export const HEATMAP_NICHE_PRIMARY_TYPE: Record<string, string> = {
  "business meeting": "photo",
  "ai illustration": "illustration",
  "nature landscape": "photo",
  "minimalist wallpaper": "vector",
  "food photography": "photo",
  "sustainable energy": "photo",
  "fashion editorial": "photo",
  "fitness lifestyle": "video",
  "tech device": "3d",
  "travel destination": "photo",
  "abstract texture": "vector",
  "remote work setup": "photo",
};

export interface MockContributor {
  id: string;
  name: string;
  joinDate: string;
  totalAssets: number;
  totalDownloads: number;
  avgDownloads: number;
  bestAsset: SearchAsset;
  contentBreakdown: { type: string; count: number; pct: number }[];
  topKeywords: { keyword: string; count: number }[];
  monthlyDownloads: { month: string; downloads: number }[];
  assets: SearchAsset[];
}

export function generateMockContributor(query: string): MockContributor {
  const { results } = generateMockSearchResults(query || "portfolio", 1, 24);
  const totalDownloads = results.reduce((s, r) => s + r.downloads, 0);
  const best = [...results].sort((a, b) => b.downloads - a.downloads)[0];
  const breakdown = ["photo", "illustration", "vector", "video"].map((t) => {
    const c = results.filter((r) => r.contentType === t).length;
    return { type: t, count: c, pct: Math.round((c / results.length) * 100) };
  });
  const kwFreq = new Map<string, number>();
  results.forEach((r) =>
    r.keywords.forEach((k) => kwFreq.set(k, (kwFreq.get(k) ?? 0) + 1)),
  );
  const topKeywords = Array.from(kwFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([keyword, count]) => ({ keyword, count }));
  const months = Array.from({ length: 12 }).map((_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (11 - i));
    return {
      month: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      downloads: Math.floor(800 + Math.random() * 4_500),
    };
  });
  return {
    id: query.replace(/\s+/g, "-").toLowerCase() || "demo",
    name: query || "Demo Contributor",
    joinDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 4).toISOString(),
    totalAssets: 1200 + Math.floor(Math.random() * 5000),
    totalDownloads,
    avgDownloads: Math.round(totalDownloads / results.length),
    bestAsset: best,
    contentBreakdown: breakdown,
    topKeywords,
    monthlyDownloads: months,
    assets: results,
  };
}
