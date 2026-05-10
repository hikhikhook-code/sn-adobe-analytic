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
 * "211100456" that doesn't match a real contributor.
 *
 * PR #19 hardening round 2 (post-review): bugs continued to reproduce
 * on demo data because individual callers could forget to plumb
 * `providerId` through, and the mock title decoration (`Business
 * scene #12`) made the keyword-search fallback dump the user on a
 * literal `"#12"` Adobe search. This revision:
 *
 *   1. Treats a MISSING / empty providerId the same as "mock" — the
 *      resolver is safe-by-default: callers must opt IN to direct
 *      Adobe URLs by passing both a trusted quality and a non-mock
 *      providerId. Drive-by callers that just pass `{ asset, title }`
 *      always get the UK keyword-search fallback.
 *   2. Never emits a direct `/uk/contributor/<id>` detail page, EVER.
 *      Even verified CSV rows go through the creator_name search
 *      fallback: imported CSVs aren't guaranteed to carry real Adobe
 *      contributor IDs (they're a display-only string in the CSV
 *      schema), and the 404 risk isn't worth the one-click win. The
 *      PR brief says "fallback or disable" — we fall back.
 *   3. Strips the demo-data `" #12"` tail (and collapses whitespace)
 *      from any title before using it as the `k=` param so the UK
 *      search page actually gets a real keyword. Also caps the query
 *      at 120 chars so a pathological title can't produce a 4KB URL.
 *
 * Three hard rules remain:
 *
 *   1. Never emit a raw `stock.adobe.com/<id>` unless the data came
 *      from a source we trust to supply real URLs (`verified` from
 *      user-imported CSV, or `public_metadata` from a configured
 *      official provider that echoed a URL) AND the providerId is
 *      not `mock`/empty.
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
 * Provider IDs we consider "safe to link directly from". Anything else
 * (including `mock`, `undefined`, empty string, or an unknown string)
 * falls through to the keyword-search fallback. Safe-by-default: a
 * caller that forgets to plumb providerId never emits a fake link.
 */
const TRUSTED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "manual",
  "official",
]);

function isTrustedProviderId(providerId: string | undefined | null): boolean {
  if (!providerId) return false;
  return TRUSTED_PROVIDER_IDS.has(providerId);
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
 * Clean a free-text title into something that makes sense as an Adobe
 * Stock search query:
 *
 *   - Strip the mock generator's trailing `" #12"` page-position suffix
 *     (pattern: space-hash-digits at end-of-string). Without this, a
 *     demo card titled `"Business scene #12"` would dump the user on
 *     the literal `"#12"` in the search URL, which Adobe displays as
 *     a tag search and returns garbage.
 *   - Collapse runs of whitespace to a single space.
 *   - Hard-cap at 120 characters. Adobe Stock accepts long queries
 *     but the URL starts to look hostile past that point, and a
 *     malicious CSV could otherwise inject a multi-KB query string.
 *   - Trim surrounding whitespace (including no-break / zero-width).
 */
function sanitizeKeywordQuery(raw: string): string {
  if (!raw) return "";
  let out = raw
    // Strip zero-width + no-break whitespace so they don't count
    // against the length budget and don't pollute the Adobe query.
    .replace(/[\u200B\u200C\u200D\uFEFF\u00A0]/g, " ")
    // Strip the mock " #12" decoration. Anchored to end-of-string so
    // a legitimate title like "Top 5 #summer2025" isn't truncated
    // when the hash is part of the user's wording (we only drop it
    // when it looks like our own page-position suffix).
    .replace(/\s+#\d+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > 120) out = out.slice(0, 120).trim();
  return out;
}

/**
 * Build a keyword-search URL on Adobe Stock. Always safe — the search
 * page exists for every query, including garbage input. Encodes the
 * query so punctuation / spaces survive the round trip. UK locale
 * per the PR brief.
 */
export function adobeStockSearchUrl(keyword: string): string {
  const q = sanitizeKeywordQuery(keyword);
  if (!q) return `${ADOBE_STOCK_BASE_URL}/`;
  return `${ADOBE_STOCK_BASE_URL}/search?k=${encodeURIComponent(q)}`;
}

/**
 * Build a contributor-search URL on Adobe Stock. Uses the `k=` facet
 * (matching the PR brief's fallback shape) rather than the
 * `creator_name=` facet so there's exactly one code path for "we
 * couldn't verify a real Adobe page — land them on a UK search". UK
 * locale.
 */
export function adobeStockContributorSearchUrl(name: string): string {
  const n = sanitizeKeywordQuery(name);
  if (!n) return `${ADOBE_STOCK_BASE_URL}/`;
  return `${ADOBE_STOCK_BASE_URL}/search?k=${encodeURIComponent(n)}`;
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
  /**
   * Provider id ("mock" | "manual" | "official"). Optional. When
   * omitted (or set to `mock`, empty string, or any unknown value)
   * the resolver treats the row as demo data and routes to the
   * keyword-search fallback — callers have to actively plumb a
   * trusted provider id to get a direct link.
   */
  providerId?: string;
}

/**
 * Decide the safest link for an asset's "View on Adobe Stock" button.
 *
 *   - Trusted quality (verified / public_metadata) AND trusted
 *     providerId (manual / official) AND a real stock.adobe.com URL
 *     → use the URL directly (normalized to /uk/).
 *   - Otherwise, fall back to a UK keyword search on the asset's
 *     title (sanitized — trailing " #12" suffix dropped).
 *   - If the asset has neither a trustworthy URL nor a usable title,
 *     emit `kind: "none"` so the UI can disable the button.
 *
 * Safe-by-default: anything ambiguous (missing providerId, `demo` /
 * `estimated` quality, empty URL) falls into the search-fallback
 * branch. A caller can never accidentally produce a direct Adobe
 * detail link.
 */
export function resolveAssetLink(
  asset: Pick<SearchAsset, "adobeStockUrl" | "title">,
  ctx: AssetLinkContext = {},
): ResolvedAdobeLink {
  const trusted =
    isTrustedQuality(ctx.dataQuality) && isTrustedProviderId(ctx.providerId);

  if (trusted && looksLikeRealAdobeUrl(asset.adobeStockUrl)) {
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

  const title = sanitizeKeywordQuery(asset.title ?? "");
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
 * Decide the safest link for an asset's contributor name / avatar.
 *
 * We deliberately NEVER emit a direct `/uk/contributor/<id>` URL.
 * The mock generator's synthetic 9-digit contributorIds (e.g.
 * "211100456") look real but 404 on stock.adobe.com, and
 * user-imported CSVs only carry contributorId as a display-only
 * string with no guarantee it matches a real Adobe account. The
 * PR #19 brief explicitly says "Use …/uk/search?k=<keyword> fallback
 * or disable" — we fall back.
 *
 *   - Contributor name present → UK keyword search on that name.
 *     Lets the user browse related work without landing on a fake
 *     profile page.
 *   - Otherwise → `kind: "none"` so the UI renders the placeholder
 *     label ("Unknown contributor") as plain text with no link.
 */
export function resolveContributorLink(
  asset: Pick<SearchAsset, "contributorId" | "contributorName">,
): ResolvedAdobeLink {
  // No `ctx` parameter — see the module-level policy: we never produce
  // a direct contributor-page URL regardless of how the caller
  // classifies the row, so data-quality / provider-id have nothing to
  // gate. The `contributorId` field on `asset` is ignored for the
  // same reason (it's kept in the Pick<> signature only so callers
  // can pass the same asset object they pass to resolveAssetLink
  // without extra field plucking).
  const name = (asset.contributorName ?? "").trim();
  if (name) {
    return {
      href: adobeStockContributorSearchUrl(name),
      kind: "contributor-search",
      label: asset.contributorName,
      reason:
        "Contributor links open a UK keyword search on the contributor's name instead of a direct profile page, so demo / imported data never lands on a fake /contributor/<id> URL.",
    };
  }

  return {
    href: null,
    kind: "none",
    label: "Unknown contributor",
    reason: "No contributor info available for this demo asset.",
  };
}
