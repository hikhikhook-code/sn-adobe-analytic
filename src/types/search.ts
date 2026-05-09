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

export interface SearchAsset {
  id: string;
  thumbnailUrl: string;
  title: string;
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
}

export interface SearchResponse {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
  page: number;
  pageSize: number;
}

export interface SearchRequest {
  keyword: string;
  sort?: SortMode;
  contentType?: ContentType;
  aiFilter?: AiFilter;
  page?: number;
}
