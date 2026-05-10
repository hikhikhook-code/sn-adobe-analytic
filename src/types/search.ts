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

/**
 * A search result paired with a metadata-similarity score.
 *
 * `similarityScore` is 0..100. The PRD calls for source-aware labeling:
 * mock provider tags the response `Demo Data`, manual provider tags it
 * `Estimated` (we ranked imported assets by metadata overlap, not pixels),
 * and the official provider returns no rows.
 *
 * `similarityAvailable` is `false` only when we genuinely could not
 * compute a score (e.g. the request had no URL/filename/hint and we
 * never saw a URL match). The UI must render `Unavailable` rather than
 * fake a zero.
 */
export interface SimilarAsset extends SearchAsset {
  similarityScore: number;
  similarityAvailable?: boolean;
}

export interface SimilarSearchRequest {
  /** Public URL of the image the user is looking up. */
  imageUrl?: string;
  /** Original filename when the user uploaded a file (we tokenize it). */
  imageFileName?: string;
  /** Optional free-text hint describing the image. */
  hint?: string;
  contentType?: ContentType;
  aiFilter?: AiFilter;
  page?: number;
}

export interface SimilarSearchResponse {
  totalResults: number;
  results: SimilarAsset[];
  page: number;
  pageSize: number;
  dataQuality: DataQuality;
  providerName: string;
  providerId?: string;
  /** Provider-aware notice (e.g. "Similar Image Search is unsupported by this provider."). */
  notice?: string;
  /** Tokens we mined from the request — surfaced in the UI so users see
   *  exactly what we matched against. */
  queryTokens: string[];
  /** Echo of the resolved input so the UI can label its preview. */
  query: {
    imageUrl?: string;
    imageFileName?: string;
    hint?: string;
  };
}
