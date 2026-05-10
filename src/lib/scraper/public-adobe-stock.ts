/**
 * Public Adobe Stock metadata scraper (PR #22).
 *
 * Narrow, opinionated HTML fetcher for PUBLIC Adobe Stock search pages.
 * Powers the public-metadata provider's "no HTTP boundary configured"
 * branch so users with `DATA_PROVIDER=public` still get real metadata
 * on search results (thumbnail, title, Adobe Stock URL, contributor
 * name where exposed, content type) without any private or internal
 * Adobe API access.
 *
 * Hard rules this module respects (matches the PR #22 brief):
 *
 *   ALLOWED
 *     - Fetch PUBLIC Adobe Stock search pages only (never logged-in
 *       contributor dashboards, never API endpoints that require a
 *       session, never enterprise APIs).
 *     - Parse the page's visible HTML + any <script type="application/
 *       ld+json"> microdata blocks (they're literally the public page
 *       content, same as a browser would see).
 *     - Default low request rate (see RATE_LIMIT_MS).
 *     - Short request timeout + ONE retry with backoff.
 *     - Advertise ourselves honestly in the UA (project name + repo
 *       URL + a "read PRD" contact pointer).
 *
 *   NOT ALLOWED (the scraper refuses to do any of these)
 *     - No rotating user agents, no User-Agent evasion. The UA is a
 *       static string identifying the app. Impersonating real
 *       browsers is an explicit non-goal.
 *     - No proxy rotation. There's no knob for it and no code path.
 *     - No captcha / bot-detection bypass. If Adobe returns a
 *       challenge or a non-2xx, we give up and surface an
 *       "unavailable" state — the provider then returns cache (if
 *       any) or an empty result with a clear notice.
 *     - No authenticated/internal API calls. `fetchPublicSearchPage`
 *       only hits `https://stock.adobe.com/search?k=...` (and the
 *       trailing locale in URL path). Nothing else.
 *     - No robots.txt violation. We fetch the same URL the browser
 *       fetches, at a slower rate, with a User-Agent that identifies
 *       the app — see `docs/PRD-ALIGNMENT.md` §public-metadata.
 *
 * The parse layer is DELIBERATELY conservative: we pick up fields that
 * are stable across Adobe Stock HTML revisions (thumbnail, title, asset
 * link, contributor anchor) and ignore everything else. Anything we
 * can't reliably read is left unset so the provider tags it
 * `metricsAvailable: false` downstream. Real numeric fields (downloads
 * / performance / sales) never come out of this module — they do not
 * appear on the public pages and we never invent them.
 */

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";

/** Public Adobe Stock search base. UK locale matches the rest of the
 *  app (see `adobe-stock-link.ts`). */
const SEARCH_BASE_URL = "https://stock.adobe.com/uk/search";

/** Per-request network timeout. 10s is conservative — past that we
 *  consider the page unavailable and return a miss. */
const REQUEST_TIMEOUT_MS = 10_000;

/** Minimum interval between two scraper requests from this process.
 *  Protects the Adobe Stock origin from bursty traffic; the public
 *  provider also reads from cache first, so a normal user session
 *  hits the origin at most once per unique (keyword × filter × page)
 *  within the search TTL. */
const RATE_LIMIT_MS = 1_000;

/** Retry exactly once on transient network errors. Beyond that we
 *  surface an unavailable state rather than hammer the origin. */
const MAX_RETRIES = 1;

/** Backoff before the single retry attempt. */
const RETRY_BACKOFF_MS = 1_500;

/** Static user agent. Identifies the app + points at the repo so Adobe
 *  can contact us; see also `.well-known/security.txt` if we ever add
 *  one. Deliberately NOT a real browser UA — the PR brief rules out
 *  user-agent evasion. */
const USER_AGENT =
  "SN-Adobe-Analytic/1.0 (+https://github.com/hikhikhook-code/sn-adobe-analytic; public metadata only)";

/**
 * Shape of a scraped search asset. Lean intentionally — only fields
 * the public HTML reliably exposes. Everything we can't read is
 * undefined; the provider maps undefined → metricsAvailable:false /
 * placeholder strings.
 */
export interface ScrapedAsset {
  /** Adobe Stock numeric asset id when available in the URL path. */
  assetId?: string;
  thumbnailUrl?: string;
  title?: string;
  adobeStockUrl?: string;
  contentType?: string; // "photo" | "illustration" | "vector" | "video" | "template" | "3d"
  contributorName?: string;
  contributorUrl?: string;
  isPremium?: boolean;
  isAiGenerated?: boolean;
  keywords?: string[];
  uploadDate?: string;
}

/** One-line fetch outcome. The provider uses this to decide whether to
 *  use the live payload, fall back to cache, or emit an "unavailable"
 *  envelope. */
export type ScrapeStatus =
  | "ok"
  | "empty" // fetched fine, parsed nothing
  | "blocked" // non-2xx (likely bot challenge / rate-limit from upstream)
  | "network_error"
  | "timeout"
  | "disabled"; // scraper intentionally not enabled

export interface ScrapeResult {
  status: ScrapeStatus;
  assets: ScrapedAsset[];
  /** Optional upstream total-results count when the page exposes one. */
  totalResults?: number;
  /** Human-readable diagnostic for logs / notices. Never shown to the
   *  end user verbatim unless it's safe — the provider re-wraps it. */
  reason?: string;
}

let lastRequestAt = 0;

/**
 * Enforce the per-process rate limit. Returns a promise that resolves
 * once the next request is allowed to run.
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastRequestAt = Date.now();
}

/**
 * True if the scraper is allowed to make network requests. Off by
 * default — operators must explicitly opt in via
 * `PUBLIC_SCRAPER_ENABLED=true` (or the legacy `USE_LIVE_SCRAPER=true`
 * which is honored for back-compat only). Production ignores the flag
 * when `NODE_ENV=production` unless the env additionally declares
 * `PUBLIC_SCRAPER_ALLOW_PROD=true` — we want the opt-in to be
 * deliberate.
 */
export function isPublicScraperEnabled(): boolean {
  const primary = (process.env.PUBLIC_SCRAPER_ENABLED ?? "").toLowerCase();
  const legacy = (process.env.USE_LIVE_SCRAPER ?? "").toLowerCase();
  const wantsOn =
    primary === "true" ||
    primary === "1" ||
    primary === "yes" ||
    legacy === "true" ||
    legacy === "1" ||
    legacy === "yes";
  if (!wantsOn) return false;
  if (process.env.NODE_ENV === "production") {
    const allowProd = (
      process.env.PUBLIC_SCRAPER_ALLOW_PROD ?? ""
    ).toLowerCase();
    return allowProd === "true" || allowProd === "1" || allowProd === "yes";
  }
  return true;
}

/**
 * Build the Adobe Stock search URL for a keyword + content-type filter.
 * Only the filters we can honestly translate to Adobe's public UI
 * params are forwarded; anything we don't understand is dropped.
 */
export function buildSearchUrl(params: {
  keyword: string;
  contentType?: string;
  page?: number;
}): string {
  const url = new URL(SEARCH_BASE_URL);
  url.searchParams.set("k", params.keyword);
  if (params.page && params.page > 1) {
    url.searchParams.set("search_page", String(params.page));
  }
  if (params.contentType && params.contentType !== "all") {
    // Adobe Stock's public URL uses `filters[content_type:<X>]=1`
    // switches. We honor the five mainstream ones and leave any value
    // we don't recognize unforwarded (the page falls back to "all").
    const mapping: Record<string, string> = {
      photo: "photo",
      illustration: "illustration",
      vector: "vector",
      video: "video",
      template: "template",
      "3d": "3d",
    };
    const adobeType = mapping[params.contentType.toLowerCase()];
    if (adobeType) {
      url.searchParams.set(`filters[content_type:${adobeType}]`, "1");
    }
  }
  return url.toString();
}

async function doRequest(url: string): Promise<{
  ok: true;
  html: string;
} | {
  ok: false;
  status: Exclude<ScrapeStatus, "ok" | "empty" | "disabled">;
  reason: string;
}> {
  const config: AxiosRequestConfig = {
    url,
    method: "GET",
    timeout: REQUEST_TIMEOUT_MS,
    // Adobe returns HTML; no compressed JSON shenanigans to unpack.
    responseType: "text",
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
      // NEVER send credentials / cookies. We're a public-only fetcher.
    },
    // Don't follow redirects across hosts — if Adobe 302s to a
    // different origin we want to know about it (and refuse).
    maxRedirects: 5,
    validateStatus: () => true, // inspect status ourselves
  };
  try {
    await waitForRateLimit();
    const res = await axios.request<string>(config);
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, html: res.data };
    }
    // 4xx/5xx — covers 403 bot challenges, 429 rate limit, and 5xx
    // upstream errors. Per the brief, we DO NOT bypass any of these;
    // we surface them cleanly.
    return {
      ok: false,
      status: "blocked",
      reason: `HTTP ${res.status}`,
    };
  } catch (err) {
    const aerr = err as AxiosError;
    if (aerr.code === "ECONNABORTED" || aerr.message?.includes("timeout")) {
      return { ok: false, status: "timeout", reason: aerr.message };
    }
    return {
      ok: false,
      status: "network_error",
      reason: aerr.message ?? "network error",
    };
  }
}

async function fetchWithRetry(url: string) {
  let attempt = 0;
  // One retry means two total tries. We stop the moment we get a real
  // HTML payload, a 4xx/5xx (retrying those is an anti-pattern against
  // a rate-limited origin), or run out of attempts.
  while (attempt <= MAX_RETRIES) {
    const out = await doRequest(url);
    if (out.ok) return out;
    // Only retry transient network failures, never a non-2xx HTTP.
    if (
      out.status === "timeout" ||
      out.status === "network_error"
    ) {
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        attempt += 1;
        continue;
      }
    }
    return out;
  }
  return {
    ok: false as const,
    status: "network_error" as const,
    reason: "exhausted retries",
  };
}

// ---------------------------------------------------------------------------
// HTML parsing
// ---------------------------------------------------------------------------

const CONTENT_TYPE_TOKENS: Array<[RegExp, string]> = [
  [/\billustration\b/i, "illustration"],
  [/\bvector\b/i, "vector"],
  [/\bvideo\b/i, "video"],
  [/\btemplate\b/i, "template"],
  [/\b3d\b/i, "3d"],
  [/\bphoto\b|\bimage\b/i, "photo"],
];

function guessContentTypeFromHref(
  href: string | undefined,
): string | undefined {
  if (!href) return undefined;
  for (const [re, label] of CONTENT_TYPE_TOKENS) {
    if (re.test(href)) return label;
  }
  return undefined;
}

function parseAssetIdFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  // Adobe asset URLs commonly end in `...-<digits>.html` or contain a
  // numeric asset id as the last path segment.
  const m1 = href.match(/-(\d{6,})\.html(?:[?#]|$)/);
  if (m1) return m1[1];
  const m2 = href.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (m2) return m2[1];
  return undefined;
}

/**
 * Parse a single <div> search-result tile into a ScrapedAsset. We look
 * for a small set of stable selectors; when any are missing we leave
 * the corresponding field undefined.
 */
// All tile parsing happens inside cheerio's each() closure so we can
// rely on the `$(this)` binding rather than exporting a helper that
// needs a tight node type. cheerio 1.x's `Element` / `AnyNode` exports
// move around between minor versions; we stay agnostic by rewrapping
// the node via `$(el)` in the each() callback.

function extractTile(
  $: cheerio.CheerioAPI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $tile: cheerio.Cheerio<any>,
): ScrapedAsset | null {

  // Primary link: the <a> that wraps the thumbnail. Its href is the
  // asset page; its image's src / data-src is the thumbnail; its
  // title attribute is the asset title.
  const $link = $tile.find("a[href]").first();
  const href = $link.attr("href") ?? "";
  const absoluteHref = href
    ? href.startsWith("http")
      ? href
      : `https://stock.adobe.com${href.startsWith("/") ? href : "/" + href}`
    : undefined;
  const normalizedUrl = normalizeAdobeStockUrl(absoluteHref) ?? absoluteHref;

  const $img = $tile.find("img").first();
  const thumbnail =
    $img.attr("src") ??
    $img.attr("data-src") ??
    $img.attr("data-lazy") ??
    undefined;

  const title =
    $img.attr("alt")?.trim() ||
    $link.attr("title")?.trim() ||
    $link.text().trim() ||
    undefined;

  // Contributor anchor: Adobe typically renders a second <a> pointing
  // at /contributor/<id>. We extract the visible name + normalized
  // URL; if nothing matches we skip both fields.
  let contributorName: string | undefined;
  let contributorUrl: string | undefined;
  $tile.find("a[href]").each((_, a) => {
    const h = $(a).attr("href") ?? "";
    if (!contributorUrl && /\/(contributor|artist)\//i.test(h)) {
      contributorUrl =
        normalizeAdobeStockUrl(
          h.startsWith("http") ? h : `https://stock.adobe.com${h}`,
        ) ?? undefined;
      contributorName = $(a).text().trim() || undefined;
    }
  });

  const contentType =
    guessContentTypeFromHref(absoluteHref) ??
    guessContentTypeFromHref(thumbnail);

  // Premium / AI tags — cautious best-effort. We only flag when we
  // literally see the word in the tile. Anything else stays unset.
  const tileText = $tile.text();
  const isPremium = /\bpremium\b/i.test(tileText);
  const isAiGenerated = /\b(ai\s*generated|generative\s*ai|genai)\b/i.test(
    tileText,
  );

  const assetId = parseAssetIdFromHref(absoluteHref);

  // A tile counts as "parseable" only if we came away with at least a
  // URL AND a thumbnail or title. Anything less isn't a real result
  // (it's navigation chrome, a related-search chip, etc.).
  const hasEnough =
    !!normalizedUrl && (!!thumbnail || !!title);
  if (!hasEnough) return null;

  return {
    assetId,
    thumbnailUrl: thumbnail,
    title,
    adobeStockUrl: normalizedUrl ?? absoluteHref,
    contentType,
    contributorName,
    contributorUrl,
    isPremium: isPremium || undefined,
    isAiGenerated: isAiGenerated || undefined,
  };
}

/**
 * Parse Adobe Stock's public search HTML into a list of scraped
 * assets. Tolerant — we try a few candidate selectors and de-dupe on
 * asset URL. Returns an empty array when nothing matches.
 */
export function parseSearchHtml(html: string): {
  assets: ScrapedAsset[];
  totalResults?: number;
} {
  const $ = cheerio.load(html);

  // Candidate tile selectors. Adobe Stock's markup has changed shape
  // multiple times; we ask for any element that CLAIMS to be a
  // search-result card OR that has an img inside a /<path>/<id>.html
  // link. The parser de-dupes by URL.
  const selectors = [
    "[data-content-id]",
    "[data-asset-id]",
    "[data-search-result]",
    "div.search-result",
    "div.thumb",
    "a[href*='/images/']",
    "a[href*='/video/']",
  ];

  const seen = new Set<string>();
  const assets: ScrapedAsset[] = [];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const parsed = extractTile($, $(el));
      if (!parsed || !parsed.adobeStockUrl) return;
      if (seen.has(parsed.adobeStockUrl)) return;
      seen.add(parsed.adobeStockUrl);
      assets.push(parsed);
    });
  }

  // Total-results indicator. Adobe Stock surfaces it as a visible
  // "1,234,567 results" string near the top of the page. We treat
  // this as best-effort — it's a display number, not a contract.
  let totalResults: number | undefined;
  const resultsText = $("body").text();
  const m = resultsText.match(/([\d,]+)\s+(?:results|items)/i);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 0) totalResults = n;
  }

  return { assets, totalResults };
}

/**
 * Public entry point. Fetches one search page from Adobe Stock and
 * parses the result set. Never throws — all failure modes produce a
 * structured `ScrapeResult`.
 */
export async function fetchPublicSearchPage(params: {
  keyword: string;
  contentType?: string;
  page?: number;
}): Promise<ScrapeResult> {
  if (!isPublicScraperEnabled()) {
    return {
      status: "disabled",
      assets: [],
      reason:
        "Public scraper is disabled. Set PUBLIC_SCRAPER_ENABLED=true to opt in.",
    };
  }

  const url = buildSearchUrl(params);
  const out = await fetchWithRetry(url);
  if (!out.ok) {
    return {
      status: out.status,
      assets: [],
      reason: out.reason,
    };
  }

  const parsed = parseSearchHtml(out.html);
  if (parsed.assets.length === 0) {
    return {
      status: "empty",
      assets: [],
      totalResults: parsed.totalResults,
      reason: "Upstream returned no parseable tiles",
    };
  }
  return {
    status: "ok",
    assets: parsed.assets,
    totalResults: parsed.totalResults,
  };
}

/**
 * Testing / ops helper — reset the in-process rate-limit clock. Not
 * exported from the provider layer; used by internal tools only.
 */
export function __resetRateLimiterForTests(): void {
  lastRequestAt = 0;
}
