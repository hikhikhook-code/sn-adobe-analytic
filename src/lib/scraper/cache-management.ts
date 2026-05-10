/**
 * Cache management helpers (PR #25).
 *
 * Provides read-only stats and a safe cache refresh action for the
 * Settings → Data Sources UI. Does NOT initiate aggressive scraping.
 * The "refresh" action only expires stale entries — the next real
 * user request will trigger a single live fetch if the scraper is
 * enabled.
 *
 * Hard rules:
 *   - No bulk fetching / crawling triggered from this module.
 *   - No private APIs or credentials exposed.
 *   - Cache invalidation is "soft" — we mark entries as expired so
 *     the next organic request re-fetches, rather than proactively
 *     scraping Adobe Stock.
 */

import { prisma } from "@/lib/prisma";
import { SEARCH_TTL_MS, ASSET_TTL_MS, CONTRIBUTOR_TTL_MS } from "./cache";

export interface CacheStats {
  searches: { total: number; fresh: number; stale: number };
  assets: { total: number; fresh: number; stale: number };
  contributors: { total: number; fresh: number; stale: number };
}

/**
 * Get cache statistics (total / fresh / stale counts). Best-effort;
 * never throws.
 */
export async function getCacheStats(): Promise<CacheStats> {
  const now = new Date();
  const stats: CacheStats = {
    searches: { total: 0, fresh: 0, stale: 0 },
    assets: { total: 0, fresh: 0, stale: 0 },
    contributors: { total: 0, fresh: 0, stale: 0 },
  };

  try {
    stats.searches.total = await prisma.cachedSearch.count();
    stats.searches.fresh = await prisma.cachedSearch.count({
      where: { expiresAt: { gt: now } },
    });
    stats.searches.stale = stats.searches.total - stats.searches.fresh;
  } catch { /* table may not exist */ }

  try {
    stats.assets.total = await prisma.cachedAsset.count();
    stats.assets.fresh = await prisma.cachedAsset.count({
      where: { expiresAt: { gt: now } },
    });
    stats.assets.stale = stats.assets.total - stats.assets.fresh;
  } catch { /* table may not exist */ }

  try {
    stats.contributors.total = await prisma.cachedContributor.count();
    stats.contributors.fresh = await prisma.cachedContributor.count({
      where: { expiresAt: { gt: now } },
    });
    stats.contributors.stale =
      stats.contributors.total - stats.contributors.fresh;
  } catch { /* table may not exist */ }

  return stats;
}

/**
 * Soft-invalidate all cache entries by setting their expiresAt to the
 * past. The next organic user request will trigger a fresh fetch if
 * the scraper is enabled. If the fetch fails, stale entries are still
 * served as fallback (standard cache behavior).
 *
 * This does NOT:
 *   - Delete any rows (they serve as stale fallback)
 *   - Trigger any live scrape requests
 *   - Touch the Adobe Stock origin
 *
 * Returns the number of entries invalidated.
 */
export async function softInvalidateCache(): Promise<{
  searchesInvalidated: number;
  assetsInvalidated: number;
  contributorsInvalidated: number;
}> {
  const now = new Date();
  // Set expiresAt to 1ms ago — marks as stale without deleting
  const pastDate = new Date(now.getTime() - 1);

  let searchesInvalidated = 0;
  let assetsInvalidated = 0;
  let contributorsInvalidated = 0;

  try {
    const result = await prisma.cachedSearch.updateMany({
      where: { expiresAt: { gt: now } },
      data: { expiresAt: pastDate },
    });
    searchesInvalidated = result.count;
  } catch { /* table may not exist */ }

  try {
    const result = await prisma.cachedAsset.updateMany({
      where: { expiresAt: { gt: now } },
      data: { expiresAt: pastDate },
    });
    assetsInvalidated = result.count;
  } catch { /* table may not exist */ }

  try {
    const result = await prisma.cachedContributor.updateMany({
      where: { expiresAt: { gt: now } },
      data: { expiresAt: pastDate },
    });
    contributorsInvalidated = result.count;
  } catch { /* table may not exist */ }

  return { searchesInvalidated, assetsInvalidated, contributorsInvalidated };
}

/**
 * Hard-delete expired cache entries older than the given threshold.
 * Useful for keeping the DB lean over time. Default threshold: entries
 * that expired more than 30 days ago.
 *
 * Returns the number of entries purged.
 */
export async function purgeExpiredCache(
  olderThanDays: number = 30,
): Promise<number> {
  const threshold = new Date(
    Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
  );
  let purged = 0;

  try {
    const r = await prisma.cachedSearch.deleteMany({
      where: { expiresAt: { lt: threshold } },
    });
    purged += r.count;
  } catch { /* table may not exist */ }

  try {
    const r = await prisma.cachedAsset.deleteMany({
      where: { expiresAt: { lt: threshold } },
    });
    purged += r.count;
  } catch { /* table may not exist */ }

  try {
    const r = await prisma.cachedContributor.deleteMany({
      where: { expiresAt: { lt: threshold } },
    });
    purged += r.count;
  } catch { /* table may not exist */ }

  return purged;
}

/**
 * User-facing messages for cache/provider states. These are the only
 * messages the UI should display — never raw error strings.
 */
export const USER_MESSAGES = {
  publicMetadataUnavailable:
    "Public metadata is currently unavailable. The app will use cached data when available, or show an honest empty state.",
  usingCachedMetadata:
    "Using cached public metadata. Results may be up to 24 hours old.",
  noCachedDataYet:
    "No cached data yet. Run a search with PUBLIC_SCRAPER_ENABLED=true to start populating the cache.",
  importCsvPrompt:
    "Import a CSV to analyze your own Adobe Stock data with verified numbers.",
  tryDemoMode:
    "Try demo mode to explore the interface with synthetic data.",
  cacheRefreshed:
    "Cache marked for refresh. The next search will fetch fresh data from Adobe Stock.",
  providerNotConfigured:
    "No public metadata source configured. Set OFFICIAL_PROVIDER_BASE_URL or enable the public scraper.",
  scrapeFailed:
    "Could not fetch fresh data from Adobe Stock. Showing cached results if available.",
  parsingFailed:
    "The public page structure may have changed. Showing cached results if available.",
} as const;
