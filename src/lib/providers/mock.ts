import {
  HEATMAP_NICHES,
  HEATMAP_NICHE_PRIMARY_TYPE,
  SEASONAL_TRENDS,
  TRENDING_KEYWORDS,
  generateMockContributor,
  generateMockSearchResults,
} from "@/lib/mock-data";
import { calculateCompetitionLevel } from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";
import {
  DEFAULT_HEATMAP_FILTERS,
  calculateOpportunityScore,
  contentTypeBreakdown as buildContentTypeBreakdown,
  filterAssetsByPeriod,
  findRelatedKeywords,
  matchesContentType,
  sortNiches,
} from "@/lib/heatmap";
import {
  DEFAULT_TRENDING_FILTERS,
  matchesTrendingContentType,
  seasonalStatus,
  sortTrending,
} from "@/lib/trending";
import { extractQueryTokens } from "@/lib/similarity";
import type { SearchAsset, SimilarAsset } from "@/types/search";
import type {
  DataProvider,
  HeatmapFilters,
  HeatmapTile,
  ProviderCapabilities,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderSimilarRequest,
  ProviderSimilarResult,
  ProviderTrendingResult,
  RisingNiche,
  SeasonalTrend,
  TopPerformer,
  TrendingFilters,
  TrendingKeyword,
} from "./types";

const PROVIDER_ID = "mock";
const PROVIDER_NAME = "Mock data provider";

const CAPABILITIES: ProviderCapabilities = {
  search: "supported",
  contributor: "supported",
  heatmap: "supported",
  trending: "supported",
  // Similar Image Search returns demo "visually similar" results, ranked
  // by metadata overlap with the query (URL/filename/hint). Tagged
  // `Demo Data` so users never mistake the ranking for true visual AI.
  similarImage: "supported",
  // Mock numbers ARE provided, but they're synthetic — `dataQuality: "demo"`
  // already communicates this. We still return `metricsAvailable: true` so
  // the UI renders the figures; the demo badge is what tells the user not
  // to trust them as real Adobe data.
  downloadsAvailable: true,
};

function applyFilters(results: SearchAsset[], req: ProviderSearchRequest) {
  let out = results;
  if (req.contentType && req.contentType !== "all") {
    out = out.filter((r) => r.contentType === req.contentType);
  }
  if (req.aiFilter === "ai_only") out = out.filter((r) => r.isAiGenerated);
  if (req.aiFilter === "exclude_ai") out = out.filter((r) => !r.isAiGenerated);
  return out;
}

function applySort(results: SearchAsset[], req: ProviderSearchRequest) {
  const out = [...results];
  switch (req.sort) {
    case "newest":
      return out.sort(
        (a, b) =>
          new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
      );
    case "most_downloaded":
      return out.sort((a, b) => b.downloads - a.downloads);
    case "undiscovered":
      return out.sort(
        (a, b) =>
          b.performanceScore - a.performanceScore || a.downloads - b.downloads,
      );
    case "featured":
      return out.sort((a, b) => Number(b.isPremium) - Number(a.isPremium));
    default:
      return out;
  }
}

function aiSaturation(results: SearchAsset[]) {
  if (!results.length) return 0;
  const ai = results.filter((r) => r.isAiGenerated).length;
  return Math.round((ai / results.length) * 100);
}

function contentBreakdown(results: SearchAsset[]) {
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.contentType] = (counts[r.contentType] ?? 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

function withMetricsAvailable(assets: SearchAsset[]): SearchAsset[] {
  return assets.map((a) => ({ ...a, metricsAvailable: true }));
}

export const mockProvider: DataProvider = {
  id: PROVIDER_ID,
  name: PROVIDER_NAME,
  dataQuality: "demo",
  capabilities: CAPABILITIES,

  async search(req) {
    const page = req.page ?? 1;
    const { totalResults, results } = generateMockSearchResults(
      req.keyword,
      page,
      RESULTS_PER_PAGE,
    );
    const filtered = applyFilters(results, req);
    const sorted = applySort(filtered, req);
    const out: ProviderSearchResult = {
      totalResults,
      competitionLevel: calculateCompetitionLevel(totalResults),
      aiSaturation: aiSaturation(sorted),
      contentBreakdown: contentBreakdown(sorted),
      results: withMetricsAvailable(sorted),
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
    };
    return out;
  },

  async contributor(query: string) {
    const c = generateMockContributor(query);
    const out: ProviderContributorResult = {
      name: c.name,
      joinDate: c.joinDate,
      totalAssets: c.totalAssets,
      totalDownloads: c.totalDownloads,
      avgDownloads: c.avgDownloads,
      bestAsset: c.bestAsset,
      contentBreakdown: c.contentBreakdown,
      topKeywords: c.topKeywords,
      monthlyTrend: c.monthlyDownloads,
      assets: withMetricsAvailable(c.assets),
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
    };
    return out;
  },

  async heatmap(_ctx, filters) {
    const applied: HeatmapFilters = {
      contentType: filters?.contentType ?? DEFAULT_HEATMAP_FILTERS.contentType,
      period: filters?.period ?? DEFAULT_HEATMAP_FILTERS.period,
      minDownloads:
        filters?.minDownloads ?? DEFAULT_HEATMAP_FILTERS.minDownloads,
      sort: filters?.sort ?? DEFAULT_HEATMAP_FILTERS.sort,
      niche: filters?.niche?.trim() || undefined,
    };

    // Mock niches don't carry their own asset list; we synthesize it on
    // demand so contentTypeBreakdown / topAssets / related keywords are
    // realistic and respond to filters. Each call is deterministic by
    // niche keyword (the mock generator is seeded).
    const buildAssetsForNiche = (kw: string): SearchAsset[] => {
      const { results } = generateMockSearchResults(kw, 1, 12);
      return results.map((a) => ({ ...a, metricsAvailable: true }));
    };

    // Filter the niche list itself by the (mock-assigned) primary content
    // type and minDownloads. Period only meaningfully filters topAssets in
    // detail mode — the static mock niche list has no per-tile dates.
    const filteredNiches = HEATMAP_NICHES.filter((n) => {
      if (applied.minDownloads && n.downloads < applied.minDownloads) {
        return false;
      }
      if (applied.contentType && applied.contentType !== "all") {
        const primary = HEATMAP_NICHE_PRIMARY_TYPE[n.keyword] ?? "photo";
        if (applied.contentType === "other") {
          return ![
            "photo",
            "illustration",
            "vector",
            "video",
            "template",
            "3d",
          ].includes(primary);
        }
        return primary === applied.contentType;
      }
      return true;
    });

    // Niche detail mode: pull the requested niche even if min-downloads
    // would have hidden it (the user explicitly clicked it). Still respect
    // the period filter when computing topAssets so the drilldown reflects
    // "top performers in the last N days".
    if (applied.niche) {
      const target = applied.niche.toLowerCase();
      const niche = HEATMAP_NICHES.find((n) => n.keyword === target);
      if (!niche) {
        return {
          niches: [],
          appliedFilters: applied,
          detail: true,
          dataQuality: "demo",
          providerName: PROVIDER_NAME,
          providerId: PROVIDER_ID,
          capabilities: CAPABILITIES,
          notice: `Niche "${applied.niche}" is not in the demo data set.`,
        } satisfies ProviderHeatmapResult;
      }
      const synthAssets = buildAssetsForNiche(niche.keyword);
      const periodAssets = filterAssetsByPeriod(
        synthAssets,
        applied.period!,
      ).filter((a) => matchesContentType(a, applied.contentType!));
      const avgPerf =
        periodAssets.length > 0
          ? Math.round(
              periodAssets.reduce((s, a) => s + a.performanceScore, 0) /
                periodAssets.length,
            )
          : 0;
      const maxDownloadsAll = Math.max(
        ...HEATMAP_NICHES.map((x) => x.downloads),
        1,
      );
      const opportunityScore = calculateOpportunityScore({
        downloads: niche.downloads,
        competition: niche.competition,
        avgPerformanceScore: avgPerf,
        trend: niche.trend,
        maxDownloads: maxDownloadsAll,
      });
      const tile: HeatmapTile = {
        keyword: niche.keyword,
        downloads: niche.downloads,
        assets: niche.assets,
        competition: niche.competition,
        trend: niche.trend,
        opportunityScore,
        avgPerformanceScore: avgPerf,
        contentTypeBreakdown: buildContentTypeBreakdown(periodAssets),
        relatedKeywords: findRelatedKeywords(periodAssets, niche.keyword, 8),
        topAssets: [...periodAssets]
          .sort((a, b) => b.downloads - a.downloads)
          .slice(0, 8),
        metricsAvailable: true,
        trendAvailable: true,
      };
      return {
        niches: [tile],
        appliedFilters: applied,
        detail: true,
        dataQuality: "demo",
        providerName: PROVIDER_NAME,
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
      } satisfies ProviderHeatmapResult;
    }

    if (filteredNiches.length === 0) {
      return {
        niches: [],
        appliedFilters: applied,
        dataQuality: "demo",
        providerName: PROVIDER_NAME,
        providerId: PROVIDER_ID,
        capabilities: CAPABILITIES,
        notice:
          "No demo niches match the current filters. Try widening the content type or lowering the minimum downloads.",
      } satisfies ProviderHeatmapResult;
    }

    const maxDownloads = Math.max(
      ...filteredNiches.map((n) => n.downloads),
      1,
    );

    const tiles: HeatmapTile[] = filteredNiches.map((n) => {
      // Lightweight breakdown: synthesize a small sample so the demo
      // looks plausible. Avoids running the full mock generator on the
      // grid — detail mode does that.
      const sample = generateMockSearchResults(n.keyword, 1, 6).results;
      const avgPerf =
        sample.length > 0
          ? Math.round(
              sample.reduce((s, a) => s + a.performanceScore, 0) / sample.length,
            )
          : 0;
      return {
        keyword: n.keyword,
        downloads: n.downloads,
        assets: n.assets,
        competition: n.competition,
        trend: n.trend,
        opportunityScore: calculateOpportunityScore({
          downloads: n.downloads,
          competition: n.competition,
          avgPerformanceScore: avgPerf,
          trend: n.trend,
          maxDownloads,
        }),
        avgPerformanceScore: avgPerf,
        contentTypeBreakdown: buildContentTypeBreakdown(sample),
        relatedKeywords: [],
        topAssets: [],
        metricsAvailable: true,
        trendAvailable: true,
      };
    });

    return {
      niches: sortNiches(tiles, applied.sort!),
      appliedFilters: applied,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
    } satisfies ProviderHeatmapResult;
  },

  async trending(_ctx, filters) {
    const applied: TrendingFilters = {
      period: filters?.period ?? DEFAULT_TRENDING_FILTERS.period,
      contentType: filters?.contentType ?? DEFAULT_TRENDING_FILTERS.contentType,
      minVolume: filters?.minVolume ?? DEFAULT_TRENDING_FILTERS.minVolume,
      sort: filters?.sort ?? DEFAULT_TRENDING_FILTERS.sort,
      limit: filters?.limit ?? DEFAULT_TRENDING_FILTERS.limit,
    };

    // Trending keywords. Filter by content-type tag + min volume server
    // side, then sort + cap.
    const filteredTrending: TrendingKeyword[] = TRENDING_KEYWORDS.filter(
      (t) => {
        if (
          applied.contentType &&
          applied.contentType !== "all" &&
          !matchesTrendingContentType({ contentType: t.contentType }, applied.contentType)
        ) {
          return false;
        }
        if (applied.minVolume && t.volume < applied.minVolume) return false;
        return true;
      },
    ).map((t) => ({
      keyword: t.keyword,
      volume: t.volume,
      growth: t.growth,
      metricsAvailable: true,
    }));
    const trending = sortTrending(filteredTrending, applied.sort!).slice(
      0,
      applied.limit,
    );

    // Rising niches — derive from heatmap niches with `trend === "up"`,
    // honoring content-type + min-volume filters. growth is synthesized
    // from competition (lower competition + up trend = stronger rise).
    const risingNiches: RisingNiche[] = HEATMAP_NICHES.filter((n) => {
      if (n.trend !== "up") return false;
      if (applied.minVolume && n.downloads < applied.minVolume) return false;
      if (applied.contentType && applied.contentType !== "all") {
        const primary = HEATMAP_NICHE_PRIMARY_TYPE[n.keyword] ?? "photo";
        if (
          !matchesTrendingContentType(
            { contentType: primary },
            applied.contentType,
          )
        ) {
          return false;
        }
      }
      return true;
    })
      .map((n) => ({
        keyword: n.keyword,
        downloads: n.downloads,
        assets: n.assets,
        // Synthetic growth — demo data; the badge tells the user this is
        // not a real Adobe Stock figure. Range ~25–75%.
        growth: 25 + Math.round((100 - n.competition) * 0.5),
        competition: n.competition,
        metricsAvailable: true,
      }))
      .sort((a, b) =>
        applied.sort === "volume" ? b.downloads - a.downloads : b.growth - a.growth,
      )
      .slice(0, applied.limit);

    // Top performers this period — synthesize across the trending
    // keywords (filter the underlying assets by content type + period
    // first so the section honestly reflects the filters).
    const period = applied.period!;
    const day = 24 * 60 * 60 * 1000;
    const cutoffMs =
      period === "7d"
        ? 7 * day
        : period === "30d"
          ? 30 * day
          : period === "90d"
            ? 90 * day
            : 365 * day;
    const now = Date.now();

    const performerCandidates = trending
      .slice(0, 6)
      .flatMap((t) => generateMockSearchResults(t.keyword, 1, 6).results);
    const topPerformers: TopPerformer[] = performerCandidates
      .filter((a) => {
        if (
          applied.contentType &&
          applied.contentType !== "all" &&
          !matchesTrendingContentType(a, applied.contentType)
        ) {
          return false;
        }
        const ts = new Date(a.uploadDate).getTime();
        if (Number.isNaN(ts) || ts === 0) return false;
        return now - ts <= cutoffMs;
      })
      .map((a) => ({
        asset: { ...a, metricsAvailable: true },
        // Demo-derived: assume a constant fraction of the asset's lifetime
        // downloads landed in the active period, scaled down for shorter
        // windows. Tagged Demo Data globally.
        recentDownloads: Math.max(
          1,
          Math.round(a.downloads * (cutoffMs / (90 * day))),
        ),
      }))
      .sort((a, b) => b.recentDownloads - a.recentDownloads)
      .slice(0, applied.limit);

    // Seasonal trends — use static demo data; flag in_season /
    // approaching / off_season relative to the current calendar month.
    const seasonal: SeasonalTrend[] = SEASONAL_TRENDS.map((s) => ({
      keyword: s.keyword,
      peakMonth: s.peakMonth,
      peakLift: s.peakLift,
      status: seasonalStatus(s.peakMonth),
      available: true,
    }))
      .sort((a, b) => {
        const rank = (st: SeasonalTrend["status"]) =>
          st === "in_season" ? 0 : st === "approaching" ? 1 : 2;
        return rank(a.status) - rank(b.status) || b.peakLift - a.peakLift;
      })
      .slice(0, applied.limit);

    return {
      trending,
      risingNiches,
      topPerformers,
      seasonal,
      appliedFilters: applied,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
    } satisfies ProviderTrendingResult;
  },

  async similar(req: ProviderSimilarRequest) {
    // Demo similar-image results: seed off the strongest token we can
    // derive from the query (URL/filename/hint) and reuse the keyword
    // search generator so cards look familiar. Falls back to a generic
    // "similar images" stub when we have no textual signal at all.
    //
    // Similarity scores are synthesized in a descending ramp — honest as
    // long as the response is tagged `Demo Data`. The mock provider
    // never claims real visual matching.
    const tokens = req.queryTokens.length
      ? req.queryTokens
      : extractQueryTokens({
          imageUrl: req.imageUrl,
          imageFileName: req.imageFileName,
          hint: req.hint,
        });
    const seedKeyword = tokens[0] ?? "similar images";
    const page = req.page ?? 1;
    const { results } = generateMockSearchResults(
      seedKeyword,
      page,
      RESULTS_PER_PAGE,
    );
    let filtered = results;
    if (req.contentType && req.contentType !== "all") {
      filtered = filtered.filter((r) => r.contentType === req.contentType);
    }
    if (req.aiFilter === "ai_only") {
      filtered = filtered.filter((r) => r.isAiGenerated);
    } else if (req.aiFilter === "exclude_ai") {
      filtered = filtered.filter((r) => !r.isAiGenerated);
    }

    // Descending ramp: top result ≈ 95, last ≈ 55. Keeps the demo
    // honest — no row is ever "100% match" without a real URL hit.
    const ranked: SimilarAsset[] = filtered.map((asset, idx) => {
      const exactUrlMatch =
        !!req.imageUrl &&
        (asset.adobeStockUrl === req.imageUrl ||
          asset.thumbnailUrl === req.imageUrl);
      const score = exactUrlMatch
        ? 100
        : Math.max(
            55,
            95 - Math.round((idx / Math.max(1, filtered.length - 1)) * 40),
          );
      return {
        ...asset,
        metricsAvailable: true,
        similarityScore: score,
        similarityAvailable: true,
      };
    });

    return {
      totalResults: ranked.length,
      results: ranked,
      queryTokens: tokens,
      dataQuality: "demo",
      providerName: PROVIDER_NAME,
      providerId: PROVIDER_ID,
      capabilities: CAPABILITIES,
      notice: tokens.length
        ? "Demo similar-image results ranked by metadata overlap. Not real visual AI matching."
        : "Demo similar-image results. Provide an image URL or filename to refine the ranking.",
    } satisfies ProviderSimilarResult;
  },
};
