import { calculateCompetitionLevel } from "@/lib/scoring";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import {
  SEARCH_TTL_MS,
  readSearchCache,
  writeSearchCache,
} from "@/lib/scraper/cache";
import {
  fetchPublicSearchPage,
  isPublicScraperEnabled,
  type ScrapeResult,
  type ScrapedAsset,
} from "@/lib/scraper/public-adobe-stock";
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
 * This provider is the integration boundary for an authoritative or
 * public-metadata source. It accepts data from two upstreams and a
 * shared cache:
 *
 *   1. **HTTP boundary** (preferred). If `OFFICIAL_PROVIDER_BASE_URL`
 *      is set, calls hit a thin JSON adapter you operate — for
 *      example a Cloudflare Worker proxying public Adobe Stock
 *      pages, or a first-party signed analytics feed. Payloads are
 *      tagged `public_metadata` (promote to `verified` at the
 *      adapter layer if you've wired it to a signed feed).
 *
 *   2. **Built-in public scraper** (PR #22). If the HTTP boundary is
 *      not configured AND `PUBLIC_SCRAPER_ENABLED=true` is set, the
 *      provider falls through to `fetchPublicSearchPage` which reads
 *      publicly visible Adobe Stock search HTML with Axios + Cheerio.
 *      All safety rails — single user-agent, rate-limit, timeout,
 *      one retry, no anti-bot bypass — live in
 *      `src/lib/scraper/public-adobe-stock.ts`.
 *
 *   3. **Cache layer** (PR #22). Every search goes through
 *      `readSearchCache` first. Fresh hits short-circuit both
 *      upstreams and return the previously stored payload. Stale
 *      hits are kept in-memory and used as a GRACEFUL FALLBACK if
 *      the live fetch fails or is blocked, so the UI doesn't go
 *      dark under upstream flakes.
 *
 * The provider intentionally does NOT include any of:
 *   - private/internal Adobe APIs
 *   - proxy rotation
 *   - user-agent evasion
 *   - captcha / anti-bot bypass
 *   - fake Adobe download counts
 *
 * Until ONE of `OFFICIAL_PROVIDER_BASE_URL` or
 * `PUBLIC_SCRAPER_ENABLED=true` is set the provider returns honestly-
 * labeled empty responses with a `notice` so the UI can render the
 * "not configured" state without substituting mock data.
 *
 * Data-quality tag: `public_metadata` on both paths. Promote to
 * `verified` only at an adapter that wraps a first-party signed feed.
 */

const PROVIDER_ID = "official";
const PROVIDER_NAME = "Public Metadata Provider";
const FETCH_TIMEOUT_MS = 8_000;

const CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  contributor: "partial",
  heatmap: "unsupported",
  trending: "unsupported",
  similarImage: "unsupported",
  // Dashboard rollup needs per-user portfolio analytics that public-
  // metadata pages do not expose. We return an honest "partial"
  // envelope (every `*Available: false`) instead of throwing so the
  // UI renders `Unavailable` placeholders rather than substituting
  // demo numbers.
  dashboard: "partial",
  // Public pages do not expose verified download numbers. UI renders
  // `Unavailable` for downloads / performance / downloadsPerMonth on
  // every result this provider returns.
  downloadsAvailable: false,
};

interface OfficialProviderConfig {
  baseUrl: string;
  apiKey?: string;
}

function readConfig(): OfficialProviderConfig | null {
  const baseUrl = process.env.OFFICIAL_PROVIDER_BASE_URL?.trim();
  if (!baseUrl) return null;
  const normalized = baseUrl.replace(/\/+$/, "");
  const apiKey = process.env.OFFICIAL_PROVIDER_API_KEY?.trim() || undefined;
  return { baseUrl: normalized, apiKey };
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
 * fields are zero-filled BUT `metricsAvailable` is set to `false` so the
 * UI never claims the zero is a real Adobe download number.
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
    adobeStockUrl:
      normalizeAdobeStockUrl(raw.adobeStockUrl) ?? raw.adobeStockUrl ?? "",
    metricsAvailable: false,
  };
}

/**
 * Adapter: scraper output -> SearchAsset. The scraper doesn't return
 * verified numbers — every row gets `metricsAvailable: false`.
 */
function scrapedToSearchAsset(raw: ScrapedAsset): SearchAsset {
  // Prefer asset id from URL path when available; fall back to the
  // normalized URL itself so the UI always has a stable React key.
  const id = raw.assetId || raw.adobeStockUrl || raw.thumbnailUrl || Math.random().toString(36).slice(2);
  return {
    id,
    thumbnailUrl: raw.thumbnailUrl ?? "",
    title: raw.title ?? "(untitled)",
    downloads: 0,
    performanceScore: 0,
    downloadsPerMonth: 0,
    categories: [],
    contentType: raw.contentType ?? "unknown",
    // Public search tiles don't expose upload date. Use epoch 0 as a
    // sentinel and `metricsAvailable: false` keeps the UI honest.
    uploadDate: raw.uploadDate ?? new Date(0).toISOString(),
    contributorName: raw.contributorName ?? "(unknown contributor)",
    // contributorId intentionally blank — we refuse to link to
    // /contributor/<id> (see adobe-stock-link.ts). The name drives
    // the UI's keyword-search fallback link.
    contributorId: "",
    isPremium: Boolean(raw.isPremium),
    isAiGenerated: Boolean(raw.isAiGenerated),
    keywords: Array.isArray(raw.keywords) ? raw.keywords : [],
    adobeStockUrl: raw.adobeStockUrl ?? "",
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

/**
 * Build an "honestly empty" search envelope with the given notice. Used
 * when the provider can't run (unconfigured, scrape blocked, no cache)
 * so the UI still renders the page structure with an explanation.
 */
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

/**
 * Given a set of `SearchAsset`s, build the full `ProviderSearchResult`
 * envelope (with AI saturation, content breakdown, etc.). Reused by
 * both the HTTP-boundary and public-scraper paths so their envelopes
 * stay identical modulo the `notice` string.
 */
function buildSearchEnvelope(
  results: SearchAsset[],
  total: number,
  req: ProviderSearchRequest,
  notice: string,
): ProviderSearchResult {
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
    notice,
  };
}

// ---------------------------------------------------------------------------
// Search — cache-first, then HTTP boundary (if configured), then public
// scraper (if enabled), then graceful fallback to any stale cache.
// ---------------------------------------------------------------------------

async function searchViaHttpBoundary(
  cfg: OfficialProviderConfig,
  req: ProviderSearchRequest,
): Promise<ProviderSearchResult> {
  const url = buildSearchUrl(cfg, req);
  const payload = await fetchJson<PublicSearchPayload>(url, cfg);
  const results = (payload.results ?? []).map(toSearchAsset);
  const total = payload.totalResults ?? results.length;
  return buildSearchEnvelope(
    results,
    total,
    req,
    "Downloads and performance scores are not available from this source. " +
      "Numbers shown elsewhere are derived only from public metadata.",
  );
}

async function searchViaPublicScraper(
  req: ProviderSearchRequest,
): Promise<{ envelope: ProviderSearchResult; scrape: ScrapeResult } | null> {
  if (!isPublicScraperEnabled()) return null;
  const scrape = await fetchPublicSearchPage({
    keyword: req.keyword,
    contentType: req.contentType,
    page: req.page,
  });
  if (scrape.status === "disabled") return null;
  if (scrape.status !== "ok" && scrape.status !== "empty") {
    // Transport-level issue. Let the caller decide whether to fall
    // back to stale cache or surface an "unavailable" envelope.
    return { envelope: scrapeUnavailableEnvelope(scrape, req), scrape };
  }
  const results = scrape.assets.map(scrapedToSearchAsset);
  const total = scrape.totalResults ?? results.length;
  const notice =
    results.length > 0
      ? "Public Adobe Stock metadata (scraped live). Downloads and performance " +
        "are not available from public pages."
      : "Public Adobe Stock search returned no parseable results for this query.";
  return {
    envelope: buildSearchEnvelope(results, total, req, notice),
    scrape,
  };
}

function scrapeUnavailableEnvelope(
  scrape: ScrapeResult,
  req: ProviderSearchRequest,
): ProviderSearchResult {
  const base = buildSearchEnvelope(
    [],
    0,
    req,
    (() => {
      switch (scrape.status) {
        case "blocked":
          return (
            "Public Adobe Stock declined the request " +
            `(${scrape.reason ?? "blocked"}). ` +
            "No bypass is attempted. Try again later."
          );
        case "timeout":
          return "Public Adobe Stock timed out. No results available from the live source.";
        case "network_error":
          return "Could not reach Adobe Stock. No results available from the live source.";
        default:
          return "Public Adobe Stock fetch failed. No results available.";
      }
    })(),
  );
  return base;
}

export const officialAdobeProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "public_metadata",
  capabilities: CAPABILITIES,

  async search(req: ProviderSearchRequest): Promise<ProviderSearchResult> {
    const cfg = readConfig();
    const scraperOn = isPublicScraperEnabled();

    // 0. Nothing configured: return a clean, honest empty state.
    //    Cache reads are skipped on this branch because there's
    //    nothing that would ever populate the cache.
    if (!cfg && !scraperOn) {
      return emptySearchResult(
        "Public-metadata source not configured. Set OFFICIAL_PROVIDER_BASE_URL " +
          "(for a first-party HTTP adapter) or PUBLIC_SCRAPER_ENABLED=true (for " +
          "the built-in public Adobe Stock scraper) to populate this page.",
      );
    }

    // 1. Cache-first read. Use the upstream hint as the `source` tag
    //    so rows produced by the HTTP boundary and by the scraper
    //    don't step on each other.
    const source = cfg ? "official_api" : "public_scrape";
    const cacheKey = {
      source: source as "public_scrape" | "official_api",
      keyword: req.keyword,
      sort: req.sort ?? "relevance",
      contentType: req.contentType ?? "all",
      aiFilter: req.aiFilter ?? "all",
      page: req.page ?? 1,
    };
    const cached = await readSearchCache<ProviderSearchResult>(cacheKey);
    if (cached?.fresh) {
      return {
        ...cached.payload,
        // Refresh envelope fields in case the source signature or
        // capability map has evolved since the payload was written.
        providerId: PROVIDER_ID,
        providerName: PROVIDER_NAME,
        capabilities: CAPABILITIES,
        dataQuality: "public_metadata",
        notice: cached.payload.notice
          ? `${cached.payload.notice} (cached ${formatAge(cached.fetchedAt)})`
          : `Served from cache (${formatAge(cached.fetchedAt)} old).`,
      };
    }

    // 2. Live fetch — HTTP boundary wins when configured.
    if (cfg) {
      try {
        const envelope = await searchViaHttpBoundary(cfg, req);
        await writeSearchCache(cacheKey, envelope, SEARCH_TTL_MS);
        return envelope;
      } catch (err) {
        console.warn(
          "[officialAdobeProvider] HTTP boundary failed:",
          (err as Error).message,
        );
        if (cached) return staleCacheEnvelope(cached.payload, cached.fetchedAt);
        throw err;
      }
    }

    // 3. Public scraper branch. Only reached when the HTTP boundary
    //    is unset AND the scraper is enabled.
    const scraped = await searchViaPublicScraper(req);
    if (scraped && scraped.scrape.status === "ok") {
      await writeSearchCache(cacheKey, scraped.envelope, SEARCH_TTL_MS);
      return scraped.envelope;
    }

    // 4. Graceful fallback: use stale cache if we have any.
    if (cached) {
      return staleCacheEnvelope(cached.payload, cached.fetchedAt);
    }

    // 5. No cache, live fetch failed or returned nothing. Return an
    //    honest unavailable envelope rather than substituting demo
    //    data. The UI already handles this state — banner + notice.
    return scraped?.envelope ?? emptySearchResult(
      "Public Adobe Stock is currently unreachable and no cached results are available.",
    );
  },

  async contributor(query: string) {
    const cfg = readConfig();
    if (!cfg) {
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
      // Monthly trend cannot be reliably reconstructed from public
      // metadata (uploadDate ≠ download timing). Return an empty
      // array and let the UI render the partial-support state.
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
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "heatmap");
  },

  async trending() {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "trending");
  },

  async dashboard() {
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
// Local helpers (filter + sort + cache envelope helpers).
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
      return out.sort((a, b) => b.downloads - a.downloads);
    case "featured":
      return out.sort((a, b) => Number(b.isPremium) - Number(a.isPremium));
    case "undiscovered":
    case "relevance":
    default:
      return out;
  }
}

function staleCacheEnvelope(
  payload: ProviderSearchResult,
  fetchedAt: Date,
): ProviderSearchResult {
  return {
    ...payload,
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    capabilities: CAPABILITIES,
    dataQuality: "public_metadata",
    notice:
      "Live Adobe Stock fetch failed; showing cached results from " +
      `${formatAge(fetchedAt)} ago. ` +
      "No fake numbers are fabricated for the gaps.",
  };
}

function formatAge(at: Date): string {
  const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
