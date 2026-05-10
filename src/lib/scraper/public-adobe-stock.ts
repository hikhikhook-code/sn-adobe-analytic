/**
 * Cheerio-based parser for publicly reachable Adobe Stock pages.
 *
 * PR #22 foundation. This module ONLY parses public pages:
 *
 *   - Keyword search results: https://stock.adobe.com/uk/search?k=<kw>
 *   - Asset detail page:      https://stock.adobe.com/uk/<slug>/<id>
 *
 * It does NOT:
 *   - Touch logged-in / contributor-dashboard pages.
 *   - Call any Adobe internal / private API.
 *   - Rotate user-agent strings or proxies.
 *   - Attempt to bypass anti-bot challenges of any kind.
 *
 * Extraction strategy (in order of preference):
 *
 *   1. Parse the JSON blob Adobe ships for SEO — it's embedded in a
 *      `<script type="application/ld+json">` tag on most asset-card
 *      containers and on asset detail pages. This is the stablest
 *      signal because Adobe themselves publish it for search engines.
 *
 *   2. Fall back to DOM-attribute extraction from known data-*
 *      attributes and anchor hrefs, which survive most CSS-level
 *      refactors.
 *
 *   3. Fail gracefully. If neither path yields anything, we return
 *      an empty asset list and let the provider surface an honest
 *      "public metadata currently unavailable" notice. We never
 *      fabricate assets from a page we couldn't parse.
 *
 * The caller (`publicAdobeStockProvider`) is responsible for caching,
 * error handling, and producing the `ProviderSearchResult` envelope.
 * This module returns only lean, typed parse output.
 */

import * as cheerio from "cheerio";
import type { CheerioAPI, Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

import {
  fetchPublicHtml,
  PublicScrapeBlockedError,
} from "./http";

export const ADOBE_STOCK_BASE = "https://stock.adobe.com/uk";

/**
 * A single asset parsed off a public Adobe Stock page. All download /
 * performance / sales figures are INTENTIONALLY ABSENT — Adobe does not
 * expose those publicly and we will not fabricate them. The provider
 * layer fills `downloads: 0` + `metricsAvailable: false` downstream so
 * the UI renders "Unavailable" rather than a fake zero.
 */
export interface PublicAdobeAsset {
  /** Adobe Stock numeric asset id (string form) — best effort. */
  id: string;
  title: string;
  thumbnailUrl: string;
  /** Canonical detail-page URL (UK locale). Already normalized. */
  adobeStockUrl: string;
  contributorName?: string;
  /**
   * URL to the contributor's Adobe Stock page (UK locale). Provider
   * layer prefers to surface contributor-search fallbacks, but if the
   * public page ships a direct profile URL we keep it for provenance.
   */
  contributorUrl?: string;
  /**
   * Raw content-type string as Adobe categorizes it. Values we've seen
   * on public pages include: "photo", "illustration", "vector",
   * "video", "template", "3d". Anything else is passed through
   * verbatim so the provider layer can decide how to normalize.
   */
  contentType?: string;
  /** PRD-aligned category list. Often empty on search cards. */
  categories: string[];
  /** Keywords parsed off the card or detail page. Can be empty. */
  keywords: string[];
  /**
   * True when Adobe tagged the asset as premium / editorial. Only set
   * when explicitly surfaced by the page; undefined otherwise.
   */
  isPremium?: boolean;
  /** True when Adobe tagged the asset as AI-generated. */
  isAiGenerated?: boolean;
}

export interface PublicSearchPage {
  /** Total result count reported by Adobe (best effort). May be `null`
   *  if the page didn't render a counter. */
  totalResults: number | null;
  /** 1-based page index we actually parsed. */
  page: number;
  assets: PublicAdobeAsset[];
  /**
   * Canonical URL we fetched. Stored on the cache row so re-validation
   * can re-fetch the exact same page a week later even if the caller
   * changes their query params.
   */
  sourceUrl: string;
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

/** Build the canonical UK-locale search URL for a keyword + page. */
export function buildSearchUrl(
  keyword: string,
  opts?: {
    page?: number;
    /** Passthrough of PRD content types; we translate to the
     *  `filters[content_type:<x>]=1` shape Adobe uses. */
    contentType?: string;
  },
): string {
  const url = new URL(`${ADOBE_STOCK_BASE}/search`);
  url.searchParams.set("k", keyword.trim());
  if (opts?.page && opts.page > 1) {
    url.searchParams.set("search_page", String(opts.page));
  }
  // Adobe's content-type filter is a bracket-style key (filters[content_type:photo]=1).
  // Only the photo / illustration / vector / video / template / 3d
  // families are safe to forward; anything else is dropped so an
  // unknown/unexpected filter never lands on a URL Adobe won't parse.
  const ct = opts?.contentType?.toLowerCase();
  const SUPPORTED: Record<string, string> = {
    photo: "photo",
    illustration: "illustration",
    vector: "vector",
    video: "video",
    template: "template",
    "3d": "3d",
  };
  if (ct && SUPPORTED[ct]) {
    // Adobe accepts the bracket key verbatim as a query param key.
    url.searchParams.append(`filters[content_type:${SUPPORTED[ct]}]`, "1");
  }
  return url.toString();
}

/** Rewrite any `/id/` locale to `/uk/` and upgrade http → https. */
export function normalizePublicUrl(url: string): string {
  if (!url) return "";
  let out = url.trim();
  if (!out) return "";
  if (out.startsWith("//")) out = `https:${out}`;
  if (out.startsWith("/")) out = `https://stock.adobe.com${out}`;
  out = out.replace(/^http:\/\//i, "https://");
  out = out.replace(
    /^(https:\/\/stock\.adobe\.com)\/id(\/|$)/i,
    "$1/uk$2",
  );
  return out;
}

// ---------------------------------------------------------------------------
// JSON-LD extraction (primary path)
// ---------------------------------------------------------------------------

interface JsonLdImageObject {
  "@type"?: string | string[];
  identifier?: string;
  "@id"?: string;
  url?: string;
  mainEntityOfPage?: string;
  contentUrl?: string;
  thumbnailUrl?: string;
  image?: string;
  name?: string;
  headline?: string;
  keywords?: string | string[];
  creator?: { name?: string; url?: string } | string;
  author?: { name?: string; url?: string } | string;
  genre?: string | string[];
  category?: string | string[];
  isAccessibleForFree?: boolean;
}

function coerceArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "string" ? x : String(x ?? "")))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof v === "string") {
    // Adobe sometimes serializes keywords as a comma-separated string.
    return v
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function extractIdFromUrl(url: string): string | null {
  if (!url) return null;
  // Detail URLs take the shape /uk/<slug>/<id> or /uk/<id>.
  const m = url.match(/\/(\d{6,})(?:\/?|\?|#|$)/);
  return m ? m[1] : null;
}

function parseJsonLdBlocks($: CheerioAPI): JsonLdImageObject[] {
  const out: JsonLdImageObject[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        // Some pages nest an array under @graph.
        const graph = (item as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(graph)) {
          for (const g of graph) {
            if (g && typeof g === "object") out.push(g as JsonLdImageObject);
          }
        } else {
          out.push(item as JsonLdImageObject);
        }
      }
    } catch {
      // Malformed JSON-LD — skip. We'll fall back to DOM extraction.
    }
  });
  return out;
}

function jsonLdLooksLikeAsset(item: JsonLdImageObject): boolean {
  const t = item["@type"];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  const AS_ASSET = new Set([
    "ImageObject",
    "VideoObject",
    "CreativeWork",
    "Photograph",
    "VisualArtwork",
  ]);
  return types.some((x) => AS_ASSET.has(x));
}

function contentTypeFromJsonLd(item: JsonLdImageObject): string | undefined {
  const t = item["@type"];
  const types = Array.isArray(t) ? t : t ? [t] : [];
  if (types.includes("VideoObject")) return "video";
  if (types.includes("Photograph")) return "photo";
  if (types.includes("ImageObject")) {
    // Fall back to genre / category to distinguish illustration from vector.
    const genres = coerceArray(item.genre).concat(coerceArray(item.category));
    const lowered = genres.map((g) => g.toLowerCase());
    if (lowered.some((g) => g.includes("vector"))) return "vector";
    if (lowered.some((g) => g.includes("illustration"))) return "illustration";
    if (lowered.some((g) => g.includes("3d"))) return "3d";
    if (lowered.some((g) => g.includes("template"))) return "template";
    return "photo";
  }
  if (types.includes("VisualArtwork")) return "illustration";
  return undefined;
}

function jsonLdToAsset(item: JsonLdImageObject): PublicAdobeAsset | null {
  if (!jsonLdLooksLikeAsset(item)) return null;

  const mainUrl =
    item.mainEntityOfPage ||
    item.url ||
    (typeof item["@id"] === "string" ? item["@id"] : undefined) ||
    "";
  const normalizedUrl = normalizePublicUrl(mainUrl);
  if (!normalizedUrl) return null;

  // Asset IDs: prefer `identifier`, fall back to URL extraction.
  const rawId =
    (typeof item.identifier === "string" ? item.identifier : undefined) ||
    extractIdFromUrl(normalizedUrl) ||
    "";
  if (!rawId) return null;

  const title =
    (typeof item.name === "string" && item.name.trim()) ||
    (typeof item.headline === "string" && item.headline.trim()) ||
    "";
  if (!title) return null;

  const thumbnail =
    (typeof item.thumbnailUrl === "string" && item.thumbnailUrl) ||
    (typeof item.contentUrl === "string" && item.contentUrl) ||
    (typeof item.image === "string" && item.image) ||
    "";

  const creator =
    typeof item.creator === "object" && item.creator
      ? item.creator
      : typeof item.author === "object" && item.author
      ? item.author
      : typeof item.creator === "string"
      ? { name: item.creator }
      : typeof item.author === "string"
      ? { name: item.author }
      : undefined;

  return {
    id: String(rawId),
    title,
    thumbnailUrl: normalizePublicUrl(thumbnail) || thumbnail || "",
    adobeStockUrl: normalizedUrl,
    contributorName: creator?.name?.toString().trim() || undefined,
    contributorUrl: creator?.url
      ? normalizePublicUrl(creator.url)
      : undefined,
    contentType: contentTypeFromJsonLd(item),
    categories: coerceArray(item.genre).concat(coerceArray(item.category)),
    keywords: coerceArray(item.keywords),
    // Public pages don't reliably expose premium / AI flags in JSON-LD.
    // Detail-page parser fills these when present.
    isPremium: undefined,
    isAiGenerated: undefined,
  };
}

// ---------------------------------------------------------------------------
// DOM fallback
// ---------------------------------------------------------------------------

function textContent(
  $el: Cheerio<AnyNode> | null | undefined,
  max = 500,
): string {
  if (!$el || $el.length === 0) return "";
  const t = $el.text().replace(/\s+/g, " ").trim();
  return t.slice(0, max);
}

function parseSearchTotal($: CheerioAPI): number | null {
  // Adobe frequently renders a "X results" counter inside
  // [data-t="results-count"] or similar. We try a few known selectors
  // and extract the first integer we see, then fall back to scanning
  // the first 8KB of text.
  const candidates = [
    '[data-t="results-count"]',
    '[data-testid="results-count"]',
    ".js-results-count",
    ".results-count",
    'meta[name="results-count"]',
  ];
  for (const sel of candidates) {
    const txt =
      sel.startsWith("meta[")
        ? $(sel).attr("content") ?? ""
        : textContent($(sel).first());
    const n = parseFirstLargeNumber(txt);
    if (n != null) return n;
  }
  // Last-ditch: scan <title> + first heading. Avoids iterating the full
  // DOM which is expensive on 400KB pages.
  const title = textContent($("title").first());
  const h1 = textContent($("h1").first(), 200);
  return parseFirstLargeNumber(`${title} ${h1}`);
}

function parseFirstLargeNumber(text: string): number | null {
  if (!text) return null;
  // Match numbers like 12,345 / 1.234.567 / 1 234 567 / plain 123.
  // We only keep digits and the first continuous run.
  const m = text.match(/(\d[\d,.\s']{2,})/);
  if (!m) {
    const single = text.match(/(\d{1,3})\s*result/i);
    if (single) return Number(single[1]);
    return null;
  }
  const digits = m[1].replace(/[^\d]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function parseCardAsset(
  $: CheerioAPI,
  $card: Cheerio<AnyNode>,
): PublicAdobeAsset | null {
  // Anchor → canonical detail URL.
  const $anchor = $card.find("a[href]").first();
  const href = $anchor.attr("href") ?? "";
  if (!href) return null;
  const normalizedUrl = normalizePublicUrl(href);
  if (!normalizedUrl.includes("stock.adobe.com")) return null;

  const id =
    $card.attr("data-id") ||
    $card.attr("data-asset-id") ||
    extractIdFromUrl(normalizedUrl) ||
    "";
  if (!id) return null;

  // Thumbnail — prefer <img data-lazy> / <img src>.
  const $img = $card.find("img").first();
  const thumbnail =
    $img.attr("data-lazy") ||
    $img.attr("data-src") ||
    $img.attr("src") ||
    "";

  const title =
    $img.attr("alt") ||
    $card.attr("data-title") ||
    textContent($card.find("[data-t='title'], .js-search-result-title").first(), 200) ||
    "";
  if (!title) return null;

  // Contributor.
  const $contributor = $card
    .find("a[href*='/contributor/'], [data-t='contributor'], .js-contributor")
    .first();
  const contributorName = textContent($contributor, 120) || undefined;
  const contributorHref = $contributor.attr("href");
  const contributorUrl = contributorHref
    ? normalizePublicUrl(contributorHref)
    : undefined;

  // Premium / AI badges — optional.
  const badgeText = textContent($card.find("[data-t='badge'], .badge").first(), 120).toLowerCase();
  const isPremium = badgeText.includes("premium") || undefined;
  const isAiGenerated =
    badgeText.includes("generative ai") ||
    badgeText.includes("ai generated") ||
    undefined;

  return {
    id: String(id),
    title,
    thumbnailUrl: normalizePublicUrl(thumbnail) || thumbnail || "",
    adobeStockUrl: normalizedUrl,
    contributorName,
    contributorUrl,
    // DOM cards don't reliably expose content type; leave undefined
    // and let detail pages (or JSON-LD parse of the same page) supply.
    contentType: undefined,
    categories: [],
    keywords: [],
    isPremium,
    isAiGenerated,
  };
}

function parseSearchCards($: CheerioAPI): PublicAdobeAsset[] {
  const out: PublicAdobeAsset[] = [];
  const seen = new Set<string>();

  const selectors = [
    "[data-comp='SearchResults'] [data-testid='search-result-card']",
    "[data-t='search-result']",
    "[data-search-result-id]",
    "article[data-id]",
    "div.search-result-cell",
  ];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const asset = parseCardAsset($, $(el));
      if (!asset) return;
      if (seen.has(asset.id)) return;
      seen.add(asset.id);
      out.push(asset);
    });
    if (out.length > 0) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public parse entry points
// ---------------------------------------------------------------------------

function mergeAssets(
  primary: PublicAdobeAsset[],
  secondary: PublicAdobeAsset[],
): PublicAdobeAsset[] {
  if (primary.length === 0) return secondary;
  if (secondary.length === 0) return primary;
  const byId = new Map<string, PublicAdobeAsset>();
  for (const a of primary) byId.set(a.id, a);
  for (const a of secondary) {
    const existing = byId.get(a.id);
    if (!existing) {
      byId.set(a.id, a);
      continue;
    }
    // Fill gaps on the primary row from the secondary source.
    byId.set(a.id, {
      ...existing,
      thumbnailUrl: existing.thumbnailUrl || a.thumbnailUrl,
      contributorName: existing.contributorName ?? a.contributorName,
      contributorUrl: existing.contributorUrl ?? a.contributorUrl,
      contentType: existing.contentType ?? a.contentType,
      categories:
        existing.categories.length > 0 ? existing.categories : a.categories,
      keywords: existing.keywords.length > 0 ? existing.keywords : a.keywords,
      isPremium: existing.isPremium ?? a.isPremium,
      isAiGenerated: existing.isAiGenerated ?? a.isAiGenerated,
    });
  }
  // Preserve primary ordering; append anything new from secondary.
  const seen = new Set<string>();
  const result: PublicAdobeAsset[] = [];
  for (const a of primary) {
    const m = byId.get(a.id);
    if (m && !seen.has(m.id)) {
      result.push(m);
      seen.add(m.id);
    }
  }
  for (const [id, a] of byId) {
    if (!seen.has(id)) {
      result.push(a);
      seen.add(id);
    }
  }
  return result;
}

/**
 * Parse a search-results HTML payload. Pure function — no network I/O,
 * safe to unit-test with a captured HTML sample.
 */
export function parseSearchHtml(
  html: string,
  opts: { page: number; sourceUrl: string },
): PublicSearchPage {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLdBlocks($);
  const jsonAssets = jsonLd
    .map((item) => jsonLdToAsset(item))
    .filter((a): a is PublicAdobeAsset => a !== null);
  const domAssets = parseSearchCards($);
  const merged = mergeAssets(jsonAssets, domAssets);

  return {
    totalResults: parseSearchTotal($),
    page: opts.page,
    assets: merged,
    sourceUrl: opts.sourceUrl,
  };
}

/**
 * Parse a single asset's detail page. Pure function — unit-testable.
 * Returns `null` if we couldn't extract enough to form a usable asset.
 */
export function parseAssetHtml(html: string): PublicAdobeAsset | null {
  const $ = cheerio.load(html);
  const jsonLd = parseJsonLdBlocks($);
  const fromJson = jsonLd
    .map((item) => jsonLdToAsset(item))
    .find((a): a is PublicAdobeAsset => a !== null);
  if (fromJson) {
    // Detail pages often have a badges block we can cross-read for
    // premium / AI flags.
    const badgeText = textContent(
      $("[data-t='badge'], .badge, .asset-badge"),
      240,
    ).toLowerCase();
    if (badgeText.includes("premium")) fromJson.isPremium = true;
    if (
      badgeText.includes("generative ai") ||
      badgeText.includes("ai generated")
    ) {
      fromJson.isAiGenerated = true;
    }
    // Keywords section — some detail pages list them as <a href="/search?k=">
    if (fromJson.keywords.length === 0) {
      const kw: string[] = [];
      $("[data-t='keyword-tag'] a, .js-keyword-pill a, a[href*='/search?k=']")
        .slice(0, 100)
        .each((_, el) => {
          const t = textContent($(el), 64);
          if (t && !kw.includes(t)) kw.push(t);
        });
      if (kw.length > 0) fromJson.keywords = kw;
    }
    return fromJson;
  }

  // No JSON-LD on this detail page — fall back to <meta> / <title>.
  const title =
    $('meta[property="og:title"]').attr("content") ||
    $('meta[name="twitter:title"]').attr("content") ||
    textContent($("h1").first(), 200) ||
    "";
  if (!title) return null;
  const canonical =
    $('link[rel="canonical"]').attr("href") ||
    $('meta[property="og:url"]').attr("content") ||
    "";
  const normalizedUrl = normalizePublicUrl(canonical);
  const id = extractIdFromUrl(normalizedUrl);
  if (!id) return null;
  const thumbnail =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    "";
  return {
    id,
    title,
    thumbnailUrl: normalizePublicUrl(thumbnail) || thumbnail || "",
    adobeStockUrl: normalizedUrl,
    contributorName: undefined,
    contributorUrl: undefined,
    contentType: undefined,
    categories: [],
    keywords: [],
    isPremium: undefined,
    isAiGenerated: undefined,
  };
}

// ---------------------------------------------------------------------------
// Network-backed wrappers
// ---------------------------------------------------------------------------

/**
 * Fetch + parse a public search page. Rethrows
 * `PublicScrapeBlockedError` / `PublicScrapeTransientError` from the
 * HTTP layer unchanged so the caller can decide between "serve stale
 * cache" and "return empty with notice".
 */
export async function scrapeSearch(
  keyword: string,
  opts?: { page?: number; contentType?: string },
): Promise<PublicSearchPage> {
  const url = buildSearchUrl(keyword, opts);
  const res = await fetchPublicHtml(url);
  if (res.looksBlocked) {
    // Defensive — fetchPublicHtml will usually have already thrown.
    throw new PublicScrapeBlockedError(
      `Blocked by Adobe Stock at ${url}.`,
      res.status,
    );
  }
  return parseSearchHtml(res.html, {
    page: opts?.page ?? 1,
    sourceUrl: res.url,
  });
}

/**
 * Fetch + parse a single asset detail page. Returns `null` if the page
 * responded with a 4xx ("asset removed / unknown") so the caller can
 * treat it as a cache miss without escalating to a transient error.
 */
export async function scrapeAsset(
  url: string,
): Promise<PublicAdobeAsset | null> {
  const normalized = normalizePublicUrl(url);
  if (!normalized) return null;
  const res = await fetchPublicHtml(normalized);
  if (res.status >= 400 && res.status < 500) return null;
  return parseAssetHtml(res.html);
}
