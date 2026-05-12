import {
  DataProvider,
  ProviderNotImplementedError,
  ProviderNoDataError,
  ProviderSearchResult,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderTrendingResult,
  ProviderSimilarResult,
  ProviderDashboardResult,
} from "./types";
import type { ProviderSearchRequest } from "./types";
import { scrapeAdobeStockSearch } from "./adobe-stock-scraper";

export const officialAdobeProvider: DataProvider = {
  id: "official-adobe",
  name: "official",
  dataQuality: "public_metadata",

  capabilities: {
    search: "supported",
    contributor: "unsupported",
    heatmap: "unsupported",
    trending: "unsupported",
    similarImage: "unsupported",
    dashboard: "unsupported",
    downloadsAvailable: false,
  },

  async search(req: ProviderSearchRequest): Promise<ProviderSearchResult> {
    try {
      const result = await scrapeAdobeStockSearch(
        req.keyword,
        req.contentType,
        req.sort,
        req.page || 1,
      );

      return {
        results: result.results.map((asset) => ({
          id: asset.id,
          title: asset.title,
          thumbnailUrl: asset.thumbnailUrl,
          downloads: 0,
          performanceScore: 0,
          downloadsPerMonth: 0,
          contentType: asset.contentType,
          categories: asset.categories,
          uploadDate: asset.uploadDate || new Date().toISOString(),
          contributorName: asset.contributorName,
          contributorId: asset.contributorId,
          isPremium: asset.isPremium,
          isAiGenerated: asset.isAiGenerated,
          keywords: asset.keywords,
          adobeStockUrl: asset.adobeStockUrl,
        })),
        totalResults: result.totalResults,
        dataQuality: "public_metadata",
        competitionLevel: "medium",
        aiSaturation: 0.5,
        contentBreakdown: [],
        providerName: "Adobe Stock (Public Metadata)",
      };
    } catch (error) {
      console.error("[officialAdobeProvider] Search failed:", error);
      throw new ProviderNoDataError(
        `Failed to fetch from Adobe Stock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  async contributor(): Promise<ProviderContributorResult> {
    throw new ProviderNotImplementedError(
      "Contributor search not yet implemented for official Adobe provider",
    );
  },

  async heatmap(): Promise<ProviderHeatmapResult> {
    throw new ProviderNotImplementedError(
      "Heat map not yet implemented for official Adobe provider",
    );
  },

  async trending(): Promise<ProviderTrendingResult> {
    throw new ProviderNotImplementedError(
      "Trending not yet implemented for official Adobe provider",
    );
  },

  async similar(): Promise<ProviderSimilarResult> {
    throw new ProviderNotImplementedError(
      "Similar image search not yet implemented for official Adobe provider",
    );
  },

  async dashboard(): Promise<ProviderDashboardResult> {
    throw new ProviderNotImplementedError(
      "Dashboard analytics not yet implemented for official Adobe provider",
    );
  },
};