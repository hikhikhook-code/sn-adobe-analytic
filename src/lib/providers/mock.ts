import {
  HEATMAP_NICHES,
  TRENDING_KEYWORDS,
  generateMockContributor,
  generateMockSearchResults,
} from "@/lib/mock-data";
import { calculateCompetitionLevel } from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import type { SearchAsset } from "@/types/search";
import type {
  DataProvider,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderTrendingResult,
} from "./types";

const PROVIDER_ID = "mock";
const PROVIDER_NAME = "Mock data provider";

function applyFilters(results: SearchAsset[], req: ProviderSearchRequest) {
  let out = results;
  if (req.contentType && req.contentType !== "all") {
    out = out.filter((r) => r.contentType === req.contentType);
  }
  if (req.aiFilter === "ai_only") out = out.filter((r) => r.isAiGenerated);
  if (req.aiFilter === "exclude_ai") out = out.filter((r) => !r.isAiGenerated);
  return out;
}

function applySort(results: SearchAsset[], req: ProviderSearchRequest) {
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

function aiSaturation(results: SearchAsset[]) {
  if (!results.length) return 0;
  const ai = results.filter((r) => r.isAiGenerated).length;
  return Math.round((ai / results.length) * 100);
}

function contentBreakdown(results: SearchAsset[]) {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.contentType] = (counts[r.contentType] ?? 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

export const mockProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "demo",

  async search(req) {
    const page = req.page ?? 1;
    const { totalResults, results } = generateMockSearchResults(
      req.keyword,
      page,
      RESULTS_PER_PAGE,
    );
    const filtered = applyFilters(results, req);
    const sorted = applySort(filtered, req);
    const competitionLevel = calculateCompetitionLevel(totalResults);
    const out: ProviderSearchResult = {
      totalResults,
      competitionLevel,
      aiSaturation: aiSaturation(sorted),
      contentBreakdown: contentBreakdown(sorted),
      results: sorted,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
    };
    return out;
  },

  async contributor(query: string) {
    const c = generateMockContributor(query);
    const out: ProviderContributorResult = {
      name: c.name,
      joinDate: c.joinDate,
      totalAssets: c.totalAssets,
      totalDownloads: c.totalDownloads,
      avgDownloads: c.avgDownloads,
      bestAsset: c.bestAsset,
      contentBreakdown: c.contentBreakdown,
      topKeywords: c.topKeywords,
      monthlyTrend: c.monthlyDownloads,
      assets: c.assets,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
    };
    return out;
  },

  async heatmap() {
    return {
      niches: HEATMAP_NICHES,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
    } satisfies ProviderHeatmapResult;
  },

  async trending() {
    return {
      trending: TRENDING_KEYWORDS,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
    } satisfies ProviderTrendingResult;
  },
};
