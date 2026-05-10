/**
 * User-facing provider/cache messages (PR #25).
 *
 * Centralizes all status messages the UI surfaces when a provider is
 * unavailable, cache is stale, or data doesn't exist. These messages
 * NEVER expose raw parser errors, internal paths, or technical details
 * to normal users.
 *
 * Usage: import from this module in any page or component that needs to
 * render a provider state notice.
 */

export const PROVIDER_MESSAGES = {
  // --- Public metadata provider ---
  publicMetadataUnavailable:
    "Public metadata is currently unavailable. Cached data will be shown when available.",
  publicMetadataNotConfigured:
    "No public metadata source configured. Set up the provider in your environment to see real Adobe Stock metadata.",
  publicMetadataBlocked:
    "Adobe Stock declined the request. No bypass is attempted. Try again later or use cached data.",
  publicMetadataTimeout:
    "Adobe Stock timed out. Showing cached results if available.",
  publicMetadataParsingFailed:
    "Could not parse the Adobe Stock page. The page structure may have changed. Showing cached data if available.",

  // --- Cache states ---
  usingFreshCache: "Showing cached public metadata.",
  usingStaleCache:
    "Using cached data (may be outdated). The next search will attempt a fresh fetch.",
  cacheEmpty:
    "No cached data available. Run a search with the public metadata provider enabled to start populating the cache.",
  cacheRefreshed:
    "Cache marked for refresh. Next searches will fetch fresh data from Adobe Stock.",

  // --- Manual import ---
  noImportedData:
    "No imported data found. Import a CSV from the Import page to analyze your own Adobe Stock portfolio.",
  importAvailable:
    "Using your imported data. Results are tagged Verified.",

  // --- Demo mode ---
  demoModeActive:
    "Demo mode active. All numbers are synthetic and tagged Demo Data.",
  demoModeAvailable:
    "Try demo mode to explore the interface with sample data.",

  // --- General ---
  signInRequired:
    "Sign in to access your imported data and personalized analytics.",
  providerFallbackNotice:
    "The requested data source could not be reached. Showing the best available alternative.",
  noDataConfigured:
    "No data source configured. Import a CSV, configure the public metadata provider, or switch to demo mode.",

  // --- Downloads / metrics ---
  downloadsUnavailable:
    "Download counts are not available from this source. Public Adobe Stock pages do not expose verified download numbers.",
  metricsUnavailable:
    "Performance metrics are not available from public pages and are labeled Unavailable.",
} as const;

export type ProviderMessageKey = keyof typeof PROVIDER_MESSAGES;

/**
 * Get a user-facing message by key. Safe to call with any string —
 * returns a generic fallback if the key is unrecognized.
 */
export function getProviderMessage(key: string): string {
  if (key in PROVIDER_MESSAGES) {
    return PROVIDER_MESSAGES[key as ProviderMessageKey];
  }
  return "Data source status unknown. The app will show what's available.";
}
