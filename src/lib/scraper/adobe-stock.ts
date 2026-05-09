// Adobe Stock data fetcher — thin wrapper over the data-provider layer.
//
// IMPORTANT: this module does NOT scrape Adobe Stock. It exists for backward
// compatibility with the original API route layout from PR #1; new code
// should import `runSearch` / `runContributor` / etc. from
// `@/lib/providers` directly.
//
// There is no live scraper, no proxy rotation, no UA evasion, and no
// private/internal Adobe API access. Real authoritative data comes from
// `manualImportProvider` (user-uploaded CSV/JSON) or, eventually, an
// `officialAdobeProvider` wired to a first-party Adobe source.

import type { SearchAsset, SearchRequest } from "@/types/search";
import type { DataQuality } from "@/types/search";
import { runSearch } from "@/lib/providers";
import type { ProviderContext } from "@/lib/providers";

export interface ScrapeResult {
  totalResults: number;
  competitionLevel: "low" | "medium" | "high";
  aiSaturation: number;
  contentBreakdown: { type: string; count: number }[];
  results: SearchAsset[];
  dataQuality: DataQuality;
  providerName: string;
}

export async function searchAdobeStock(
  req: SearchRequest,
  ctx?: ProviderContext,
): Promise<ScrapeResult> {
  const r = await runSearch(req, ctx);
  return {
    totalResults: r.totalResults,
    competitionLevel: r.competitionLevel,
    aiSaturation: r.aiSaturation,
    contentBreakdown: r.contentBreakdown,
    results: r.results,
    dataQuality: r.dataQuality,
    providerName: r.providerName,
  };
}
