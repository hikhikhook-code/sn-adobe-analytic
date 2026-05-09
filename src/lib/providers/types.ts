import type {
  AiFilter,
  ContentType,
  SearchAsset,
  SortMode,
} from "@/types/search";
import type { DatasetScope } from "@/lib/dataset-scope";

/**
 * How trustworthy is this data?
 *
 * - `demo`: synthetic / generated for showcase. Never claims to reflect real
 *   Adobe Stock numbers.
 * - `estimated`: derived from observable signals (e.g. a formula over public
 *   metadata). Not authoritative.
 * - `public_metadata`: scraped from publicly visible pages, untransformed.
 * - `verified`: direct from a first-party signed source (Adobe, the
 *   contributor's own export, etc.).
 */
export type DataQuality = "demo" | "estimated" | "public_metadata" | "verified";

export const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  demo: "Demo Data",
  estimated: "Estimated",
  public_metadata: "Public Metadata",
  verified: "Verified",
};

export const DATA_QUALITY_DESCRIPTIONS: Record<DataQuality, string> = {
  demo: "Synthetic data generated for demo purposes. Does not reflect real Adobe Stock metrics.",
  estimated: "Computed from observable signals. Approximate, not authoritative.",
  public_metadata: "Pulled directly from publicly visible Adobe Stock pages.",
  verified: "Sourced from a first-party signed feed (Adobe API or a contributor's own export).",
};

/**
 * Optional user-scoped context passed by the API layer. Providers that serve
 * per-user data (e.g. `manualImportProvider`) read this. Providers that don't
 * care (e.g. `mockProvider`) ignore it.
 *
 * `datasetScope` — when set, the manual provider narrows its query to that
 * scope. See `resolveDatasetScope` for how the caller computes it.
 */
export interface ProviderContext {
  userId?: string;
  datasetScope?: DatasetScope;
}

export interface ProviderSearchRequest {
  keyword: string;
  sort?: SortMode;
  contentType?: ContentType;
  aiFilter?: AiFilter;
  page?: number;
}

export interface ProviderSearchResult {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
  dataQuality: DataQuality;
  providerName: string;
}

export interface ProviderContributorResult {
  name: string;
  joinDate: string;
  totalAssets: number;
  totalDownloads: number;
  avgDownloads: number;
  bestAsset: { id: string; title: string; downloads: number };
  contentBreakdown: { type: string; count: number; pct: number }[];
  topKeywords: { keyword: string; count: number }[];
  monthlyTrend: { month: string; downloads: number }[];
  assets: SearchAsset[];
  dataQuality: DataQuality;
  providerName: string;
}

export interface HeatmapTile {
  keyword: string;
  downloads: number;
  assets: number;
  competition: number;
  trend: "up" | "down" | "stable";
}

export interface ProviderHeatmapResult {
  niches: HeatmapTile[];
  dataQuality: DataQuality;
  providerName: string;
}

export interface TrendingKeyword {
  keyword: string;
  volume: number;
  growth: number;
}

export interface ProviderTrendingResult {
  trending: TrendingKeyword[];
  dataQuality: DataQuality;
  providerName: string;
}

export interface DataProvider {
  /** Stable provider key (used in env var DATA_PROVIDER). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Quality tag attached to all data this provider returns. */
  readonly dataQuality: DataQuality;

  search(
    req: ProviderSearchRequest,
    ctx?: ProviderContext,
  ): Promise<ProviderSearchResult>;
  contributor(
    query: string,
    ctx?: ProviderContext,
  ): Promise<ProviderContributorResult>;
  heatmap(ctx?: ProviderContext): Promise<ProviderHeatmapResult>;
  trending(ctx?: ProviderContext): Promise<ProviderTrendingResult>;
}

/**
 * Thrown by providers that need a signed-in user (e.g. manualImportProvider)
 * but were called without one.
 */
export class ProviderRequiresUserError extends Error {
  constructor(providerId: string) {
    super(
      `Provider '${providerId}' requires a signed-in user. Falling back to the mock provider.`,
    );
    this.name = "ProviderRequiresUserError";
  }
}

/**
 * Thrown by providers that need data the user has not yet supplied (e.g.
 * manualImportProvider when the user hasn't uploaded any datasets yet).
 */
export class ProviderNoDataError extends Error {
  constructor(providerId: string, detail?: string) {
    super(
      `Provider '${providerId}' has no data yet${detail ? ` (${detail})` : ""}. Falling back to the mock provider.`,
    );
    this.name = "ProviderNoDataError";
  }
}

export class ProviderNotImplementedError extends Error {
  constructor(providerId: string) {
    super(
      `Provider '${providerId}' is not implemented. Falling back to the mock provider. ` +
        "See README for the data-provider roadmap.",
    );
    this.name = "ProviderNotImplementedError";
  }
}
