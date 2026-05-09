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
 * Per-feature support level. Drives the "Coming Soon" / "Provider not
 * supported" UI hints so users always know what the active provider can
 * actually deliver.
 *
 * - `supported`:    provider can fully serve the feature.
 * - `partial`:      provider can serve some fields (e.g. metadata only,
 *                   no download counts). UI should still render but mark
 *                   missing figures as `Unavailable`.
 * - `unsupported`:  provider cannot serve this feature. Caller should fall
 *                   back to another provider or show a "Coming Soon" notice.
 */
export type ProviderFeatureSupport = "supported" | "partial" | "unsupported";

/**
 * Static capabilities map for a provider. Read by the API layer so the
 * client can render correct affordances without round-tripping through
 * a search call first.
 */
export interface ProviderCapabilities {
  /** Keyword search by title/keywords/categories. */
  search: ProviderFeatureSupport;
  /** Contributor / portfolio lookup. */
  contributor: ProviderFeatureSupport;
  /** Niche heatmap aggregation. */
  heatmap: ProviderFeatureSupport;
  /** Trending keyword discovery. */
  trending: ProviderFeatureSupport;
  /** Reverse / similar image search. */
  similarImage: ProviderFeatureSupport;
  /** Whether this provider can return verified download counts. When
   *  `false`, results should set `metricsAvailable: false` and the UI
   *  must render `Unavailable` instead of fake zeroes. */
  downloadsAvailable: boolean;
}

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

/**
 * Common envelope fields shared across every provider response. Lets the
 * UI render the same banner / notice / capability machinery regardless of
 * which provider answered.
 */
export interface ProviderResultEnvelope {
  dataQuality: DataQuality;
  providerName: string;
  /** Stable provider key matching `DataProvider.id` (mock | manual | official). */
  providerId?: string;
  /** Capabilities of the provider that produced this response. */
  capabilities?: ProviderCapabilities;
  /**
   * Optional human-readable message describing limitations of this
   * response — e.g. "Public metadata source not configured" or
   * "Downloads unavailable from this source". Surfaced verbatim in the UI.
   */
  notice?: string;
}

export interface ProviderSearchResult extends ProviderResultEnvelope {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
}

export interface ProviderContributorResult extends ProviderResultEnvelope {
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
}

export interface HeatmapTile {
  keyword: string;
  downloads: number;
  assets: number;
  competition: number;
  trend: "up" | "down" | "stable";
}

export interface ProviderHeatmapResult extends ProviderResultEnvelope {
  niches: HeatmapTile[];
}

export interface TrendingKeyword {
  keyword: string;
  volume: number;
  growth: number;
}

export interface ProviderTrendingResult extends ProviderResultEnvelope {
  trending: TrendingKeyword[];
}

export interface DataProvider {
  /** Stable provider key (used in env var DATA_PROVIDER). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Quality tag attached to all data this provider returns. */
  readonly dataQuality: DataQuality;
  /** Static capability map — what features this provider can serve. */
  readonly capabilities: ProviderCapabilities;

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

/**
 * Thrown by a provider that intentionally does not implement a particular
 * feature (e.g. the public-metadata provider has no Similar Image Search).
 * The runProvider() wrapper treats this the same as NotImplemented and
 * falls back to mock; the API layer can also surface it as a "Coming Soon"
 * hint when paired with `capabilities[feature] === "unsupported"`.
 */
export class ProviderFeatureUnsupportedError extends Error {
  readonly feature: keyof ProviderCapabilities;
  constructor(providerId: string, feature: keyof ProviderCapabilities) {
    super(
      `Provider '${providerId}' does not support feature '${String(feature)}'. ` +
        "Falling back to the mock provider.",
    );
    this.name = "ProviderFeatureUnsupportedError";
    this.feature = feature;
  }
}

/**
 * Thrown by a provider that requires external configuration (e.g. an API
 * base URL or key) that hasn't been set. The runProvider() wrapper treats
 * this like NotImplemented and falls back to the mock provider so the app
 * stays usable even before the operator has wired up real credentials.
 */
export class ProviderNotConfiguredError extends Error {
  constructor(providerId: string, detail?: string) {
    super(
      `Provider '${providerId}' is not configured${detail ? ` (${detail})` : ""}. ` +
        "Falling back to the mock provider.",
    );
    this.name = "ProviderNotConfiguredError";
  }
}
