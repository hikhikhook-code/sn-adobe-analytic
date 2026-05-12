import type {
  DataProvider,
  HeatmapFilters,
  ProviderCapabilities,
  ProviderContributorResult,
  ProviderContext,
  ProviderDashboardResult,
  ProviderHeatmapResult,
  ProviderResultEnvelope,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderSimilarRequest,
  ProviderSimilarResult,
  ProviderTrendingResult,
  TrendingFilters,
} from "./types";
import {
  ProviderFeatureUnsupportedError,
  ProviderNotImplementedError,
} from "./types";
import { scrapeContributorProfile, scrapeContributorAssets } from "./contributor-scraper";

const PROVIDER_ID = "live-scraper";
const PROVIDER_NAME = "Live Scraper";

const CAPABILITIES: ProviderCapabilities = {
  search: "unsupported",
  contributor: "supported",
  heatmap: "unsupported",
  trending: "unsupported",
  similarImage: "unsupported",
  dashboard: "unsupported",
  downloadsAvailable: false,
};

export const liveScraperProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "public_metadata",
  capabilities: CAPABILITIES,

  async search(): Promise<ProviderSearchResult> {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "search");
  },

  async contributor(
    query: string,
    _ctx?: ProviderContext,
  ): Promise<ProviderContributorResult> {
    try {
      // Extract contributor ID from query (could be ID or name)
      const contributorId = query.trim();
      
      const profile = await scrapeContributorProfile(contributorId);
      if (!profile) {
        throw new Error(`Could not find contributor: ${query}`);
      }

      const assets = await scrapeContributorAssets(contributorId);

      return {
        name: profile.name,
        joinDate: profile.joinDate || new Date().toISOString().split("T")[0],
        totalAssets: profile.totalAssets,
        totalDownloads: 0, // Not available from scraper
        avgDownloads: 0, // Not available from scraper
        bestAsset: {
          id: "",
          title: "N/A",
          downloads: 0,
        },
        contentBreakdown: [],
        topKeywords: profile.topCategories.map((cat) => ({
          keyword: cat,
          count: 0,
        })),
        monthlyTrend: [],
        assets: assets.map((a) => ({
          id: a.id,
          title: a.title,
          thumbnail: a.thumbnail,
          contentType: a.contentType,
          downloads: 0,
          metricsAvailable: false,
        })),
        dataQuality: "public_metadata",
        providerName: PROVIDER_NAME,
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        notice:
          "Contributor data scraped from public Adobe Stock pages. " +
          "Download counts and detailed analytics are not available.",
      };
    } catch (error) {
      throw new ProviderNotImplementedError(PROVIDER_ID);
    }
  },

  async heatmap(): Promise<ProviderHeatmapResult> {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "heatmap");
  },

  async trending(): Promise<ProviderTrendingResult> {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "trending");
  },

  async similar(): Promise<ProviderSimilarResult> {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "similarImage");
  },

  async dashboard(): Promise<ProviderDashboardResult> {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "dashboard");
  },
};
