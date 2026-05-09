// Adobe Stock scraper module — Phase 2.
//
// In the MVP we ship a stub that delegates to mock data. The real implementation
// would use Cheerio + Axios with rate limiting, user-agent rotation, and a
// 24h cache layer per PRD section 10. The interface below is stable so the API
// route can swap to live data without changing call sites.

import type { SearchAsset, SearchRequest } from "@/types/search";
import { generateMockSearchResults } from "@/lib/mock-data";
import { calculateCompetitionLevel } from "@/lib/scoring";
import { RESULTS_PER_PAGE } from "@/lib/constants";

export interface ScrapeResult {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
}

export async function searchAdobeStock(req: SearchRequest): Promise<ScrapeResult> {
  const useLive = process.env.USE_LIVE_SCRAPER === "true";
  if (useLive) {
    // TODO Phase 2: implement real scraping. For now still fall back to mock.
    // Steps:
    //  1. Build URL: https://stock.adobe.com/search?k=<keyword>&filters[content_type:<type>]=1
    //  2. axios GET with rotating user-agent, optional proxy
    //  3. cheerio.load(html) -> parse asset cards
    //  4. enrich each asset by visiting /<assetId> for downloads + keywords
    //  5. cache results in CachedAsset / CachedSearch with 24h TTL
    console.warn("[scraper] USE_LIVE_SCRAPER=true but live scraper not implemented — using mock");
  }

  const page = req.page ?? 1;
  const { totalResults, results } = generateMockSearchResults(
    req.keyword,
    page,
    RESULTS_PER_PAGE,
  );

  const filtered = applyFilters(results, req);
  const aiCount = filtered.filter((r) => r.isAiGenerated).length;
  const aiSaturation = filtered.length
    ? Math.round((aiCount / filtered.length) * 100)
    : 0;
  const breakdownMap = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.contentType] = (acc[r.contentType] ?? 0) + 1;
    return acc;
  }, {});
  const contentBreakdown = Object.entries(breakdownMap).map(([type, count]) => ({
    type,
    count,
  }));

  return {
    totalResults,
    competitionLevel: calculateCompetitionLevel(totalResults),
    aiSaturation,
    contentBreakdown,
    results: applySort(filtered, req.sort),
  };
}

function applyFilters(results: SearchAsset[], req: SearchRequest): SearchAsset[] {
  let out = results;
  if (req.contentType && req.contentType !== "all") {
    out = out.filter((r) => r.contentType === req.contentType);
  }
  if (req.aiFilter === "ai_only") out = out.filter((r) => r.isAiGenerated);
  if (req.aiFilter === "exclude_ai") out = out.filter((r) => !r.isAiGenerated);
  return out;
}

function applySort(
  results: SearchAsset[],
  sort: SearchRequest["sort"],
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
    case "undiscovered":
      // High performance score but low total downloads
      return out.sort(
        (a, b) =>
          b.performanceScore - a.performanceScore || a.downloads - b.downloads,
      );
    case "featured":
      return out.sort((a, b) => Number(b.isPremium) - Number(a.isPremium));
    case "relevance":
    default:
      return out;
  }
}
