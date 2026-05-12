import { prisma } from "@/lib/prisma";
import { mockProvider } from "./mock";
import { officialAdobeProvider } from "./official-adobe";
import { manualImportProvider } from "./manual-import";
import { liveScraperProvider } from "./live-scraper";
import {
  ProviderFeatureUnsupportedError,
  ProviderNoDataError,
  ProviderNotImplementedError,
  ProviderRequiresUserError,
} from "./types";
import type {
  DataProvider,
  HeatmapFilters,
  ProviderContext,
  ProviderContributorResult,
  ProviderDashboardResult,
  ProviderHeatmapResult,
  ProviderResultEnvelope,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderSimilarRequest,
  ProviderSimilarResult,
  ProviderTrendingResult,
  TrendingFilters,
} from "./types";

const PROVIDERS: Record<string, DataProvider> = {
  mock: mockProvider,
  official: officialAdobeProvider,
  // `public` is an alias for the official public-metadata provider.
  // PR #22 standardized the public-metadata name; `official` stays
  // around for back-compat with existing .env files and docs.
  public: officialAdobeProvider,
  manual: manualImportProvider,
  "live-scraper": liveScraperProvider,
};

let warnedAboutLiveScraper = false;
const warnedAboutMissingProvider: Record<string, boolean> = {};

/**
 * Returns true if the context indicates the user explicitly opted into
 * demo mode (via the dataset-scope selector). When true, mock fallback
 * is permitted even in production.
 */
function isExplicitDemoScope(ctx?: ProviderContext): boolean {
  return ctx?.datasetScope?.kind === "demo";
}

/**
 * Resolve the current data provider from env + (optionally) user.
 *
 * Selection order (PR #23 — real-data-first):
 *
 * 1. Explicit demo scope (`datasetScope.kind === "demo"`) → mockProvider.
 *    This is the ONLY path that returns mock for a signed-in production
 *    user. Guests (no userId) also get mock as there's nothing else to
 *    serve.
 *
 * 2. `DATA_PROVIDER` env var (`mock` | `official` | `public` | `manual`);
 *    unknown value → mock with a warning.
 *
 * 3. **Auto-promote to manual** when:
 *    - the env var is `mock` (or unset), AND
 *    - the caller passed a `userId`, AND
 *    - the scope is `specific` or `all` (already verified), OR the user
 *      has at least one non-archived imported dataset.
 *    This makes the manual provider feel zero-config.
 *
 * 4. When DATA_PROVIDER=mock AND the user has no data AND the scope is
 *    NOT explicitly demo → return mockProvider but mark context as
 *    "no_real_data" so runProvider can tag the envelope with a notice
 *    instead of silently showing demo numbers as if they were real.
 *
 * 5. Guests (no userId, no explicit demo) → mockProvider (unavoidable;
 *    there's no user-scoped data to serve).
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
  if (isExplicitDemoScope(ctx)) {
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
 * Errors that mean "this provider can't fulfill the request right now".
 */
function isFallbackableError(err: unknown): boolean {
  return (
    err instanceof ProviderNotImplementedError ||
    err instanceof ProviderRequiresUserError ||
    err instanceof ProviderNoDataError ||
    err instanceof ProviderFeatureUnsupportedError
  );
}

/**
 * Stamp providerId + capabilities + dataQuality on a result envelope so
 * downstream code (UI, exports) can rely on them being present even if a
 * provider implementation forgets to fill them in.
 */
function stampEnvelope<T extends ProviderResultEnvelope>(
  provider: DataProvider,
  result: T,
): T {
  return {
    ...result,
    providerId: result.providerId ?? provider.id,
    providerName: result.providerName ?? provider.name,
    dataQuality: result.dataQuality ?? provider.dataQuality,
    capabilities: result.capabilities ?? provider.capabilities,
  };
}

/**
 * Convenience wrapper: call a provider method and handle fallback.
 *
 * PR #23 behavioral change: mock fallback is only allowed when:
 *   - The user explicitly opted into demo mode (datasetScope.kind === "demo"), OR
 *   - The caller is a guest (no userId — nothing else to serve), OR
 *   - The error is a `ProviderFeatureUnsupportedError` (e.g. official
 *     provider doesn't support heatmap — falling back to mock for that
 *     specific feature is acceptable since the user's "real data" for
 *     that feature simply doesn't exist anywhere).
 *
 * When fallback is NOT allowed (signed-in user, non-demo scope, error is
 * ProviderNoData or ProviderRequiresUser), we re-throw so the API route
 * can surface an honest empty state rather than silently showing synthetic
 * demo numbers the user might mistake for real Adobe data.
 */
export async function runProvider<T extends ProviderResultEnvelope>(
  ctx: ProviderContext | undefined,
  fn: (p: DataProvider) => Promise<T>,
): Promise<T> {
  const provider = await selectProvider(ctx);
  try {
    const out = await fn(provider);
    return stampEnvelope(provider, out);
  } catch (err) {
    if (isFallbackableError(err)) {
      // Determine if mock fallback is permitted.
      const allowMockFallback =
        isExplicitDemoScope(ctx) ||
        !ctx?.userId ||
        err instanceof ProviderFeatureUnsupportedError;

      if (allowMockFallback) {
        console.warn(
          `[providers] ${(err as Error).message} — falling back to mock.`,
        );
        const out = await fn(mockProvider);
        return stampEnvelope(mockProvider, out);
      }

      // For signed-in users NOT in demo mode: do NOT silently substitute
      // mock data. Re-throw so the API layer returns an honest "no data"
      // response the UI can render as a clean empty state with CTAs.
      console.warn(
        `[providers] ${(err as Error).message} — NOT falling back to mock (user is signed in, scope is not demo).`,
      );
      throw err;
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
  filters?: HeatmapFilters,
): Promise<ProviderHeatmapResult> {
  return runProvider(ctx, (p) => p.heatmap(ctx, filters));
}

export async function runTrending(
  ctx?: ProviderContext,
  filters?: TrendingFilters,
): Promise<ProviderTrendingResult> {
  return runProvider(ctx, (p) => p.trending(ctx, filters));
}

export async function runSimilar(
  req: ProviderSimilarRequest,
  ctx?: ProviderContext,
): Promise<ProviderSimilarResult> {
  return runProvider(ctx, (p) => p.similar(req, ctx));
}

export async function runDashboard(
  ctx?: ProviderContext,
): Promise<ProviderDashboardResult> {
  return runProvider(ctx, (p) => p.dashboard(ctx));
}

export { mockProvider, officialAdobeProvider, manualImportProvider, liveScraperProvider };
export type {
  DashboardKeywordHighlight,
  DataProvider,
  DataQuality,
  HeatmapContentType,
  HeatmapFilters,
  HeatmapPeriod,
  HeatmapSort,
  HeatmapTile,
  ProviderCapabilities,
  ProviderContext,
  ProviderDashboardResult,
  ProviderFeatureSupport,
  ProviderSearchRequest,
  ProviderSearchResult,
  ProviderContributorResult,
  ProviderHeatmapResult,
  ProviderSimilarRequest,
  ProviderSimilarResult,
  ProviderTrendingResult,
  RisingNiche,
  SeasonalTrend,
  TopPerformer,
  TrendingContentType,
  TrendingFilters,
  TrendingKeyword,
  TrendingPeriod,
  TrendingSort,
} from "./types";
export { DATA_QUALITY_LABELS, DATA_QUALITY_DESCRIPTIONS } from "./types";




