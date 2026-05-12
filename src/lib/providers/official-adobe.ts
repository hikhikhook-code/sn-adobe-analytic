import {
  DataProvider,
  SearchParams,
  SearchResult,
  ProviderNotImplementedError,
  ProviderNoDataError,
} from './index';
import { scrapeAdobeStockSearch } from './adobe-stock-scraper';

export const officialAdobeProvider: DataProvider = {
  name: 'official',
  displayName: 'Adobe Stock (Public Metadata)',
  description: 'Real-time data from Adobe Stock public pages',

  capabilities: {
    search: 'supported',
    portfolio: 'partial',
    heatmap: 'unsupported',
    trending: 'unsupported',
    similarImageSearch: 'unsupported',
    dashboardAnalytics: 'partial',
  },

  async search(params: SearchParams): Promise<SearchResult> {
    try {
      const result = await scrapeAdobeStockSearch(
        params.keyword,
        params.contentType,
        params.sort,
        params.page || 1,
      );

      return {
        totalResults: result.totalResults,
        results: result.results.map((asset) => ({
          id: asset.id,
          title: asset.title,
          thumbnailUrl: asset.thumbnailUrl,
          downloads: null, // Not available in public scrape
          performanceScore: null,
          downloadsPerMonth: null,
          contentType: asset.contentType,
          categories: asset.categories,
          uploadDate: asset.uploadDate,
          contributorName: asset.contributorName,
          contributorId: asset.contributorId,
          isPremium: asset.isPremium,
          isAiGenerated: asset.isAiGenerated,
          keywords: asset.keywords,
          adobeStockUrl: asset.adobeStockUrl,
          dataQuality: 'public_metadata',
          metricsAvailable: false, // Downloads/performance not available
        })),
        dataQuality: 'public_metadata',
        metricsAvailable: false,
      };
    } catch (error) {
      console.error('[officialAdobeProvider] Search failed:', error);
      throw new ProviderNoDataError(
        `Failed to fetch from Adobe Stock: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  },

  async portfolio(): Promise<SearchResult> {
    // Portfolio requires authenticated access to contributor data
    throw new ProviderNotImplementedError(
      'Portfolio search not supported for public metadata provider',
    );
  },

  async heatmap(): Promise<SearchResult> {
    throw new ProviderNotImplementedError(
      'Heat map not supported for public metadata provider',
    );
  },

  async trending(): Promise<SearchResult> {
    throw new ProviderNotImplementedError(
      'Trending not supported for public metadata provider',
    );
  },

  async similarImageSearch(): Promise<SearchResult> {
    throw new ProviderNotImplementedError(
      'Similar image search not supported for public metadata provider',
    );
  },

  async dashboardAnalytics() {
    return {
      totalAssets: null,
      totalDownloads: null,
      averagePerformance: null,
      topAssets: [],
      dataQuality: 'public_metadata',
      metricsAvailable: false,
      notice: 'Download and performance metrics are not available from public metadata',
    };
  },
};