import { mockProvider } from "./mock";
import { officialAdobeProvider } from "./official-adobe";
import { manualImportProvider } from "./manual-import";
import type { DataProvider } from "./types";

const PROVIDERS: Record<string, DataProvider> = {
  mock: mockProvider,
  official: officialAdobeProvider,
  manual: manualImportProvider,
};

let warnedAboutLiveScraper = false;
const warnedAboutMissingProvider: Record<string, boolean> = {};

/**
 * Resolve the current data provider from env.
 *
 * Selection order:
 * 1. `DATA_PROVIDER` env var (`mock` | `official` | `manual`); unknown value
 *    → mock with a warning.
 * 2. Default → mock.
 *
 * `USE_LIVE_SCRAPER` is honored ONLY in development. In production it is
 * forced off — we will not silently scrape Adobe Stock from a deployed
 * instance.
 */
export function selectProvider(): DataProvider {
  const requested = (process.env.DATA_PROVIDER ?? "mock").toLowerCase();
  const useLive = process.env.USE_LIVE_SCRAPER === "true";

  if (useLive) {
    if (process.env.NODE_ENV === "production") {
      // Hard refuse in production. There is no live scraper implemented; even
      // if there were, we would not enable it from an env flag.
      if (!warnedAboutLiveScraper) {
        console.warn(
          "[providers] USE_LIVE_SCRAPER=true is ignored in production. " +
            "Falling back to the mock provider.",
        );
        warnedAboutLiveScraper = true;
      }
    } else if (!warnedAboutLiveScraper) {
      console.warn(
        "[providers] USE_LIVE_SCRAPER=true was set but no live scraper is " +
          "implemented. Returning mock data. See README \u00a7 \"Data " +
          "providers\" for the roadmap.",
      );
      warnedAboutLiveScraper = true;
    }
  }

  const picked = PROVIDERS[requested];
  if (!picked) {
    if (!warnedAboutMissingProvider[requested]) {
      console.warn(
        `[providers] Unknown DATA_PROVIDER=${requested}. Falling back to mock.`,
      );
      warnedAboutMissingProvider[requested] = true;
    }
    return mockProvider;
  }

  // For placeholder providers, the actual fallback to mock happens at call
  // time (the placeholder methods throw ProviderNotImplementedError).
  return picked;
}

export { mockProvider, officialAdobeProvider, manualImportProvider };
export type {
  DataProvider,
  DataQuality,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderTrendingResult,
} from "./types";
export { DATA_QUALITY_LABELS, DATA_QUALITY_DESCRIPTIONS } from "./types";
