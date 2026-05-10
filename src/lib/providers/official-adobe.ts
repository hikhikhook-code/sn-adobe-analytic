import { calculateCompetitionLevel } from "@/lib/scoring";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import type {
  AiFilter,
  ContentType,
  SearchAsset,
  SortMode,
} from "@/types/search";
import { ProviderFeatureUnsupportedError } from "./types";
import type {
  DataProvider,
  ProviderCapabilities,
  ProviderContributorResult,
  ProviderDashboardResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderSimilarRequest,
  ProviderSimilarResult,
} from "./types";

/**
 * Public-metadata / "official" data provider.
 *
 * This provider is the clean integration boundary for an authoritative or
 * public-metadata source — for example:
 *   - The Adobe Stock Search API (when contributor analytics endpoints
 *     become available to your tenant).
 *   - A Cloudflare Worker / proxy you operate that mirrors public Adobe
 *     Stock pages with respect to robots.txt + rate limits.
 *   - A first-party signed analytics export (`dataQuality: "verified"`).
 *
 * It intentionally does NOT include any of:
 *   - private/internal Adobe APIs
 *   - proxy rotation
 *   - user-agent evasion
 *   - anti-bot bypass
 *   - direct scraping that ignores rate limits or robots.txt
 *
 * Until `OFFICIAL_PROVIDER_BASE_URL` is configured the provider returns
 * empty, honestly-labeled responses (with `notice` and
 * `metricsAvailable: false`). Operators wire it up by:
 *   1. Standing up an HTTP service that maps to {@link OfficialPublicEndpoints}.
 *   2. Setting `OFFICIAL_PROVIDER_BASE_URL` and (optionally)
 *      `OFFICIAL_PROVIDER_API_KEY`.
 *   3. Setting `DATA_PROVIDER=official` (or letting per-user auto-promotion
 *      pick it up).
 *
 * The provider tags every response as `dataQuality: "public_metadata"`.
 * Promote to `verified` only when wiring it to a first-party signed feed
 * (see README §"Data quality").
 */

const PROVIDER_ID = "official";
const PROVIDER_NAME = "Public Metadata Provider";
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Capability map. The provider can serve search + contributor metadata as
 * soon as it's configured. Heatmap / trending / similar-image require
 * server-side aggregation we don't expose yet — those fall back to manual
 * (when the user has imported data) or mock.
 */
const CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  contributor: "partial",
  heatmap: "unsupported",
  trending: "unsupported",
  similarImage: "unsupported",
  // Dashboard rollup needs per-user portfolio analytics (downloads,
  // performance, content breakdown) that public-metadata pages do not
  // expose. We return an honest "partial" envelope instead of throwing
  // so the UI can render `Unavailable` placeholders rather than
  // silently substituting demo data.
  dashboard: "partial",
  // Public pages do not expose verified download numbers. UI renders
  // `Unavailable` for downloads / performance / downloadsPerMonth on every
  // result this provider returns.
  downloadsAvailable: false,
};

interface OfficialProviderConfig {
  baseUrl: string;
  apiKey?: string;
}

function readConfig(): OfficialProviderConfig | null {
  const baseUrl = process.env.OFFICIAL_PROVIDER_BASE_URL?.trim();
  if (!baseUrl) return null;
  // Strip trailing slash so we can append `/search` etc. cleanly.
  const normalized = baseUrl.replace(/\/+$/, "");
  const apiKey = process.env.OFFICIAL_PROVIDER_API_KEY?.trim() || undefined;
  return { baseUrl: normalized, apiKey };
}

/**
 * Shape we expect from the configured public-metadata endpoint. Keeping it
 * narrow + Adobe-shaped so a thin adapter can sit in front of any source
 * (Adobe Stock Search API, mirror, signed feed, …).
 */
export interface OfficialPublicEndpoints {
  /**
   * `GET ${baseUrl}/search?keyword=...&contentType=...&sort=...&page=...`
   *
   * Returns `{ totalResults, results: PublicAsset[] }`. The asset shape
   * mirrors the PRD's documented search response. Numeric download fields
   * are OPTIONAL — sources that can only return metadata should omit them
   * and rely on `metricsAvailable: false` in the rendered card.
   */
  search: never;
  /**
   * `GET ${baseUrl}/contributor?query=...`
   *
   * Returns minimal contributor metadata. Aggregations (avg, best, monthly
   * trend) are computed client-side from the asset list when present.
   */
  contributor: never;
}

interface PublicAsset {
  id: string;
  thumbnailUrl?: string;
  title?: string;
  downloads?: number;
  contentType?: string;
  categories?: string[];
  uploadDate?: string;
  contributorName?: string;
  contributorId?: string;
  isPremium?: boolean;
  isAiGenerated?: boolean;
  keywords?: string[];
  adobeStockUrl?: string;
}

interface PublicSearchPayload {
  totalResults?: number;
  results?: PublicAsset[];
}

interface PublicContributorPayload {
  name?: string;
  id?: string;
  joinDate?: string;
  totalAssets?: number;
  assets?: PublicAsset[];
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  // Best-effort cleanup; runtime will also clear via AbortSignal cleanup.
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer), {
    once: true,
  });
  return ctrl.signal;
}

async function fetchJson<T>(url: string, cfg: OfficialProviderConfig): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: withTimeout(undefined, FETCH_TIMEOUT_MS),
    // Don't cache through Next's data cache by default — analytics views
    // want fresh data, and a cached "endpoint not reachable" reply would
    // be worse than a fresh failure.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `Public-metadata provider returned HTTP ${res.status} for ${url}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Hydrate a raw public asset into our SearchAsset shape. Missing numeric
 * fields are zero-filled BUT `metricsAvailable` is set to `false` so the UI
 * never claims the zero is a real Adobe download number.
 */
function toSearchAsset(raw: PublicAsset): SearchAsset {
  return {
    id: raw.id,
    thumbnailUrl: raw.thumbnailUrl ?? "",
    title: raw.title ?? "(untitled)",
    downloads: typeof raw.downloads === "number" ? raw.downloads : 0,
    performanceScore: 0,
    downloadsPerMonth: 0,
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    contentType: raw.contentType ?? "unknown",
    uploadDate: raw.uploadDate ?? new Date(0).toISOString(),
    contributorName: raw.contributorName ?? "(unknown contributor)",
    contributorId: raw.contributorId ?? "",
    isPremium: Boolean(raw.isPremium),
    isAiGenerated: Boolean(raw.isAiGenerated),
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    // PR #19: normalize `/id/` -> `/uk/` on any provider URL that
    // carries the misleading Indonesian locale prefix. See
    // src/lib/adobe-stock-link.ts for the rationale.
    adobeStockUrl:
      normalizeAdobeStockUrl(raw.adobeStockUrl) ?? raw.adobeStockUrl ?? "",
    metricsAvailable: false,
  };
}

function buildSearchUrl(
  cfg: OfficialProviderConfig,
  req: ProviderSearchRequest,
): string {
  const url = new URL(`${cfg.baseUrl}/search`);
  url.searchParams.set("keyword", req.keyword);
  if (req.contentType && req.contentType !== "all") {
    url.searchParams.set("contentType", req.contentType);
  }
  if (req.sort && req.sort !== "relevance") {
    url.searchParams.set("sort", req.sort);
  }
  if (req.aiFilter && req.aiFilter !== "all") {
    url.searchParams.set("aiFilter", req.aiFilter);
  }
  url.searchParams.set("page", String(req.page ?? 1));
  url.searchParams.set("pageSize", String(RESULTS_PER_PAGE));
  return url.toString();
}

function emptySearchResult(notice: string): ProviderSearchResult {
  return {
    totalResults: 0,
    competitionLevel: "low",
    aiSaturation: 0,
    contentBreakdown: [],
    results: [],
    dataQuality: "public_metadata",
    providerName: PROVIDER_NAME,
    providerId: PROVIDER_ID,
    capabilities: CAPABILITIES,
    notice,
  };
}

function emptyContributorResult(
  query: string,
  notice: string,
): ProviderContributorResult {
  return {
    name: query,
    joinDate: new Date(0).toISOString(),
    totalAssets: 0,
    totalDownloads: 0,
    avgDownloads: 0,
    bestAsset: { id: "", title: "(no assets)", downloads: 0 },
    contentBreakdown: [],
    topKeywords: [],
    monthlyTrend: [],
    assets: [],
    dataQuality: "public_metadata",
    providerName: PROVIDER_NAME,
    providerId: PROVIDER_ID,
    capabilities: CAPABILITIES,
    notice,
  };
}

export const officialAdobeProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  // We tag this provider as `public_metadata` (NOT `verified`). Operators
  // wiring it to a signed first-party feed should override the data-quality
  // tag at that integration's adapter layer.
  dataQuality: "public_metadata",
  capabilities: CAPABILITIES,

  async search(req: ProviderSearchRequest) {
    const cfg = readConfig();
    if (!cfg) {
      // Don't throw — return an empty, honestly-labeled response so the
      // UI can render the search page without falling all the way back
      // to mock data. The caller (runProvider) will keep this and not
      // substitute mock results for an `official` request.
      return emptySearchResult(
        "Public-metadata source not configured. Set OFFICIAL_PROVIDER_BASE_URL " +
          "to point this provider at your authorized public-metadata endpoint.",
      );
    }

    const url = buildSearchUrl(cfg, req);
    const payload = await fetchJson<PublicSearchPayload>(url, cfg);
    const results = (payload.results ?? []).map(toSearchAsset);
    const total = payload.totalResults ?? results.length;

    // Keep the AI saturation + breakdown computations the same as
    // mock/manual so downstream UI doesn't special-case providers.
    const aiCount = results.filter((r) => r.isAiGenerated).length;
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.contentType] = (counts[r.contentType] ?? 0) + 1;
    }

    const filtered = applyClientFilters(results, {
      contentType: req.contentType,
      aiFilter: req.aiFilter,
    });
    const sorted = applyClientSort(filtered, req.sort);

    return {
      totalResults: total,
      competitionLevel: calculateCompetitionLevel(total),
      aiSaturation: results.length
        ? Math.round((aiCount / results.length) * 100)
        : 0,
      contentBreakdown: Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      results: sorted,
      dataQuality: "public_metadata",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      // Always remind the caller that downloads aren't verified from
      // this source. The result-card handles the per-figure label too.
      notice:
        "Downloads and performance scores are not available from this source. " +
        "Numbers shown elsewhere are derived only from public metadata.",
    } satisfies ProviderSearchResult;
  },

  async contributor(query: string) {
    const cfg = readConfig();
    if (!cfg) {
      // Return a partial-supported state instead of falling all the way
      // back to fake mock data. The PRD explicitly asks: "If full
      // contributor data is unavailable, show partial supported state,
      // not fake data."
      return emptyContributorResult(
        query,
        "Public-metadata source not configured. Set OFFICIAL_PROVIDER_BASE_URL " +
          "to point this provider at your authorized public-metadata endpoint.",
      );
    }
    const url = new URL(`${cfg.baseUrl}/contributor`);
    url.searchParams.set("query", query);
    const payload = await fetchJson<PublicContributorPayload>(
      url.toString(),
      cfg,
    );
    const assets = (payload.assets ?? []).map(toSearchAsset);
    const totalDownloads = assets.reduce((s, a) => s + a.downloads, 0);
    const best =
      assets.length > 0
        ? [...assets].sort((a, b) => b.downloads - a.downloads)[0]
        : { id: "", title: "(no assets)", downloads: 0 };
    const breakdownMap = new Map<string, number>();
    for (const a of assets) {
      breakdownMap.set(a.contentType, (breakdownMap.get(a.contentType) ?? 0) + 1);
    }
    const contentBreakdown = Array.from(breakdownMap.entries())
      .map(([type, count]) => ({
        type,
        count,
        pct: assets.length
          ? Math.round((count / assets.length) * 100)
          : 0,
      }))
      .sort((a, b) => b.count - a.count);
    const kwFreq = new Map<string, number>();
    for (const a of assets) {
      for (const k of a.keywords) kwFreq.set(k, (kwFreq.get(k) ?? 0) + 1);
    }
    const topKeywords = Array.from(kwFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([keyword, count]) => ({ keyword, count }));
    return {
      name: payload.name ?? query,
      joinDate: payload.joinDate ?? new Date(0).toISOString(),
      totalAssets: payload.totalAssets ?? assets.length,
      totalDownloads,
      avgDownloads: assets.length
        ? Math.round(totalDownloads / assets.length)
        : 0,
      bestAsset: { id: best.id, title: best.title, downloads: best.downloads },
      contentBreakdown,
      topKeywords,
      // Monthly trend cannot be reliably reconstructed from public metadata
      // (uploadDate ≠ download timing). Return an empty array and let the
      // UI render the partial-support state.
      monthlyTrend: [],
      assets,
      dataQuality: "public_metadata",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      notice:
        "Contributor analytics from a public-metadata source are partial: " +
        "download history and verified totals are not available.",
    } satisfies ProviderContributorResult;
  },

  async heatmap() {
    // Niche heatmap requires aggregated download data we don't have from
    // public metadata. Treat as unsupported so runProvider falls back to
    // the manual provider (when the user has imports) or mock.
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "heatmap");
  },

  async trending() {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "trending");
  },

  async dashboard() {
    // Public-metadata sources do not expose user-portfolio analytics.
    // We deliberately RETURN an honestly-labeled empty response (rather
    // than throw `ProviderFeatureUnsupportedError`) so the UI can show
    // the `Unavailable` state when the user explicitly chose
    // `DATA_PROVIDER=official`, instead of silently substituting demo
    // numbers. The mock and manual providers serve users who haven't
    // pinned `official`.
    const cfg = readConfig();
    return {
      importedAssets: 0,
      importedAssetsAvailable: false,
      totalDownloads: 0,
      totalDownloadsAvailable: false,
      averagePerformanceScore: 0,
      averagePerformanceScoreAvailable: false,
      contentBreakdown: [],
      contentBreakdownAvailable: false,
      topPerformers: [],
      topPerformersAvailable: false,
      keywordHighlights: [],
      keywordHighlightsAvailable: false,
      trendingKeywords: [],
      trendingKeywordsAvailable: false,
      dataQuality: "public_metadata",
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      capabilities: CAPABILITIES,
      notice: cfg
        ? "Dashboard portfolio analytics are not available from a public-metadata source. " +
          "Verified download counts and per-user performance figures require a first-party " +
          "signed feed or an imported CSV."
        : "Public-metadata source not configured. Dashboard analytics are unavailable; " +
          "set OFFICIAL_PROVIDER_BASE_URL or import a CSV to populate this page.",
    } satisfies ProviderDashboardResult;
  },

  async similar(req: ProviderSimilarRequest) {
    // Public-metadata sources do not expose a verified "similar image"
    // endpoint, and we will not fake one. Per the PRD: "If official/public
    // provider does not support similar image search yet, return
    // Unsupported/Unavailable with a clear notice. Do not fake official
    // visual search."
    //
    // We deliberately RETURN an honestly-labeled empty response (rather
    // than throw `ProviderFeatureUnsupportedError`) so the UI can show the
    // "unsupported" state when the user explicitly chose `DATA_PROVIDER=official`,
    // instead of silently substituting demo results. The mock and manual
    // providers serve users who haven't pinned `official`.
    return {
      totalResults: 0,
      results: [],
      queryTokens: req.queryTokens,
      dataQuality: "public_metadata",
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      capabilities: CAPABILITIES,
      notice:
        "Similar Image Search is not available from this public-metadata source. " +
        "No internal Adobe APIs or scrapers are used \u2014 switch to the demo or imported-data provider for similarity ranking.",
    } satisfies ProviderSimilarResult;
  },
};

// ---------------------------------------------------------------------------
// Local helpers (filter + sort) — kept here so a future implementation can
// optimize them server-side without touching the mock or manual provider.
// ---------------------------------------------------------------------------

function applyClientFilters(
  results: SearchAsset[],
  req: { contentType?: ContentType; aiFilter?: AiFilter },
): SearchAsset[] {
  let out = results;
  if (req.contentType && req.contentType !== "all") {
    out = out.filter((r) => r.contentType === req.contentType);
  }
  if (req.aiFilter === "ai_only") out = out.filter((r) => r.isAiGenerated);
  if (req.aiFilter === "exclude_ai") out = out.filter((r) => !r.isAiGenerated);
  return out;
}

function applyClientSort(
  results: SearchAsset[],
  sort?: SortMode,
): SearchAsset[] {
  const out = [...results];
  switch (sort) {
    case "newest":
      return out.sort(
        (a, b) =>
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
      );
    case "most_downloaded":
      // No-op when downloads are unavailable — we keep server order.
      return out.sort((a, b) => b.downloads - a.downloads);
    case "featured":
      return out.sort((a, b) => Number(b.isPremium) - Number(a.isPremium));
    case "undiscovered":
    case "relevance":
    default:
      return out;
  }
}
