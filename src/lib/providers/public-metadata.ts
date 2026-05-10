/**
 * Public Metadata provider — PR #22.
 *
 * A safe, cache-first DataProvider that reads publicly reachable Adobe
 * Stock pages via the scraper foundation under `src/lib/scraper/`.
 *
 * Wiring (see `src/lib/providers/index.ts`):
 *   - `DATA_PROVIDER=public`   → this provider (explicit opt-in)
 *   - `DATA_PROVIDER=official` → this provider when
 *        `ENABLE_PUBLIC_SCRAPER=true`; otherwise the legacy
 *        `officialAdobeProvider` (HTTP-boundary placeholder) is used.
 *
 * What it returns:
 *   - `dataQuality: "public_metadata"` on every response.
 *   - `SearchAsset` rows carry title, thumbnail, contributor name,
 *     keywords, categories, content type, and the canonical Adobe
 *     Stock URL. Download / performance / downloadsPerMonth are set
 *     to `0` with `metricsAvailable: false` so the UI renders
 *     "Unavailable" — public pages do NOT expose verified numbers.
 *
 * What it refuses to do (per PR brief):
 *   - No private / internal Adobe API access.
 *   - No logged-in contributor dashboard scraping.
 *   - No proxy rotation, UA evasion, captcha / anti-bot bypass.
 *   - No fabricated Adobe download counts.
 *
 * Failure handling:
 *   - `PublicScrapeBlockedError` (403 / 429 / captcha body): return
 *     stale cache if we have one, otherwise an honest empty response
 *     with a `notice` describing what happened. No retries in the
 *     same request.
 *   - `PublicScrapeTransientError` (5xx / network): same fallback —
 *     stale cache if available, otherwise empty + notice.
 *   - Unknown errors: still caught + surfaced as an empty response
 *     with a generic "public metadata temporarily unavailable" notice.
 *     We never throw out of this provider; the goal is cache-first
 *     resilience, not loud failure.
 *
 * Scope for this PR: search + contributor metadata only. Heatmap /
 * trending / similar / dashboard are explicitly `unsupported` so the
 * `runProvider()` fallback dispatcher routes them to manual (for
 * signed-in users with imports) or mock.
 */

import { calculateCompetitionLevel } from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";
import type { SearchAsset } from "@/types/search";
import {
  ProviderFeatureUnsupportedError,
  type DataProvider,
  type ProviderCapabilities,
  type ProviderContributorResult,
  type ProviderDashboardResult,
  type ProviderSearchRequest,
  type ProviderSearchResult,
  type ProviderSimilarRequest,
  type ProviderSimilarResult,
} from "./types";
import {
  PublicScrapeBlockedError,
  PublicScrapeTransientError,
} from "@/lib/scraper/http";
import {
  readCachedAssets,
  readCachedSearch,
  writeCachedAssets,
  writeCachedSearch,
} from "@/lib/scraper/cache";
import {
  scrapeSearch,
  type PublicAdobeAsset,
} from "@/lib/scraper/public-adobe-stock";

const PROVIDER_ID = "public";
const PROVIDER_NAME = "Public Adobe Stock metadata";

const CAPABILITIES: ProviderCapabilities = {
  // The only two features that make sense from public pages alone.
  search: "supported",
  contributor: "partial",
  // Aggregation over download signals we do not have.
  heatmap: "unsupported",
  trending: "unsupported",
  // Similar image search requires visual matching we deliberately do
  // not build; stays unsupported so the UI surfaces an honest notice.
  similarImage: "unsupported",
  // Dashboard analytics need per-user portfolio data; public pages
  // cannot supply verified figures.
  dashboard: "partial",
  // Hard rule: public pages do NOT expose verified downloads. Every
  // search / contributor row we return has `metricsAvailable: false`.
  downloadsAvailable: false,
};

/**
 * Compose a provider-style `SearchAsset` from a parsed public asset.
 * Never fabricates numeric download / performance data — caller of the
 * UI renders "Unavailable" when `metricsAvailable: false`.
 */
function toSearchAsset(a: PublicAdobeAsset): SearchAsset {
  return {
    id: a.id,
    thumbnailUrl: a.thumbnailUrl ?? "",
    title: a.title || "(untitled)",
    downloads: 0,
    performanceScore: 0,
    downloadsPerMonth: 0,
    categories: Array.isArray(a.categories) ? a.categories : [],
    contentType: a.contentType || "unknown",
    // Public pages rarely publish a reliable upload date. Epoch 0
    // signals "not reliably known" — the result card tolerates it and
    // the exporter can gate its "Upload Date" column on a non-epoch
    // value later.
    uploadDate: new Date(0).toISOString(),
    contributorName: a.contributorName || "(unknown contributor)",
    // Public pages expose a display name, not an internal contributor
    // id. Leaving this blank is intentional — the adobe-stock-link
    // resolver falls back to a keyword search on the name.
    contributorId: "",
    isPremium: a.isPremium ?? false,
    isAiGenerated: a.isAiGenerated ?? false,
    keywords: Array.isArray(a.keywords) ? a.keywords : [],
    adobeStockUrl:
      normalizeAdobeStockUrl(a.adobeStockUrl) ?? a.adobeStockUrl ?? "",
    metricsAvailable: false,
  };
}

function contentBreakdown(results: SearchAsset[]) {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.contentType] = (counts[r.contentType] ?? 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function aiSaturation(results: SearchAsset[]) {
  if (!results.length) return 0;
  const ai = results.filter((r) => r.isAiGenerated).length;
  return Math.round((ai / results.length) * 100);
}

function emptySearch(notice: string): ProviderSearchResult {
  return {
    totalResults: 0,
    competitionLevel: "low",
    aiSaturation: 0,
    contentBreakdown: [],
    results: [],
    dataQuality: "public_metadata",
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    capabilities: CAPABILITIES,
    notice,
  };
}

interface FreshnessMarker {
  servedFromCache: boolean;
  staleCache: boolean;
  scrapedAt?: Date;
}

function buildSearchResult(
  results: SearchAsset[],
  totalResults: number,
  mark: FreshnessMarker,
  extraNotice?: string,
): ProviderSearchResult {
  // Honest baseline notice — always remind callers that download /
  // performance figures aren't available from this source. A cache
  // / block condition appends a second line if present.
  const parts = [
    "Downloads, performance scores, and upload dates are not available from public Adobe Stock pages; those cells show 'Unavailable'.",
  ];
  if (mark.servedFromCache) {
    const label = mark.staleCache
      ? "stale public-metadata cache"
      : "public-metadata cache";
    parts.push(
      `Served from ${label}${
        mark.scrapedAt ? ` (captured ${mark.scrapedAt.toISOString()})` : ""
      }.`,
    );
  }
  if (extraNotice) parts.push(extraNotice);

  return {
    totalResults,
    competitionLevel: calculateCompetitionLevel(totalResults),
    aiSaturation: aiSaturation(results),
    contentBreakdown: contentBreakdown(results),
    results,
    dataQuality: "public_metadata",
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    capabilities: CAPABILITIES,
    notice: parts.join(" "),
  };
}

/**
 * Hydrate a list of asset IDs (from a CachedSearch row) back into
 * SearchAssets by reading CachedAsset rows. Returns assets in the
 * same order as `ids`; missing rows are dropped — the caller decides
 * whether to treat that as an empty response or to re-scrape.
 */
async function hydrateFromCache(
  ids: string[],
  opts?: { allowStale?: boolean },
): Promise<SearchAsset[]> {
  if (!ids.length) return [];
  const map = await readCachedAssets(ids, opts);
  const out: SearchAsset[] = [];
  for (const id of ids) {
    const hit = map.get(id);
    if (hit) out.push(hit.asset);
  }
  return out;
}

async function serveFromCache(
  req: ProviderSearchRequest,
  opts?: { allowStale?: boolean },
): Promise<{
  hit: NonNullable<Awaited<ReturnType<typeof readCachedSearch>>>;
  results: SearchAsset[];
} | null> {
  const cachedSearch = await readCachedSearch(
    {
      keyword: req.keyword,
      sort: req.sort,
      contentType: req.contentType,
      aiFilter: req.aiFilter,
      page: req.page ?? 1,
    },
    { allowStale: opts?.allowStale },
  );
  if (!cachedSearch) return null;
  const results = await hydrateFromCache(cachedSearch.assetIds, {
    allowStale: opts?.allowStale,
  });
  if (results.length === 0) return null;
  return { hit: cachedSearch, results };
}

export const publicMetadataProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "public_metadata",
  capabilities: CAPABILITIES,

  async search(req: ProviderSearchRequest): Promise<ProviderSearchResult> {
    // ---- 1. Cache-first: fresh row? ---------------------------------
    const fresh = await serveFromCache(req);
    if (fresh) {
      return buildSearchResult(
        fresh.results,
        fresh.hit.totalResults,
        {
          servedFromCache: true,
          staleCache: false,
          scrapedAt: fresh.hit.scrapedAt,
        },
      );
    }

    // ---- 2. Live scrape (rate-limited, timeout, limited retry) ------
    try {
      const page = await scrapeSearch(req.keyword, {
        page: req.page ?? 1,
        contentType: req.contentType,
      });

      if (page.assets.length === 0) {
        // The page parsed but yielded nothing usable. Try stale cache
        // before claiming "no results" — a well-formed but unusable
        // page is more likely a parser-drift problem than a real
        // zero-result response.
        const stale = await serveFromCache(req, { allowStale: true });
        if (stale) {
          return buildSearchResult(
            stale.results,
            stale.hit.totalResults,
            {
              servedFromCache: true,
              staleCache: true,
              scrapedAt: stale.hit.scrapedAt,
            },
            "Live parse returned no usable rows; served from stale cache.",
          );
        }
        return emptySearch(
          "Public Adobe Stock page returned no parseable results. No cached rows to fall back to.",
        );
      }

      const hydrated = page.assets.map(toSearchAsset);
      const total = page.totalResults ?? hydrated.length;

      // Fire-and-forget cache writes. We don't await on the asset
      // upserts because a 60-asset insert against a cold SQLite file
      // can push our P50 up needlessly; the user already has the
      // data they need in `hydrated`.
      void (async () => {
        try {
          await writeCachedAssets(page.assets);
          await writeCachedSearch(
            {
              keyword: req.keyword,
              sort: req.sort,
              contentType: req.contentType,
              aiFilter: req.aiFilter,
              page: req.page ?? 1,
            },
            {
              assetIds: hydrated.map((a) => a.id),
              totalResults: total,
              competitionLevel: calculateCompetitionLevel(total),
              aiSaturation: aiSaturation(hydrated),
            },
          );
        } catch {
          // Cache write failures are never fatal.
        }
      })();

      // Re-associate cached rows (if any) onto freshly scraped results
      // so ordering/IDs stay stable but we also retain any keywords /
      // contributor info a previous scrape might have recovered.
      const cachedMap = await readCachedAssets(
        hydrated.map((a) => a.id),
        { allowStale: true },
      );
      const final: SearchAsset[] = hydrated.map((a) => {
        const cached = cachedMap.get(a.id)?.asset;
        if (!cached) return a;
        // Merge missing keywords / categories from the cache without
        // letting stale fields override fresher ones.
        return {
          ...a,
          keywords: a.keywords.length ? a.keywords : cached.keywords,
          categories: a.categories.length
            ? a.categories
            : cached.categories,
          contributorName:
            a.contributorName && a.contributorName !== "(unknown contributor)"
              ? a.contributorName
              : cached.contributorName,
          contentType:
            a.contentType && a.contentType !== "unknown"
              ? a.contentType
              : cached.contentType,
        };
      });

      // Bound the page size we surface to RESULTS_PER_PAGE so the
      // shape matches mock / manual providers.
      const paged = final.slice(0, RESULTS_PER_PAGE);

      return buildSearchResult(paged, total, {
        servedFromCache: false,
        staleCache: false,
      });
    } catch (err) {
      return handleScrapeFailure(req, err);
    }
  },

  async contributor(query: string): Promise<ProviderContributorResult> {
    // Contributor analytics from public metadata are partial by nature:
    // we can surface a name + any assets we've scraped for that name,
    // but download totals / best-sellers / monthly trend are not
    // derivable. We do a keyword search on the contributor name and
    // surface whatever assets come back. Never fabricated.
    const name = query.trim();
    if (!name) {
      return emptyContributor(
        "(empty)",
        "Enter a contributor name to look up their public Adobe Stock assets.",
      );
    }

    let assets: SearchAsset[] = [];
    let notice =
      "Contributor analytics from a public-metadata source are partial: " +
      "download history and verified totals are not available.";

    try {
      const res = await publicMetadataProvider.search({
        keyword: name,
        page: 1,
      });
      assets = res.results;
      if (assets.length === 0) {
        notice += " No public assets matched this contributor name.";
      }
    } catch {
      notice +=
        " Live public scrape failed and no cached rows match this name.";
    }

    const scoped = name
      ? assets.filter((a) =>
          a.contributorName.toLowerCase().includes(name.toLowerCase()),
        )
      : assets;

    const contentBreakdownWithPct = (() => {
      if (scoped.length === 0) return [];
      const m = new Map<string, number>();
      for (const a of scoped) m.set(a.contentType, (m.get(a.contentType) ?? 0) + 1);
      return Array.from(m.entries())
        .map(([type, count]) => ({
          type,
          count,
          pct: Math.round((count / scoped.length) * 100),
        }))
        .sort((a, b) => b.count - a.count);
    })();

    const kwFreq = new Map<string, number>();
    for (const a of scoped) {
      for (const k of a.keywords) kwFreq.set(k, (kwFreq.get(k) ?? 0) + 1);
    }
    const topKeywords = Array.from(kwFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([keyword, count]) => ({ keyword, count }));

    return {
      name: scoped[0]?.contributorName || name,
      joinDate: new Date(0).toISOString(),
      totalAssets: scoped.length,
      totalDownloads: 0,
      avgDownloads: 0,
      bestAsset: {
        id: scoped[0]?.id ?? "",
        title: scoped[0]?.title ?? "(no assets)",
        downloads: 0,
      },
      contentBreakdown: contentBreakdownWithPct,
      topKeywords,
      monthlyTrend: [],
      assets: scoped,
      dataQuality: "public_metadata",
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      capabilities: CAPABILITIES,
      notice,
    };
  },

  async heatmap() {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "heatmap");
  },

  async trending() {
    throw new ProviderFeatureUnsupportedError(PROVIDER_ID, "trending");
  },

  async similar(req: ProviderSimilarRequest): Promise<ProviderSimilarResult> {
    // Honest empty response, not a throw: the /search Similar Image
    // panel calls this directly and we want it to render the
    // unsupported state inline rather than fall through to mock demo
    // results (which might mislead about what this provider can do).
    return {
      totalResults: 0,
      results: [],
      queryTokens: req.queryTokens,
      dataQuality: "public_metadata",
      providerId: PROVIDER_ID,
      providerName: PROVIDER_NAME,
      capabilities: CAPABILITIES,
      notice:
        "Similar Image Search is not available from the public-metadata provider. " +
        "No visual matching, internal APIs, or anti-bot bypass — switch to the demo " +
        "or imported-data provider for similarity ranking.",
    };
  },

  async dashboard(): Promise<ProviderDashboardResult> {
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
      notice:
        "Dashboard portfolio analytics are not available from public Adobe Stock pages. " +
        "Verified download counts and per-user performance figures require a first-party " +
        "signed feed or an imported CSV.",
    };
  },
};

function emptyContributor(
  name: string,
  notice: string,
): ProviderContributorResult {
  return {
    name,
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
    providerId: PROVIDER_ID,
    providerName: PROVIDER_NAME,
    capabilities: CAPABILITIES,
    notice,
  };
}

async function handleScrapeFailure(
  req: ProviderSearchRequest,
  err: unknown,
): Promise<ProviderSearchResult> {
  // Always try stale cache before giving up.
  const stale = await serveFromCache(req, { allowStale: true }).catch(
    () => null,
  );

  let reason: string;
  if (err instanceof PublicScrapeBlockedError) {
    reason =
      err.status === 429
        ? "Adobe Stock rate-limited this request (HTTP 429). Slowing down and serving cached metadata when available."
        : "Adobe Stock returned a block / anti-bot interstitial. No anti-bot bypass is attempted; serving cached metadata when available.";
  } else if (err instanceof PublicScrapeTransientError) {
    reason =
      "Public Adobe Stock fetch failed after the retry budget (network / 5xx). Serving cached metadata when available.";
  } else {
    reason =
      "Public metadata scrape failed. Serving cached metadata when available.";
  }

  if (stale) {
    return buildSearchResult(
      stale.results,
      stale.hit.totalResults,
      {
        servedFromCache: true,
        staleCache: true,
        scrapedAt: stale.hit.scrapedAt,
      },
      reason,
    );
  }
  return emptySearch(reason);
}
