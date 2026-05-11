/**
 * Provider health status module (PR #25).
 *
 * Surfaces the configured/available state of every data provider
 * without triggering live scrape requests. Used by `/api/providers/health`
 * and the Settings → Data Sources UI card.
 *
 * This module NEVER initiates a live Adobe Stock request. It only reads
 * env vars, checks Prisma table counts, and reports timestamps from
 * the cache layer. No network traffic, no proxy rotation, no secret exposure.
 */

import { prisma } from "@/lib/prisma";
import { isPublicScraperEnabled } from "@/lib/scraper/public-adobe-stock";

export type ProviderStatus = "configured" | "not_configured" | "disabled";
export type ProviderAvailability = "available" | "unavailable" | "unknown";

export interface ProviderHealthEntry {
  id: string;
  name: string;
  status: ProviderStatus;
  availability: ProviderAvailability;
  notice?: string;
  /** ISO timestamp of the most recent successful cache write for this source. */
  lastSuccessfulFetch?: string;
  /** Human-readable last error if one was encountered (never raw stack traces). */
  lastError?: string;
}

export interface CacheHealthSummary {
  searchCount: number;
  assetCount: number;
  contributorCount: number;
  searchTtlHours: number;
  assetTtlDays: number;
  contributorTtlDays: number;
  oldestSearchFetch?: string;
  newestSearchFetch?: string;
  oldestAssetFetch?: string;
  newestAssetFetch?: string;
}

export interface ProviderHealthReport {
  providers: ProviderHealthEntry[];
  cache: CacheHealthSummary;
  activeProvider: string;
  demoModeAvailable: boolean;
  manualImportAvailable: boolean;
}

/**
 * Compute the health report. Safe to call from any server context.
 * Never throws — best-effort on every section.
 */
export async function getProviderHealthReport(
  userId?: string,
): Promise<ProviderHealthReport> {
  const activeProvider = (process.env.DATA_PROVIDER ?? "mock").toLowerCase();

  // --- Mock provider ---
  const mockHealth: ProviderHealthEntry = {
    id: "mock",
    name: "Mock / Demo Provider",
    status: "configured",
    availability: "available",
    notice: "Always available. Produces synthetic demo data tagged Demo Data.",
  };

  // --- Manual provider ---
  let manualImportAvailable = false;
  let manualNotice = "No imported datasets found.";
  if (userId) {
    try {
      const count = await prisma.importedDataset.count({
        where: { userId, archived: false },
      });
      if (count > 0) {
        manualImportAvailable = true;
        manualNotice = `${count} imported dataset${count > 1 ? "s" : ""} available.`;
      }
    } catch {
      manualNotice = "Could not check imported datasets (table may not exist yet).";
    }
  } else {
    manualNotice = "Sign in to use imported data.";
  }
  const manualHealth: ProviderHealthEntry = {
    id: "manual",
    name: "Manual Import Provider",
    status: manualImportAvailable ? "configured" : "not_configured",
    availability: manualImportAvailable ? "available" : "unavailable",
    notice: manualNotice,
  };

  // --- Public metadata provider ---
  const httpBoundary = process.env.OFFICIAL_PROVIDER_BASE_URL?.trim();
  const scraperEnabled = isPublicScraperEnabled();
  const publicConfigured = !!(httpBoundary || scraperEnabled);

  let publicNotice: string;
  let publicAvailability: ProviderAvailability = "unknown";
  if (httpBoundary && scraperEnabled) {
    publicNotice = "HTTP boundary configured + public scraper enabled.";
    publicAvailability = "available";
  } else if (httpBoundary) {
    publicNotice = `HTTP boundary configured: ${httpBoundary.slice(0, 40)}…`;
    publicAvailability = "available";
  } else if (scraperEnabled) {
    publicNotice = "Public Adobe Stock scraper enabled (no HTTP boundary).";
    publicAvailability = "available";
  } else {
    publicNotice =
      "Not configured. Set OFFICIAL_PROVIDER_BASE_URL or PUBLIC_SCRAPER_ENABLED=true.";
    publicAvailability = "unavailable";
  }

  // Check most recent cache entries to determine last successful fetch
  let lastSuccessfulFetch: string | undefined;
  try {
    const latest = await prisma.cachedSearch.findFirst({
      where: { source: httpBoundary ? "official_api" : "public_scrape" },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true },
    });
    if (latest) lastSuccessfulFetch = latest.fetchedAt.toISOString();
  } catch { /* table may not exist */ }

  const publicHealth: ProviderHealthEntry = {
    id: "official",
    name: "Public Metadata Provider",
    status: publicConfigured ? "configured" : "not_configured",
    availability: publicAvailability,
    notice: publicNotice,
    lastSuccessfulFetch,
  };

  // --- Cache summary ---
  const cache = await getCacheHealthSummary();

  // --- Demo mode ---
  const demoModeAvailable = true; // Always available via dataset selector

  return {
    providers: [mockHealth, manualHealth, publicHealth],
    cache,
    activeProvider,
    demoModeAvailable,
    manualImportAvailable,
  };
}

async function getCacheHealthSummary(): Promise<CacheHealthSummary> {
  let searchCount = 0;
  let assetCount = 0;
  let contributorCount = 0;
  let oldestSearchFetch: string | undefined;
  let newestSearchFetch: string | undefined;
  let oldestAssetFetch: string | undefined;
  let newestAssetFetch: string | undefined;

  try {
    searchCount = await prisma.cachedSearch.count();
    if (searchCount > 0) {
      const oldest = await prisma.cachedSearch.findFirst({
        orderBy: { fetchedAt: "asc" },
        select: { fetchedAt: true },
      });
      const newest = await prisma.cachedSearch.findFirst({
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      });
      if (oldest) oldestSearchFetch = oldest.fetchedAt.toISOString();
      if (newest) newestSearchFetch = newest.fetchedAt.toISOString();
    }
  } catch { /* table may not exist */ }

  try {
    assetCount = await prisma.cachedAsset.count();
    if (assetCount > 0) {
      const oldest = await prisma.cachedAsset.findFirst({
        orderBy: { fetchedAt: "asc" },
        select: { fetchedAt: true },
      });
      const newest = await prisma.cachedAsset.findFirst({
        orderBy: { fetchedAt: "desc" },
        select: { fetchedAt: true },
      });
      if (oldest) oldestAssetFetch = oldest.fetchedAt.toISOString();
      if (newest) newestAssetFetch = newest.fetchedAt.toISOString();
    }
  } catch { /* table may not exist */ }

  try {
    contributorCount = await prisma.cachedContributor.count();
  } catch { /* table may not exist */ }

  return {
    searchCount,
    assetCount,
    contributorCount,
    searchTtlHours: 24,
    assetTtlDays: 7,
    contributorTtlDays: 7,
    oldestSearchFetch,
    newestSearchFetch,
    oldestAssetFetch,
    newestAssetFetch,
  };
}
