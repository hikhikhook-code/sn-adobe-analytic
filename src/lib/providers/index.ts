import { prisma } from "@/lib/prisma";
import { mockProvider } from "./mock";
import { officialAdobeProvider } from "./official-adobe";
import { manualImportProvider } from "./manual-import";
import {
  ProviderNoDataError,
  ProviderNotImplementedError,
  ProviderRequiresUserError,
} from "./types";
import type {
  DataProvider,
  ProviderContext,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderTrendingResult,
} from "./types";

const PROVIDERS: Record<string, DataProvider> = {
  mock: mockProvider,
  official: officialAdobeProvider,
  manual: manualImportProvider,
};

let warnedAboutLiveScraper = false;
const warnedAboutMissingProvider: Record<string, boolean> = {};

/**
 * Resolve the current data provider from env + (optionally) user.
 *
 * Selection order:
 * 1. `DATA_PROVIDER` env var (`mock` | `official` | `manual`); unknown value
 *    → mock with a warning.
 * 2. **Auto-promote to manual** when:
 *    - the env var is `mock` (or unset), AND
 *    - the caller passed a `userId`, AND
 *    - that user has at least one non-archived imported dataset
 *    This makes the manual provider feel zero-config: as soon as a user
 *    imports their own data, they start seeing it.
 * 3. Default → mock.
 *
 * `USE_LIVE_SCRAPER` is honored ONLY in development. In production it is
 * forced off — we will not silently scrape Adobe Stock from a deployed
 * instance.
 */
export async function selectProvider(
  ctx?: ProviderContext,
): Promise<DataProvider> {
  const requested = (process.env.DATA_PROVIDER ?? "mock").toLowerCase();
  const useLive = process.env.USE_LIVE_SCRAPER === "true";

  if (useLive) {
    if (process.env.NODE_ENV === "production") {
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

  // Explicit demo scope bypasses auto-promotion. A signed-in user who has
  // imported data but deliberately chose "Using demo data" must actually
  // see demo data.
  if (ctx?.datasetScope?.kind === "demo") {
    return mockProvider;
  }

  // If the caller already resolved a concrete dataset scope (either "all"
  // with at least one dataset, or "specific"), skip the extra DB round-trip
  // and jump straight to the manual provider. The caller has already done
  // the ownership and existence checks.
  if (
    picked.id === "mock" &&
    ctx?.userId &&
    (ctx.datasetScope?.kind === "specific" ||
      ctx.datasetScope?.kind === "all")
  ) {
    return manualImportProvider;
  }

  // Auto-promote: if the user has imported data, prefer manual even when
  // DATA_PROVIDER=mock. The user can still force `DATA_PROVIDER=mock` via
  // env if they want demo data, but the default should let imported data
  // win once it exists.
  if (picked.id === "mock" && ctx?.userId) {
    try {
      const datasetCount = await prisma.importedDataset.count({
        where: { userId: ctx.userId, archived: false },
      });
      if (datasetCount > 0) return manualImportProvider;
    } catch {
      // Table may not exist yet during a fresh setup — fall through to mock.
    }
  }

  return picked;
}

/**
 * Convenience wrapper: call a provider method and gracefully fall back to
 * `mockProvider` if the chosen provider can't fulfill the request (not
 * implemented, requires user, or user has no data yet).
 */
export async function runProvider<T>(
  ctx: ProviderContext | undefined,
  fn: (p: DataProvider) => Promise<T>,
): Promise<T> {
  const provider = await selectProvider(ctx);
  try {
    return await fn(provider);
  } catch (err) {
    if (
      err instanceof ProviderNotImplementedError ||
      err instanceof ProviderRequiresUserError ||
      err instanceof ProviderNoDataError
    ) {
      console.warn(`[providers] ${err.message}`);
      return fn(mockProvider);
    }
    throw err;
  }
}

// High-level helpers used by the API routes — these own the provider +
// fallback dance so route handlers stay tiny.
export async function runSearch(
  req: ProviderSearchRequest,
  ctx?: ProviderContext,
): Promise<ProviderSearchResult> {
  return runProvider(ctx, (p) => p.search(req, ctx));
}

export async function runContributor(
  query: string,
  ctx?: ProviderContext,
): Promise<ProviderContributorResult> {
  return runProvider(ctx, (p) => p.contributor(query, ctx));
}

export async function runHeatmap(
  ctx?: ProviderContext,
): Promise<ProviderHeatmapResult> {
  return runProvider(ctx, (p) => p.heatmap(ctx));
}

export async function runTrending(
  ctx?: ProviderContext,
): Promise<ProviderTrendingResult> {
  return runProvider(ctx, (p) => p.trending(ctx));
}

export { mockProvider, officialAdobeProvider, manualImportProvider };
export type {
  DataProvider,
  DataQuality,
  ProviderContext,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderTrendingResult,
} from "./types";
export { DATA_QUALITY_LABELS, DATA_QUALITY_DESCRIPTIONS } from "./types";
