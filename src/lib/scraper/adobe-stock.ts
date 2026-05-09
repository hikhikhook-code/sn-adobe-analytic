// Adobe Stock data fetcher — thin wrapper over the data-provider layer.
//
// IMPORTANT: this module does NOT scrape Adobe Stock. It exists for backward
// compatibility with the original API route layout from PR #1; new code should
// import from `@/lib/providers` directly.
//
// There is no live scraper, no proxy rotation, no UA evasion, and no
// private/internal Adobe API access. If a future provider is added (see
// `src/lib/providers/official-adobe.ts`) it MUST go through an officially
// supported source — the contributor's own export, an official Adobe API, or
// equivalent.

import type { SearchAsset, SearchRequest } from "@/types/search";
import type { DataQuality } from "@/types/search";
import { selectProvider } from "@/lib/providers";
import { mockProvider } from "@/lib/providers/mock";
import { ProviderNotImplementedError } from "@/lib/providers/types";

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
): Promise<ScrapeResult> {
  const provider = selectProvider();
  try {
    const r = await provider.search(req);
    return {
      totalResults: r.totalResults,
      competitionLevel: r.competitionLevel,
      aiSaturation: r.aiSaturation,
      contentBreakdown: r.contentBreakdown,
      results: r.results,
      dataQuality: r.dataQuality,
      providerName: r.providerName,
    };
  } catch (err) {
    if (err instanceof ProviderNotImplementedError) {
      console.warn(`[providers] ${err.message}`);
      const r = await mockProvider.search(req);
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
    throw err;
  }
}
