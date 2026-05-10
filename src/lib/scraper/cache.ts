/**
 * Public metadata cache — cache-first read path backing the
 * public-metadata provider (PR #22, expanded in PR #24).
 *
 * Three tables (see `prisma/schema.prisma`):
 *
 *   CachedSearch — one row per (source × keyword × sort × contentType
 *     × aiFilter × page). `payloadJson` is the exact
 *     `ProviderSearchResult` the UI consumes; reads are one SELECT +
 *     one JSON.parse, no joins.
 *   CachedAsset  — one row keyed by (source × assetId), carrying the
 *     asset detail payload verbatim (PR #24 now populates this from
 *     asset detail page scraping).
 *   CachedContributor — one row keyed by (source × contributorId),
 *     carrying the contributor metadata payload (PR #24).
 *
 * TTL policy:
 *   - search results:      ~24h
 *   - asset details:       ~7d
 *   - contributor metadata: ~7d
 *
 * Freshness policy:
 *   - `readSearchCache` / `readAssetCache` / `readContributorCache`
 *     return a row as `fresh` when `expiresAt > now()`. The provider
 *     uses the fresh payload directly and skips the live fetch.
 *   - When `expiresAt <= now()` we still return the row, but flag it
 *     `stale`. The provider attempts a live fetch first; if that
 *     fails or is blocked, it falls back to the stale payload so the
 *     UI doesn't go dark.
 *   - When no row exists we return `null` and the provider must fetch
 *     live (or surface an unavailable state).
 *
 * Everything is best-effort: a failed cache read / write never breaks
 * the request. We log and continue.
 */

import { prisma } from "@/lib/prisma";

/** TTL for search-result payloads. PR #22 brief: "around 24h". */
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

/** TTL for asset-detail payloads. PR #22 brief: "around 7d". */
export const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** TTL for contributor metadata payloads. PR #24: "around 7d". */
export const CONTRIBUTOR_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Source tag distinguishing rows produced by different upstreams. New
 * sources can be added without touching the schema (it's just a
 * string column).
 */
export type CacheSource = "public_scrape" | "official_api";

export interface CachedEntry<T> {
  payload: T;
  fetchedAt: Date;
  expiresAt: Date;
  /** `true` when the row is still within its TTL. */
  fresh: boolean;
  source: CacheSource;
}

interface SearchCacheKey {
  source: CacheSource;
  keyword: string;
  sort: string;
  contentType: string;
  aiFilter: string;
  page: number;
}

function normalizeKey(key: SearchCacheKey): SearchCacheKey {
  return {
    source: key.source,
    keyword: key.keyword.trim().toLowerCase(),
    sort: key.sort || "relevance",
    contentType: key.contentType || "all",
    aiFilter: key.aiFilter || "all",
    page: key.page > 0 ? key.page : 1,
  };
}

/**
 * Read a search-result cache row. Returns the parsed payload + fresh
 * flag when a row exists, else `null`. Never throws — callers treat
 * read failures as cache misses.
 */
export async function readSearchCache<T>(
  key: SearchCacheKey,
): Promise<CachedEntry<T> | null> {
  const k = normalizeKey(key);
  try {
    const row = await prisma.cachedSearch.findUnique({
      where: {
        source_keyword_sort_contentType_aiFilter_page: {
          source: k.source,
          keyword: k.keyword,
          sort: k.sort,
          contentType: k.contentType,
          aiFilter: k.aiFilter,
          page: k.page,
        },
      },
    });
    if (!row) return null;
    const payload = safeParse<T>(row.payloadJson);
    if (!payload) return null;
    return {
      payload,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      fresh: row.expiresAt.getTime() > Date.now(),
      source: row.source as CacheSource,
    };
  } catch (err) {
    console.warn("[cache] readSearchCache failed:", (err as Error).message);
    return null;
  }
}

/**
 * Upsert a search-result cache row. TTL defaults to SEARCH_TTL_MS
 * above. Swallows errors — caching is an optimization, not the
 * critical path.
 */
export async function writeSearchCache<T>(
  key: SearchCacheKey,
  payload: T,
  ttlMs: number = SEARCH_TTL_MS,
): Promise<void> {
  const k = normalizeKey(key);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.cachedSearch.upsert({
      where: {
        source_keyword_sort_contentType_aiFilter_page: {
          source: k.source,
          keyword: k.keyword,
          sort: k.sort,
          contentType: k.contentType,
          aiFilter: k.aiFilter,
          page: k.page,
        },
      },
      create: {
        source: k.source,
        keyword: k.keyword,
        sort: k.sort,
        contentType: k.contentType,
        aiFilter: k.aiFilter,
        page: k.page,
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
      update: {
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
    });
  } catch (err) {
    console.warn("[cache] writeSearchCache failed:", (err as Error).message);
  }
}

export interface AssetCacheKey {
  source: CacheSource;
  assetId: string;
}

export async function readAssetCache<T>(
  key: AssetCacheKey,
): Promise<CachedEntry<T> | null> {
  try {
    const row = await prisma.cachedAsset.findUnique({
      where: {
        source_assetId: { source: key.source, assetId: key.assetId },
      },
    });
    if (!row) return null;
    const payload = safeParse<T>(row.payloadJson);
    if (!payload) return null;
    return {
      payload,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      fresh: row.expiresAt.getTime() > Date.now(),
      source: row.source as CacheSource,
    };
  } catch (err) {
    console.warn("[cache] readAssetCache failed:", (err as Error).message);
    return null;
  }
}

export async function writeAssetCache<T>(
  key: AssetCacheKey,
  payload: T,
  ttlMs: number = ASSET_TTL_MS,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.cachedAsset.upsert({
      where: {
        source_assetId: { source: key.source, assetId: key.assetId },
      },
      create: {
        source: key.source,
        assetId: key.assetId,
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
      update: {
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
    });
  } catch (err) {
    console.warn("[cache] writeAssetCache failed:", (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Contributor cache (PR #24)
// ---------------------------------------------------------------------------

export interface ContributorCacheKey {
  source: CacheSource;
  contributorId: string;
}

export async function readContributorCache<T>(
  key: ContributorCacheKey,
): Promise<CachedEntry<T> | null> {
  try {
    const row = await prisma.cachedContributor.findUnique({
      where: {
        source_contributorId: {
          source: key.source,
          contributorId: key.contributorId,
        },
      },
    });
    if (!row) return null;
    const payload = safeParse<T>(row.payloadJson);
    if (!payload) return null;
    return {
      payload,
      fetchedAt: row.fetchedAt,
      expiresAt: row.expiresAt,
      fresh: row.expiresAt.getTime() > Date.now(),
      source: row.source as CacheSource,
    };
  } catch (err) {
    console.warn("[cache] readContributorCache failed:", (err as Error).message);
    return null;
  }
}

export async function writeContributorCache<T>(
  key: ContributorCacheKey,
  payload: T,
  ttlMs: number = CONTRIBUTOR_TTL_MS,
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await prisma.cachedContributor.upsert({
      where: {
        source_contributorId: {
          source: key.source,
          contributorId: key.contributorId,
        },
      },
      create: {
        source: key.source,
        contributorId: key.contributorId,
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
      update: {
        payloadJson: JSON.stringify(payload),
        fetchedAt: now,
        expiresAt,
      },
    });
  } catch (err) {
    console.warn("[cache] writeContributorCache failed:", (err as Error).message);
  }
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
