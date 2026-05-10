/**
 * Public Adobe Stock asset detail page parser (PR #24).
 *
 * Fetches and parses a SINGLE public Adobe Stock asset detail page
 * (e.g. `https://stock.adobe.com/uk/images/<slug>/<id>.html`) to
 * extract richer metadata than what the search grid tiles provide.
 *
 * Hard rules (same as public-adobe-stock.ts):
 *   - Only fetches public Adobe Stock detail pages (never private APIs)
 *   - No proxy rotation, no UA evasion, no captcha/anti-bot bypass
 *   - Static user-agent identifying the app
 *   - Rate-limited, timed out, retried once on transient failures
 *   - Never fabricates download counts or performance scores
 *   - Off by default — requires PUBLIC_SCRAPER_ENABLED=true
 *
 * Fields we attempt to extract from the detail page:
 *   - title (full, not truncated like in search grid)
 *   - asset ID
 *   - thumbnail / preview image URL
 *   - keywords (full list, often richer than search grid)
 *   - contributor name
 *   - contributor ID / URL
 *   - content type / category
 *   - premium indicator
 *   - AI-generated indicator
 *   - upload date (if visible)
 *   - dimensions (if visible)
 *
 * Fields that are NEVER available from public detail pages:
 *   - downloads
 *   - performance score
 *   - downloads per month
 *   - sales / revenue
 */

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";
import { isPublicScraperEnabled } from "./public-adobe-stock";

const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 1_000;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1_500;

const USER_AGENT =
  "SN-Adobe-Analytic/1.0 (+https://github.com/hikhikhook-code/sn-adobe-analytic; asset detail metadata only)";

/**
 * Shape of a scraped asset detail. Every field is optional because
 * Adobe's page structure may not expose all data on every asset.
 * Missing fields surface as `Unavailable` in the UI.
 */
export interface ScrapedAssetDetail {
  assetId?: string;
  title?: string;
  thumbnailUrl?: string;
  adobeStockUrl?: string;
  keywords?: string[];
  contributorName?: string;
  contributorId?: string;
  contributorUrl?: string;
  contentType?: string;
  categories?: string[];
  isPremium?: boolean;
  isAiGenerated?: boolean;
  uploadDate?: string;
  dimensions?: string;
}

export type AssetDetailStatus =
  | "ok"
  | "not_found"
  | "blocked"
  | "network_error"
  | "timeout"
  | "disabled"
  | "invalid_url";

export interface AssetDetailResult {
  status: AssetDetailStatus;
  detail: ScrapedAssetDetail | null;
  reason?: string;
}

let lastDetailRequestAt = 0;

async function waitForDetailRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastDetailRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastDetailRequestAt = Date.now();
}

/**
 * Validate that the URL is a real Adobe Stock asset detail page URL.
 * Only fetches from stock.adobe.com — never arbitrary domains.
 */
function isValidAssetDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname === "stock.adobe.com" &&
      (parsed.protocol === "https:" || parsed.protocol === "http:")
    );
  } catch {
    return false;
  }
}

/**
 * Build a detail page URL from an asset ID. Falls back to the UK
 * locale path format.
 */
export function buildAssetDetailUrl(assetId: string): string {
  return `https://stock.adobe.com/uk/images/asset/${assetId}`;
}

async function doDetailRequest(url: string): Promise<
  | { ok: true; html: string }
  | { ok: false; status: Exclude<AssetDetailStatus, "ok" | "disabled" | "invalid_url">; reason: string }
> {
  const config: AxiosRequestConfig = {
    url,
    method: "GET",
    timeout: REQUEST_TIMEOUT_MS,
    responseType: "text",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    maxRedirects: 5,
    validateStatus: () => true,
  };
  try {
    await waitForDetailRateLimit();
    const res = await axios.request<string>(config);
    if (res.status === 404) {
      return { ok: false, status: "not_found", reason: "Asset page not found (404)" };
    }
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, html: res.data };
    }
    return { ok: false, status: "blocked", reason: `HTTP ${res.status}` };
  } catch (err) {
    const aerr = err as AxiosError;
    if (aerr.code === "ECONNABORTED" || aerr.message?.includes("timeout")) {
      return { ok: false, status: "timeout", reason: aerr.message };
    }
    return { ok: false, status: "network_error", reason: aerr.message ?? "network error" };
  }
}

async function fetchDetailWithRetry(url: string) {
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const out = await doDetailRequest(url);
    if (out.ok) return out;
    if ((out.status === "timeout" || out.status === "network_error") && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
      attempt += 1;
      continue;
    }
    return out;
  }
  return { ok: false as const, status: "network_error" as const, reason: "exhausted retries" };
}

// ---------------------------------------------------------------------------
// HTML parsing for asset detail pages
// ---------------------------------------------------------------------------

const CONTENT_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\billustration\b/i, "illustration"],
  [/\bvector\b/i, "vector"],
  [/\bvideo\b/i, "video"],
  [/\btemplate\b/i, "template"],
  [/\b3d\b/i, "3d"],
  [/\bphoto\b|\bimage\b/i, "photo"],
];

function guessContentType(text: string): string | undefined {
  for (const [re, label] of CONTENT_TYPE_PATTERNS) {
    if (re.test(text)) return label;
  }
  return undefined;
}

function parseAssetId(url: string): string | undefined {
  const m1 = url.match(/-(\d{6,})\.html(?:[?#]|$)/);
  if (m1) return m1[1];
  const m2 = url.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (m2) return m2[1];
  return undefined;
}

/**
 * Parse a public Adobe Stock asset detail page into structured metadata.
 * Deliberately conservative — extracts only fields that are reliably
 * present in the public HTML. Missing fields remain undefined.
 */
export function parseAssetDetailHtml(html: string, sourceUrl: string): ScrapedAssetDetail {
  const $ = cheerio.load(html);
  const detail: ScrapedAssetDetail = {};

  // Asset ID from URL
  detail.assetId = parseAssetId(sourceUrl);
  detail.adobeStockUrl = normalizeAdobeStockUrl(sourceUrl) ?? sourceUrl;

  // Title — try multiple selectors (Adobe changes markup over time)
  const titleCandidates = [
    $("h1").first().text().trim(),
    $('[data-t="asset-title"]').first().text().trim(),
    $("title").first().text().trim().replace(/\s*[-|].*$/, ""),
    $('meta[property="og:title"]').attr("content")?.trim(),
  ];
  detail.title = titleCandidates.find((t) => t && t.length > 0) || undefined;

  // Thumbnail / preview image
  const imgCandidates = [
    $('meta[property="og:image"]').attr("content"),
    $('[data-t="asset-preview"] img').attr("src"),
    $(".asset-detail-image img").attr("src"),
    $("img.hero-image").attr("src"),
    $('img[data-src]').first().attr("data-src"),
  ];
  detail.thumbnailUrl = imgCandidates.find((u) => u && u.startsWith("http")) || undefined;

  // Keywords — from keyword links, meta tags, or JSON-LD
  const keywords = new Set<string>();
  $('a[href*="/search?k="], a[href*="search?k="]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 60) keywords.add(text);
  });
  // Also try meta keywords
  const metaKw = $('meta[name="keywords"]').attr("content");
  if (metaKw) {
    metaKw.split(",").forEach((k) => {
      const t = k.trim();
      if (t && t.length < 60) keywords.add(t);
    });
  }
  // Try JSON-LD structured data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "");
      if (Array.isArray(data?.keywords)) {
        data.keywords.forEach((k: string) => {
          if (typeof k === "string" && k.length < 60) keywords.add(k.trim());
        });
      } else if (typeof data?.keywords === "string") {
        data.keywords.split(",").forEach((k: string) => {
          const t = k.trim();
          if (t && t.length < 60) keywords.add(t);
        });
      }
    } catch { /* ignore malformed JSON-LD */ }
  });
  if (keywords.size > 0) detail.keywords = Array.from(keywords);

  // Contributor
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (!detail.contributorName && /\/(contributor|artist)\//i.test(href)) {
      detail.contributorName = $(el).text().trim() || undefined;
      detail.contributorUrl = normalizeAdobeStockUrl(
        href.startsWith("http") ? href : `https://stock.adobe.com${href}`,
      ) ?? undefined;
      // Extract contributor ID from URL path
      const cidMatch = href.match(/\/(contributor|artist)\/(\d+)/i);
      if (cidMatch) detail.contributorId = cidMatch[2];
    }
  });

  // Content type — from breadcrumbs, page content, or meta
  const pageText = $("body").text();
  const ogType = $('meta[property="og:type"]').attr("content") ?? "";
  detail.contentType = guessContentType(ogType) || guessContentType(pageText.slice(0, 2000));

  // Categories — from breadcrumb navigation
  const categories: string[] = [];
  $("nav a, .breadcrumb a, [data-t='breadcrumb'] a").each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 40 && !text.toLowerCase().includes("stock") && !text.toLowerCase().includes("home")) {
      categories.push(text);
    }
  });
  if (categories.length > 0) detail.categories = categories;

  // Premium / AI indicators
  detail.isPremium = /\bpremium\b/i.test(pageText) || undefined;
  detail.isAiGenerated = /\b(ai\s*generated|generative\s*ai|genai)\b/i.test(pageText) || undefined;

  // Upload date — from structured data or visible text
  let uploadDate: string | undefined;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "");
      if (data?.datePublished) uploadDate = data.datePublished;
      else if (data?.uploadDate) uploadDate = data.uploadDate;
      else if (data?.dateCreated) uploadDate = data.dateCreated;
    } catch { /* ignore */ }
  });
  if (uploadDate) detail.uploadDate = uploadDate;

  // Dimensions — from visible text or metadata
  const dimMatch = pageText.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/);
  if (dimMatch) detail.dimensions = `${dimMatch[1]}x${dimMatch[2]}`;

  return detail;
}

/**
 * Fetch and parse a public Adobe Stock asset detail page.
 * Never throws — all failure modes produce a structured result.
 *
 * @param url — A validated Adobe Stock asset URL or asset ID
 */
export async function fetchAssetDetail(urlOrId: string): Promise<AssetDetailResult> {
  if (!isPublicScraperEnabled()) {
    return { status: "disabled", detail: null, reason: "Public scraper is disabled." };
  }

  // Determine the URL to fetch
  let url: string;
  if (/^\d{6,}$/.test(urlOrId)) {
    url = buildAssetDetailUrl(urlOrId);
  } else {
    url = urlOrId;
  }

  if (!isValidAssetDetailUrl(url)) {
    return { status: "invalid_url", detail: null, reason: "Not a valid Adobe Stock URL." };
  }

  const out = await fetchDetailWithRetry(url);
  if (!out.ok) {
    return { status: out.status, detail: null, reason: out.reason };
  }

  const detail = parseAssetDetailHtml(out.html, url);

  // A detail counts as parseable if we got at least a title or asset ID
  if (!detail.title && !detail.assetId) {
    return { status: "not_found", detail: null, reason: "Page parsed but no asset metadata found." };
  }

  return { status: "ok", detail };
}

/** Reset rate limiter for tests. */
export function __resetDetailRateLimiterForTests(): void {
  lastDetailRequestAt = 0;
}
