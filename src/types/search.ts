export type ContentType =
  | "all"
  | "photo"
  | "illustration"
  | "vector"
  | "video"
  | "template"
  | "3d";

export type SortMode =
  | "relevance"
  | "newest"
  | "featured"
  | "most_downloaded"
  | "undiscovered";

export type AiFilter = "all" | "ai_only" | "exclude_ai";

export type DataQuality = "demo" | "estimated" | "public_metadata" | "verified";

export interface SearchAsset {
  id: string;
  thumbnailUrl: string;
  title: string;
  /**
   * Download count from the data source. May be `0` when the source does
   * not expose verified downloads (e.g. public-metadata sources). Pair with
   * `metricsAvailable` to know whether to render the number or "—".
   */
  downloads: number;
  performanceScore: number;
  downloadsPerMonth: number;
  categories: string[];
  contentType: string;
  uploadDate: string;
  contributorName: string;
  contributorId: string;
  isPremium: boolean;
  isAiGenerated: boolean;
  keywords: string[];
  adobeStockUrl: string;
  /**
   * When `false`, the source did not provide verified download / performance
   * metrics for this asset. UI must render `Unavailable` (or "—") instead of
   * the raw `0` so we never imply we have a real Adobe download number.
   * Defaults to `true` for back-compat with mock and user-imported data.
   */
  metricsAvailable?: boolean;
}

export interface SearchResponse {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
  page: number;
  pageSize: number;
  dataQuality: DataQuality;
  providerName: string;
  /** Provider key (mock | manual | official). Optional for older callers. */
  providerId?: string;
  /** Optional human-readable banner ("Public metadata source not configured"). */
  notice?: string;
}

export interface SearchRequest {
  keyword: string;
  sort?: SortMode;
  contentType?: ContentType;
  aiFilter?: AiFilter;
  page?: number;
}
