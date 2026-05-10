import type { DataQuality, SearchAsset } from "@/types/search";

/**
 * Adobe Stock link resolver.
 *
 * Problem this solves (PR #19): mock / demo results used to expose
 * `https://stock.adobe.com/${id}` where `id` is a synthetic 9-digit
 * number. Those URLs look legitimate but almost always 404 on
 * stock.adobe.com — the user clicks a "View on Adobe Stock" button
 * and lands on an error page. Same thing for the contributor link:
 * `https://stock.adobe.com/contributor/${contributorId}` was wired
 * unconditionally, even when `contributorId` was a mock string like
 * "201234567" that doesn't match a real contributor.
 *
 * The fix keeps demo mode usable (that's deliberate — demo mode is
 * scoped to be removed in a later pre-production PR) but stops us
 * from ever generating fake Adobe detail URLs. Three hard rules:
 *
 *   1. Never emit a raw `stock.adobe.com/<id>` unless the data came
 *      from a source we trust to supply real URLs (`verified` from
 *      user-imported CSV, or `public_metadata` from a configured
 *      official provider that echoed a URL).
 *   2. When we don't have a real URL, prefer a SAFE search fallback:
 *      `https://stock.adobe.com/uk/search?k=<title>`. That page always
 *      exists, it's not a fake detail page, and it lets the user
 *      browse related assets. If we don't even have a title, emit a
 *      "no real URL available" sentinel so the UI can disable the
 *      button with clear copy instead of pretending a link exists.
 *   3. All app-generated Adobe Stock URLs use the UK locale
 *      (`/uk/...`). `/id/...` is the Indonesian locale and looks
 *      misleadingly like an "asset id" path to callers who don't know
 *      the Adobe Stock URL convention; we never want an app-generated
 *      link to land on `/id/`. Provider-supplied URLs that still
 *      carry `/id/` are normalized to `/uk/` on output via
 *      `normalizeAdobeStockUrl`.
 *
 * This module is intentionally client-safe (no DB / env / next-auth
 * imports) so it can be used from any page or server route without
 * dragging server runtime into the client bundle.
 */

/**
 * Canonical base URL for every app-generated Adobe Stock link. UK
 * locale is chosen deliberately (see rule #3 above — we never want
 * `/id/` in an app-generated URL).
 */
export const ADOBE_STOCK_BASE_URL = "https://stock.adobe.com/uk";

/**
 * Data-quality tiers that we consider "the URL on this asset is real
 * enough to link to directly". `demo` and `estimated` are explicitly
 * excluded: demo data is mock, and estimated data (e.g. our own
 * similarity ranking) is not authoritative enough to guarantee the
 * URL points at a real Adobe detail page.
 */
const TRUSTED_QUALITIES: ReadonlyArray<DataQuality> = [
  "verified",
  "public_metadata",
];

function isTrustedQuality(quality: DataQuality | undefined | null): boolean {
  if (!quality) return false;
  return TRUSTED_QUALITIES.includes(quality);
}

/**
 * A URL is "safe to link directly" if it points at the real
 * stock.adobe.com origin AND isn't the empty string. We deliberately
 * don't accept arbitrary `http://` URLs — Adobe Stock is always served
 * over HTTPS and restricting the origin prevents a misbehaving
 * provider from smuggling in a third-party URL.
 */
function looksLikeRealAdobeUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("https://stock.adobe.com/") ||
    trimmed.startsWith("http://stock.adobe.com/")
  );
}

/**
 * Rewrite any trusted Adobe Stock URL that still carries the `/id/`
 * locale prefix to use `/uk/` instead. Non-stock.adobe.com URLs, URLs
 * without a locale prefix, and URLs already on `/uk/` pass through
 * unchanged. Used by `resolveAssetLink` before handing a
 * provider-supplied URL to the UI.
 *
 * Examples:
 *   https://stock.adobe.com/id/images/foo/1234    -> https://stock.adobe.com/uk/images/foo/1234
 *   http://stock.adobe.com/id/12345               -> https://stock.adobe.com/uk/12345
 *     (also upgrades to https)
 *   https://stock.adobe.com/uk/images/foo/1234    -> unchanged
 *   https://stock.adobe.com/images/foo/1234       -> unchanged (we don't
 *     force locale on URLs that didn't request one)
 *   https://stock.adobe.com/fr/images/foo/1234    -> unchanged (we only
 *     rewrite the misleading `/id/` prefix per the PR brief)
 */
export function normalizeAdobeStockUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (!looksLikeRealAdobeUrl(trimmed)) return null;

  // Upgrade http -> https opportunistically. Adobe Stock redirects
  // http to https anyway, but an explicit https link avoids a
  // needless extra redirect hop and a mixed-content warning when the
  // app itself is served over https.
  const https = trimmed.replace(/^http:\/\//i, "https://");

  // Rewrite the `/id/` locale prefix only. Other locales (`/fr/`,
  // `/de/`, `/jp/`, …) are deliberately preserved — the brief is
  // specific to "never emit /id/", not "force /uk/ on every link".
  return https.replace(
    /^(https:\/\/stock\.adobe\.com)\/id(\/|$)/i,
    "$1/uk$2",
  );
}

/**
 * Build a keyword-search URL on Adobe Stock. Always safe — the search
 * page exists for every query, including garbage input. Encodes the
 * query so punctuation / spaces survive the round trip. UK locale
 * per the PR brief.
 */
export function adobeStockSearchUrl(keyword: string): string {
  const q = keyword.trim();
  if (!q) return `${ADOBE_STOCK_BASE_URL}/`;
  return `${ADOBE_STOCK_BASE_URL}/search?k=${encodeURIComponent(q)}`;
}

/**
 * Build a contributor-search URL on Adobe Stock. Same shape as
 * `adobeStockSearchUrl` but scoped to the creator_name facet, which
 * is what the actual Adobe Stock UI uses when you click a
 * contributor name from a result card. Also always safe. UK locale.
 */
export function adobeStockContributorSearchUrl(name: string): string {
  const n = name.trim();
  if (!n) return `${ADOBE_STOCK_BASE_URL}/`;
  return `${ADOBE_STOCK_BASE_URL}/search?creator_name=${encodeURIComponent(n)}`;
}

/**
 * Build a direct contributor-page URL on Adobe Stock, UK locale.
 * Only use this when `contributorId` comes from a trusted source —
 * mock rows generate numeric-looking contributor ids that aren't
 * real Adobe Stock accounts, so the caller must gate this on
 * `resolveContributorLink`'s trust checks.
 */
export function adobeStockContributorPageUrl(contributorId: string): string {
  return `${ADOBE_STOCK_BASE_URL}/contributor/${encodeURIComponent(
    contributorId,
  )}`;
}

export type AdobeLinkKind = "asset" | "search" | "contributor-search" | "none";

export interface ResolvedAdobeLink {
  /** URL the UI can put in an `href`, or `null` if no safe target exists. */
  href: string | null;
  /** Which flavor of link we settled on. Drives UI copy + tooltip. */
  kind: AdobeLinkKind;
  /** Short button / link label matched to the kind. */
  label: string;
  /** Longer tooltip / aria-description explaining WHY this kind. */
  reason: string;
}

export interface AssetLinkContext {
  /** Quality tier of the envelope this asset came from. */
  dataQuality?: DataQuality;
  /** Provider id ("mock" | "manual" | "official"). Optional — if both
   *  `dataQuality` and `providerId` say "real", we treat the asset URL
   *  as trustworthy. */
  providerId?: string;
}

/**
 * Decide the safest link for an asset's "View on Adobe Stock" button.
 *
 *   - Trusted quality (verified / public_metadata) AND a real
 *     stock.adobe.com URL → use the URL directly (normalized to /uk/).
 *   - Otherwise, fall back to a UK keyword search on the asset's title.
 *   - If the asset has neither a trustworthy URL nor a usable title,
 *     emit `kind: "none"` so the UI can disable the button.
 */
export function resolveAssetLink(
  asset: Pick<SearchAsset, "adobeStockUrl" | "title">,
  ctx: AssetLinkContext = {},
): ResolvedAdobeLink {
  const trustQuality = isTrustedQuality(ctx.dataQuality);
  // If the caller didn't pass a providerId we accept the URL based on
  // quality alone. Mock provider is explicitly excluded — mock URLs
  // are synthetic and MUST go through the search fallback, even if
  // the URL string technically starts with stock.adobe.com.
  const mockProvider = ctx.providerId === "mock";

  if (
    trustQuality &&
    !mockProvider &&
    looksLikeRealAdobeUrl(asset.adobeStockUrl)
  ) {
    const normalized = normalizeAdobeStockUrl(asset.adobeStockUrl);
    if (normalized) {
      return {
        href: normalized,
        kind: "asset",
        label: "View on Adobe Stock",
        reason:
          "Direct link to the Adobe Stock detail page for this asset (UK locale).",
      };
    }
  }

  const title = (asset.title ?? "").trim();
  if (title) {
    return {
      href: adobeStockSearchUrl(title),
      kind: "search",
      label: "Search on Adobe Stock",
      reason:
        "This is demo / mock data with no real Adobe Stock URL, so the link opens a UK keyword search on Adobe Stock instead.",
    };
  }

  return {
    href: null,
    kind: "none",
    label: "Demo asset — no real Adobe URL",
    reason:
      "This is demo / mock data and we don't have a real Adobe Stock URL or a searchable title for it.",
  };
}

/**
 * Heuristic: does this contributorId look like a real Adobe Stock
 * numeric contributor id? Real ones are pure digits. Demo rows in
 * `mock-data.ts` use numeric strings too, so digit-only is a necessary
 * but NOT sufficient signal — we always combine this with a
 * quality/provider check in `resolveContributorLink`.
 */
function looksLikeNumericContributorId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^\d{3,}$/.test(id.trim());
}

/**
 * Decide the safest link for an asset's contributor name / avatar.
 *
 *   - Trusted quality AND real numeric contributorId AND not mock →
 *     `https://stock.adobe.com/uk/contributor/<id>`.
 *   - Otherwise, if we have a contributor name → UK creator_name
 *     search on Adobe Stock. Lets the user at least browse related
 *     work without landing on a fake profile page.
 *   - Otherwise, `kind: "none"` so the UI can render the name as
 *     plain text with no link.
 */
export function resolveContributorLink(
  asset: Pick<SearchAsset, "contributorId" | "contributorName">,
  ctx: AssetLinkContext = {},
): ResolvedAdobeLink {
  const trustQuality = isTrustedQuality(ctx.dataQuality);
  const mockProvider = ctx.providerId === "mock";
  const numeric = looksLikeNumericContributorId(asset.contributorId);

  if (trustQuality && !mockProvider && numeric) {
    return {
      href: adobeStockContributorPageUrl(asset.contributorId),
      kind: "contributor-search",
      label: asset.contributorName,
      reason:
        "Direct link to the contributor page on Adobe Stock (UK locale).",
    };
  }

  const name = (asset.contributorName ?? "").trim();
  if (name) {
    return {
      href: adobeStockContributorSearchUrl(name),
      kind: "search",
      label: name,
      reason:
        "This is demo / mock data so the link opens a UK contributor-name search on Adobe Stock instead of a fake profile page.",
    };
  }

  return {
    href: null,
    kind: "none",
    label: "Unknown contributor",
    reason: "No contributor info available for this demo asset.",
  };
}
