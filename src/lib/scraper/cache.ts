/**
 * DB-backed cache for the public Adobe Stock metadata scraper.
 *
 * PR #22 foundation. Uses the already-present `CachedSearch` and
 * `CachedAsset` Prisma models (originally stubbed in PR #1 and unused
 * until now) so we don't churn the schema.
 *
 * Cache policy:
 *
 *   - Search results: ~24h TTL (`SEARCH_TTL_MS`). Within the window a
 *     request skips the network entirely ("cache-first"). Beyond the
 *     window we re-scrape; if the re-scrape fails with a block /
 *     transient error, callers may still fall back to the stale cache
 *     row via `readCachedSearch({ allowStale: true })`.
 *
 *   - Asset details: ~7d TTL (`ASSET_TTL_MS`). Individual rows are
 *     refreshed lazily — a cache miss for one asset does not block a
 *     search response; the provider hydrates whatever rows it has and
 *     returns the rest with partial-metadata placeholders that the UI
 *     will show as Unavailable.
 *
 * The schema's numeric download / performance columns are stored as
 * `0` for public-metadata rows. We intentionally DO NOT persist fake
 * numbers there — the provider layer always sets `metricsAvailable:
 * false` when hydrating a cached asset back into a `SearchAsset`, so
 * the UI renders "—" / "Unavailable" for downloads + performance.
 *
 * Security / abuse considerations (see PR brief "Not allowed" list):
 *
 *   - This module does no network I/O. The only I/O is Prisma. It
 *     cannot be abused to bypass the rate limiter or the allowlist.
 *   - Cache keys are normalized so two callers with equivalent
 *     requests share a row, minimizing scrape traffic against Adobe.
 *   - Writes are best-effort: a cache write failure never fails a
 *     user request (caller swallows via `.catch`).
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SearchAsset } from "@/types/search";
import type { PublicAdobeAsset } from "./public-adobe-stock";
import { normalizePublicUrl } from "./public-adobe-stock";

export const SEARCH_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours
export const ASSET_TTL_MS = 7 * 24 * 60 * 60 * 1_000; // 7 days

/**
 * Bounded cap on how many assets we store per cache row. Adobe search
 * pages typically return 60–100 cards; we keep up to 120 to have a
 * little head-room, no more. This is a soft cap to protect against a
 * malformed page inflating the cache to an unreasonable size.
 */
const MAX_ASSETS_PER_SEARCH = 120;

/** Normalized key for the `CachedSearch` unique index. */
export interface CachedSearchKey {
  keyword: string;
  sort?: string;
  contentType?: string;
  aiFilter?: string;
  page?: number;
}

function normalizeKey(k: CachedSearchKey): {
  keyword: string;
  sort: string;
  contentType: string;
  aiFilter: string;
  page: number;
} {
  return {
    keyword: k.keyword.trim().toLowerCase(),
    sort: (k.sort ?? "relevance").toLowerCase(),
    contentType: (k.contentType ?? "all").toLowerCase(),
    aiFilter: (k.aiFilter ?? "all").toLowerCase(),
    page: k.page && k.page > 0 ? k.page : 1,
  };
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function stringifyJsonArray(arr: string[] | undefined): string {
  if (!arr || arr.length === 0) return "[]";
  return JSON.stringify(arr);
}

// ---------------------------------------------------------------------------
// Search cache
// ---------------------------------------------------------------------------

export interface CachedSearchHit {
  /** The asset ids in the order the scraper saw them. */
  assetIds: string[];
  totalResults: number;
  scrapedAt: Date;
  /** True when the row is older than `SEARCH_TTL_MS`. */
  stale: boolean;
  competitionLevel?: string | null;
  aiSaturation?: number | null;
}

/**
 * Read a search-cache row. By default only returns fresh rows; pass
 * `allowStale: true` to also get rows older than the TTL (useful as a
 * last-ditch fallback when a live scrape fails).
 */
export async function readCachedSearch(
  key: CachedSearchKey,
  opts?: { allowStale?: boolean },
): Promise<CachedSearchHit | null> {
  const norm = normalizeKey(key);
  const row = await prisma.cachedSearch
    .findUnique({
      where: {
        keyword_sort_contentType_aiFilter_page: {
          keyword: norm.keyword,
          sort: norm.sort,
          contentType: norm.contentType,
          aiFilter: norm.aiFilter,
          page: norm.page,
        },
      },
    })
    .catch(() => null);

  if (!row) return null;

  const age = Date.now() - row.scrapedAt.getTime();
  const stale = age > SEARCH_TTL_MS;
  if (stale && !opts?.allowStale) return null;

  return {
    assetIds: parseJsonArray(row.resultIdsJson),
    totalResults: row.totalResults,
    scrapedAt: row.scrapedAt,
    stale,
    competitionLevel: row.competitionLevel,
    aiSaturation: row.aiSaturation ?? null,
  };
}

export async function writeCachedSearch(
  key: CachedSearchKey,
  payload: {
    assetIds: string[];
    totalResults: number;
    competitionLevel?: string | null;
    aiSaturation?: number | null;
  },
): Promise<void> {
  const norm = normalizeKey(key);
  const ids = payload.assetIds.slice(0, MAX_ASSETS_PER_SEARCH);
  const data: Prisma.CachedSearchUncheckedCreateInput = {
    keyword: norm.keyword,
    sort: norm.sort,
    contentType: norm.contentType,
    aiFilter: norm.aiFilter,
    page: norm.page,
    totalResults: Number.isFinite(payload.totalResults)
      ? payload.totalResults
      : ids.length,
    resultIdsJson: stringifyJsonArray(ids),
    competitionLevel: payload.competitionLevel ?? null,
    aiSaturation:
      typeof payload.aiSaturation === "number" ? payload.aiSaturation : null,
    scrapedAt: new Date(),
  };
  await prisma.cachedSearch
    .upsert({
      where: {
        keyword_sort_contentType_aiFilter_page: {
          keyword: norm.keyword,
          sort: norm.sort,
          contentType: norm.contentType,
          aiFilter: norm.aiFilter,
          page: norm.page,
        },
      },
      create: data,
      update: {
        totalResults: data.totalResults,
        resultIdsJson: data.resultIdsJson,
        competitionLevel: data.competitionLevel,
        aiSaturation: data.aiSaturation,
        scrapedAt: data.scrapedAt,
      },
    })
    .catch(() => {
      // Cache writes must never break a user request. A failing write
      // usually means the DB was hot-swapped under us (Supabase pooler
      // restarts) — we'll try again on the next search.
    });
}

// ---------------------------------------------------------------------------
// Asset cache
// ---------------------------------------------------------------------------

export interface CachedAssetHit {
  asset: SearchAsset;
  scrapedAt: Date;
  stale: boolean;
}

/**
 * Hydrate a `CachedAsset` row back into the `SearchAsset` shape the UI
 * expects. Critically sets `metricsAvailable: false` so downloads +
 * performance render as "Unavailable", NOT as a fake `0`.
 */
function hydrate(
  row: Awaited<ReturnType<typeof prisma.cachedAsset.findUnique>>,
): SearchAsset | null {
  if (!row) return null;
  return {
    id: row.adobeStockId,
    thumbnailUrl: row.thumbnailUrl,
    title: row.title,
    downloads: row.downloads,
    performanceScore: row.performanceScore,
    downloadsPerMonth: row.downloadsPerMonth,
    categories: parseJsonArray(row.categoriesJson),
    contentType: row.contentType || "unknown",
    uploadDate: row.uploadDate.toISOString(),
    contributorName: row.contributorName || "(unknown contributor)",
    contributorId: row.contributorId || "",
    isPremium: row.isPremium,
    isAiGenerated: row.isAiGenerated,
    keywords: parseJsonArray(row.keywordsJson),
    adobeStockUrl: "", // CachedAsset doesn't carry the canonical URL —
    // the caller (publicMetadataProvider) stitches it in from a lookup
    // against the most recent scrape, or falls back to the keyword-
    // search resolver. Leaving empty here is intentional.
    metricsAvailable: false,
  };
}

export async function readCachedAsset(
  adobeStockId: string,
  opts?: { allowStale?: boolean },
): Promise<CachedAssetHit | null> {
  if (!adobeStockId) return null;
  const row = await prisma.cachedAsset
    .findUnique({ where: { adobeStockId } })
    .catch(() => null);
  if (!row) return null;
  const age = Date.now() - row.lastScrapedAt.getTime();
  const stale = age > ASSET_TTL_MS;
  if (stale && !opts?.allowStale) return null;
  const asset = hydrate(row);
  if (!asset) return null;
  return { asset, scrapedAt: row.lastScrapedAt, stale };
}

export async function readCachedAssets(
  ids: string[],
  opts?: { allowStale?: boolean },
): Promise<Map<string, CachedAssetHit>> {
  const out = new Map<string, CachedAssetHit>();
  if (!ids.length) return out;
  const rows = await prisma.cachedAsset
    .findMany({ where: { adobeStockId: { in: ids } } })
    .catch(() => [] as Awaited<ReturnType<typeof prisma.cachedAsset.findMany>>);
  const now = Date.now();
  for (const row of rows) {
    const age = now - row.lastScrapedAt.getTime();
    const stale = age > ASSET_TTL_MS;
    if (stale && !opts?.allowStale) continue;
    const asset = hydrate(row);
    if (!asset) continue;
    out.set(row.adobeStockId, { asset, scrapedAt: row.lastScrapedAt, stale });
  }
  return out;
}

/**
 * Upsert a scraped public asset into the cache. Zero-fills numeric
 * download / performance columns because public pages don't expose
 * them — we NEVER fabricate numbers here. The provider layer is
 * responsible for setting `metricsAvailable: false` on hydration so
 * the UI labels the figures correctly.
 */
export async function writeCachedAsset(
  asset: PublicAdobeAsset,
): Promise<void> {
  if (!asset?.id) return;
  const now = new Date();
  const data: Prisma.CachedAssetUncheckedCreateInput = {
    adobeStockId: String(asset.id),
    thumbnailUrl: normalizePublicUrl(asset.thumbnailUrl) || asset.thumbnailUrl || "",
    title: asset.title || "(untitled)",
    downloads: 0,
    performanceScore: 0,
    downloadsPerMonth: 0,
    categoriesJson: stringifyJsonArray(asset.categories),
    contentType: asset.contentType || "unknown",
    // The public search page rarely exposes an upload date. We keep the
    // schema's required DateTime satisfied by stamping the unix epoch —
    // callers treat epoch 0 as "no reliable upload date known".
    uploadDate: new Date(0),
    contributorName: asset.contributorName || "",
    contributorId: "", // public pages surface name, not internal id
    isPremium: asset.isPremium ?? false,
    isAiGenerated: asset.isAiGenerated ?? false,
    keywordsJson: stringifyJsonArray(asset.keywords),
    lastScrapedAt: now,
  };
  await prisma.cachedAsset
    .upsert({
      where: { adobeStockId: data.adobeStockId },
      create: data,
      update: {
        thumbnailUrl: data.thumbnailUrl,
        title: data.title,
        categoriesJson: data.categoriesJson,
        contentType: data.contentType,
        contributorName: data.contributorName,
        isPremium: data.isPremium,
        isAiGenerated: data.isAiGenerated,
        keywordsJson: data.keywordsJson,
        lastScrapedAt: data.lastScrapedAt,
      },
    })
    .catch(() => {
      // Best-effort; see writeCachedSearch for rationale.
    });
}

export async function writeCachedAssets(
  assets: PublicAdobeAsset[],
): Promise<void> {
  // Serialize the upserts — SQLite can't take a large batch of concurrent
  // write transactions gracefully and we don't need the parallelism.
  for (const a of assets) {
    // eslint-disable-next-line no-await-in-loop
    await writeCachedAsset(a);
  }
}
