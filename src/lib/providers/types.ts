import type {
  AiFilter,
  ContentType,
  SearchAsset,
  SimilarAsset,
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
  /**
   * Dashboard analytics rollup (top performers, content breakdown, keyword
   * highlights, trending widget data). When `partial`, the provider will
   * still return a result envelope but most metric-availability flags will
   * be `false` and the UI must render `Unavailable` instead of fake zeroes.
   */
  dashboard: ProviderFeatureSupport;
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

/**
 * PRD §5.3 Heat Map filters. All values are honored by the provider —
 * no UI-only filtering. Defaults are applied server-side so the
 * `appliedFilters` echo always shows what actually ran.
 */
export type HeatmapPeriod = "7d" | "30d" | "90d" | "1y" | "all";

/**
 * Sort dimensions for the niche grid. Mirrors the PRD's four signals.
 * `opportunity` is the default — it surfaces high-demand / low-competition
 * niches first, which is the page's whole reason for existing.
 */
export type HeatmapSort = "opportunity" | "demand" | "competition" | "trend";

/**
 * Heatmap content-type filter. Same vocabulary as `SearchAsset.contentType`
 * plus an explicit `"all"` (default) and `"other"` bucket so the UI can
 * show everything that doesn't match a known category.
 */
export type HeatmapContentType =
  | "all"
  | "photo"
  | "illustration"
  | "vector"
  | "video"
  | "template"
  | "3d"
  | "other";

export interface HeatmapFilters {
  contentType?: HeatmapContentType;
  period?: HeatmapPeriod;
  /** Minimum downloads (or imported demand signal) for a niche to qualify. */
  minDownloads?: number;
  sort?: HeatmapSort;
  /**
   * When set, the provider returns a single-tile detail response with
   * `topAssets` + `relatedKeywords` populated. Used by the niche detail
   * drawer.
   */
  niche?: string;
}

export interface HeatmapTile {
  keyword: string;
  /** Total downloads for this niche across the matching asset set. */
  downloads: number;
  /** Total asset count contributing to this niche. */
  assets: number;
  /** Competition score 0..100 — higher = more crowded. */
  competition: number;
  /** Direction of recent demand vs prior period. */
  trend: "up" | "down" | "stable";
  /**
   * Opportunity score 0..100 — higher = better opportunity. Combines demand,
   * inverse competition, average performance, and trend. Always present so
   * the UI never has to compute it client-side.
   */
  opportunityScore: number;
  /**
   * Average performance score 0..100 across niche assets. `0` when not
   * available — pair with `metricsAvailable` to know whether to render `—`.
   */
  avgPerformanceScore: number;
  /** Per-content-type asset count for the niche. */
  contentTypeBreakdown: { contentType: string; count: number }[];
  /**
   * Top related keywords (co-occurring with this niche). Empty when this
   * tile is part of a grid response — only populated for niche-detail mode.
   */
  relatedKeywords: string[];
  /**
   * Top-performing assets in this niche, ordered desc by downloads (or
   * performance score when downloads aren't available). Empty in grid
   * mode; populated in niche-detail mode.
   */
  topAssets: SearchAsset[];
  /**
   * `true` when downloads / avg performance are sourced from real user
   * imports or demo data. `false` from public-metadata sources that don't
   * expose verified numbers — UI must render `Unavailable`.
   */
  metricsAvailable: boolean;
  /**
   * `true` when the trend signal is reliable (≥ 1 datapoint in both the
   * current and prior window). `false` when we can't compute it — UI
   * should show `Unavailable` or hide the trend chip.
   */
  trendAvailable: boolean;
}

export interface ProviderHeatmapResult extends ProviderResultEnvelope {
  niches: HeatmapTile[];
  /** Echo of the filters the server actually applied (after defaults). */
  appliedFilters: HeatmapFilters;
  /**
   * `true` when the response represents a niche-detail drilldown rather
   * than a grid. Lets the API layer skip metadata work the grid doesn't
   * need.
   */
  detail?: boolean;
}

/**
 * PRD §5.8 Trending filters. All values are honored by the provider — no
 * UI-only filtering. Defaults are applied server-side so `appliedFilters`
 * always echoes what actually ran.
 */
export type TrendingPeriod = "7d" | "30d" | "90d" | "1y";
export type TrendingSort = "growth" | "volume";
export type TrendingContentType =
  | "all"
  | "photo"
  | "illustration"
  | "vector"
  | "video"
  | "template"
  | "3d"
  | "other";

export interface TrendingFilters {
  period?: TrendingPeriod;
  contentType?: TrendingContentType;
  /** Minimum search volume / total downloads for a keyword to qualify. */
  minVolume?: number;
  sort?: TrendingSort;
  /** Cap on items returned per section. Defaults to 12. */
  limit?: number;
}

export interface TrendingKeyword {
  keyword: string;
  /** Search-volume signal. Synthesized for mock; total downloads for manual. */
  volume: number;
  /** Growth % current period vs previous. */
  growth: number;
  /** `false` when the underlying figures are not derivable; UI must render
   *  `Unavailable` rather than fake zeros. Defaults to `true`. */
  metricsAvailable?: boolean;
}

export interface RisingNiche {
  keyword: string;
  downloads: number;
  assets: number;
  growth: number;
  /** 0..100, higher = more crowded. */
  competition: number;
  metricsAvailable?: boolean;
}

export interface TopPerformer {
  asset: SearchAsset;
  /** Downloads attributed to the active period (manual: filtered by
   *  uploadDate; mock: synthesized). */
  recentDownloads: number;
}

export interface SeasonalTrend {
  keyword: string;
  /** Calendar month (0-11) where this keyword historically peaks. */
  peakMonth: number;
  /** Multiplier of peak-month downloads vs avg month. ≥ 1 means the
   *  keyword has a real spike at peak. */
  peakLift: number;
  /** Where we are vs the peak in the calendar year. */
  status: "in_season" | "approaching" | "off_season";
  /** `false` when we couldn't derive a seasonal signal honestly (e.g. not
   *  enough months of data). UI must label `Unavailable` and not render
   *  the lift number. */
  available: boolean;
}

export interface ProviderTrendingResult extends ProviderResultEnvelope {
  trending: TrendingKeyword[];
  risingNiches: RisingNiche[];
  topPerformers: TopPerformer[];
  seasonal: SeasonalTrend[];
  /** Echo of the filters the server actually applied (after defaults). */
  appliedFilters: TrendingFilters;
}

/**
 * Dashboard analytics — provider-derived rollup served by
 * `GET /api/dashboard`. Intentionally returns *only* analytics fields the
 * provider can derive itself; account-wide counters (searches today,
 * exports made, saved-asset count, recent searches) are layered on top by
 * the API route from the database, regardless of provider.
 *
 * Every metric ships with an `*Available` companion so the UI can render
 * `Unavailable` instead of fake zeroes when a provider can't honestly
 * derive the figure (e.g. official public-metadata source has no verified
 * download counts).
 */
export interface DashboardKeywordHighlight {
  keyword: string;
  /** Number of assets in scope tagged with this keyword. */
  assets: number;
  /** Total downloads attributed to assets with this keyword. */
  downloads: number;
  /** `false` when downloads are not derivable from the active provider. */
  metricsAvailable: boolean;
}

export interface ProviderDashboardResult extends ProviderResultEnvelope {
  /** Total assets in the active dataset scope (manual: imported assets;
   *  mock: 0; official: not derivable). */
  importedAssets: number;
  importedAssetsAvailable: boolean;

  /** Sum of downloads across the active scope. */
  totalDownloads: number;
  totalDownloadsAvailable: boolean;

  /** Mean performance score (0..100) across in-scope assets. */
  averagePerformanceScore: number;
  averagePerformanceScoreAvailable: boolean;

  /** Per-content-type asset counts + percentages. */
  contentBreakdown: { type: string; count: number; pct: number }[];
  contentBreakdownAvailable: boolean;

  /** Top performing assets in the active scope, ranked by downloads. */
  topPerformers: TopPerformer[];
  topPerformersAvailable: boolean;

  /** Top keywords by frequency / download volume in the active scope. */
  keywordHighlights: DashboardKeywordHighlight[];
  keywordHighlightsAvailable: boolean;

  /** Trending keywords widget data (subset of `/trending` for the
   *  dashboard widget). */
  trendingKeywords: TrendingKeyword[];
  trendingKeywordsAvailable: boolean;
}

/**
 * PRD §5 Similar Image Search request. The PRD scope intentionally rules
 * out real visual AI / pixel hashing for this PR — providers receive only
 * the textual signal we can derive from the upload (URL, filename, hint).
 * The image bytes themselves never reach the provider, so we cannot
 * accidentally claim a real visual match.
 */
export interface ProviderSimilarRequest {
  imageUrl?: string;
  imageFileName?: string;
  hint?: string;
  contentType?: ContentType;
  aiFilter?: AiFilter;
  page?: number;
  /** Pre-tokenized query bag computed by the route handler so providers
   *  don't redo the same regex work. Empty array → no textual signal. */
  queryTokens: string[];
}

export interface ProviderSimilarResult extends ProviderResultEnvelope {
  totalResults: number;
  results: SimilarAsset[];
  /** Echo of the tokens the provider actually scored against. May be
   *  empty when the provider couldn't derive any (e.g. official with no
   *  configured source). */
  queryTokens: string[];
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
  heatmap(
    ctx?: ProviderContext,
    filters?: HeatmapFilters,
  ): Promise<ProviderHeatmapResult>;
  trending(
    ctx?: ProviderContext,
    filters?: TrendingFilters,
  ): Promise<ProviderTrendingResult>;
  similar(
    req: ProviderSimilarRequest,
    ctx?: ProviderContext,
  ): Promise<ProviderSimilarResult>;
  /**
   * Dashboard rollup — top performers, content breakdown, keyword
   * highlights, trending widget data. Account-wide counters (search
   * history, exports, favorites) are NOT a provider concern; the API
   * layer queries the DB directly for those.
   */
  dashboard(ctx?: ProviderContext): Promise<ProviderDashboardResult>;
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
