/**
 * Public Adobe Stock contributor page parser (PR #24).
 *
 * Fetches and parses a PUBLIC Adobe Stock contributor profile page
 * to extract metadata about the contributor and their public portfolio.
 *
 * Hard rules (same as public-adobe-stock.ts):
 *   - Only fetches public contributor pages (never logged-in dashboards)
 *   - No proxy rotation, no UA evasion, no captcha/anti-bot bypass
 *   - Static user-agent identifying the app
 *   - Rate-limited, timed out, retried once on transient failures
 *   - Never fabricates download counts or sales data
 *   - Off by default — requires PUBLIC_SCRAPER_ENABLED=true
 *
 * Fields we attempt to extract:
 *   - contributor ID
 *   - contributor name (display name)
 *   - contributor page URL
 *   - public portfolio assets (thumbnails, titles, URLs)
 *   - total visible asset count (if shown on page)
 *   - join date (if visible)
 *   - content type breakdown (from visible assets)
 *
 * Fields that are NEVER available from public contributor pages:
 *   - total downloads / sales
 *   - earnings / revenue
 *   - private analytics
 *   - performance scores
 */

import axios, { AxiosError, type AxiosRequestConfig } from "axios";
import * as cheerio from "cheerio";
import { normalizeAdobeStockUrl } from "@/lib/adobe-stock-link";
import { isPublicScraperEnabled } from "./public-adobe-stock";
import type { ScrapedAsset } from "./public-adobe-stock";

const REQUEST_TIMEOUT_MS = 10_000;
const RATE_LIMIT_MS = 1_000;
const MAX_RETRIES = 1;
const RETRY_BACKOFF_MS = 1_500;

const USER_AGENT =
  "SN-Adobe-Analytic/1.0 (+https://github.com/hikhikhook-code/sn-adobe-analytic; contributor metadata only)";

/** Contributor page base URL pattern. */
const CONTRIBUTOR_BASE = "https://stock.adobe.com/uk/contributor";

/**
 * Shape of scraped contributor metadata. All fields optional because
 * the page structure may not expose everything.
 */
export interface ScrapedContributor {
  contributorId?: string;
  name?: string;
  contributorUrl?: string;
  /** Visible public portfolio assets (limited to what the page shows). */
  assets: ScrapedAsset[];
  /** Total asset count if visible on the page (may be higher than assets.length). */
  totalAssets?: number;
  /** Join date if visible in the page. */
  joinDate?: string;
  /** Profile image URL if visible. */
  avatarUrl?: string;
}

export type ContributorPageStatus =
  | "ok"
  | "not_found"
  | "blocked"
  | "network_error"
  | "timeout"
  | "disabled"
  | "invalid_input";

export interface ContributorPageResult {
  status: ContributorPageStatus;
  contributor: ScrapedContributor | null;
  reason?: string;
}

let lastContributorRequestAt = 0;

async function waitForContributorRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastContributorRequestAt;
  if (elapsed < RATE_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, RATE_LIMIT_MS - elapsed));
  }
  lastContributorRequestAt = Date.now();
}

/**
 * Build the contributor page URL from an ID or name.
 * Adobe Stock contributor pages are at:
 *   /uk/contributor/<id>/<name-slug>
 * When we only have an ID, we use:
 *   /uk/contributor/<id>
 */
export function buildContributorUrl(idOrName: string): string {
  // If it looks like a numeric ID, use the direct path
  if (/^\d+$/.test(idOrName.trim())) {
    return `${CONTRIBUTOR_BASE}/${idOrName.trim()}`;
  }
  // If it's a full URL, use it directly
  if (idOrName.startsWith("http")) {
    return idOrName;
  }
  // Otherwise search for the contributor by name
  return `https://stock.adobe.com/uk/search?creator_name=${encodeURIComponent(idOrName.trim())}`;
}

/**
 * Validate that the input is usable for contributor lookup.
 */
function isValidContributorInput(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed.length < 200;
}

async function doContributorRequest(url: string): Promise<
  | { ok: true; html: string }
  | { ok: false; status: Exclude<ContributorPageStatus, "ok" | "disabled" | "invalid_input">; reason: string }
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
    await waitForContributorRateLimit();
    const res = await axios.request<string>(config);
    if (res.status === 404) {
      return { ok: false, status: "not_found", reason: "Contributor page not found (404)" };
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

async function fetchContributorWithRetry(url: string) {
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    const out = await doContributorRequest(url);
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
// HTML parsing for contributor pages
// ---------------------------------------------------------------------------

const CONTENT_TYPE_TOKENS: Array<[RegExp, string]> = [
  [/\billustration\b/i, "illustration"],
  [/\bvector\b/i, "vector"],
  [/\bvideo\b/i, "video"],
  [/\btemplate\b/i, "template"],
  [/\b3d\b/i, "3d"],
  [/\bphoto\b|\bimage\b/i, "photo"],
];

function guessContentTypeFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  for (const [re, label] of CONTENT_TYPE_TOKENS) {
    if (re.test(href)) return label;
  }
  return undefined;
}

function parseAssetIdFromHref(href: string): string | undefined {
  const m1 = href.match(/-(\d{6,})\.html(?:[?#]|$)/);
  if (m1) return m1[1];
  const m2 = href.match(/\/(\d{6,})(?:[/?#]|$)/);
  if (m2) return m2[1];
  return undefined;
}

/**
 * Parse a public Adobe Stock contributor page into structured metadata.
 */
export function parseContributorPageHtml(html: string, sourceUrl: string): ScrapedContributor {
  const $ = cheerio.load(html);
  const contributor: ScrapedContributor = { assets: [] };

  // Contributor URL
  contributor.contributorUrl = normalizeAdobeStockUrl(sourceUrl) ?? sourceUrl;

  // Extract contributor ID from URL
  const idMatch = sourceUrl.match(/\/contributor\/(\d+)/i);
  if (idMatch) contributor.contributorId = idMatch[1];

  // Contributor name — try various selectors
  const nameCandidates = [
    $("h1").first().text().trim(),
    $('[data-t="contributor-name"]').first().text().trim(),
    $(".contributor-name").first().text().trim(),
    $('meta[property="og:title"]').attr("content")?.trim()?.replace(/\s*[-|].*$/, ""),
  ];
  contributor.name = nameCandidates.find((n) => n && n.length > 0 && n.length < 100) || undefined;

  // Avatar
  const avatarCandidates = [
    $('[data-t="contributor-avatar"] img').attr("src"),
    $(".contributor-avatar img").attr("src"),
    $('img[alt*="avatar"]').attr("src"),
    $('img[alt*="profile"]').attr("src"),
  ];
  contributor.avatarUrl = avatarCandidates.find((u) => u && u.startsWith("http")) || undefined;

  // Total assets count (from visible text)
  const pageText = $("body").text();
  const assetCountMatch = pageText.match(/([\d,]+)\s*(?:assets?|images?|files?|items?)/i);
  if (assetCountMatch) {
    const n = Number(assetCountMatch[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) contributor.totalAssets = n;
  }

  // Join date
  const joinMatch = pageText.match(/(?:member\s+since|joined|since)\s*:?\s*(\w+\s+\d{4}|\d{4}[-/]\d{2}[-/]\d{2})/i);
  if (joinMatch) {
    try {
      const d = new Date(joinMatch[1]);
      if (!isNaN(d.getTime())) contributor.joinDate = d.toISOString();
    } catch { /* ignore unparseable dates */ }
  }

  // Try JSON-LD for structured contributor data
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).html() ?? "");
      if (data?.["@type"] === "Person" || data?.["@type"] === "Organization") {
        if (!contributor.name && data.name) contributor.name = data.name;
        if (data.dateCreated && !contributor.joinDate) {
          contributor.joinDate = data.dateCreated;
        }
      }
    } catch { /* ignore */ }
  });

  // Portfolio assets — parse visible asset tiles/cards
  const seen = new Set<string>();
  const assetSelectors = [
    "[data-content-id]",
    "[data-asset-id]",
    "div.search-result",
    "div.thumb",
    "a[href*='/images/']",
    "a[href*='/video/']",
  ];

  for (const sel of assetSelectors) {
    $(sel).each((_, el) => {
      const $tile = $(el);
      const $link = $tile.find("a[href]").first();
      const href = $link.attr("href") ?? $tile.attr("href") ?? "";
      if (!href) return;

      const absoluteHref = href.startsWith("http")
        ? href
        : `https://stock.adobe.com${href.startsWith("/") ? href : "/" + href}`;
      const normalizedUrl = normalizeAdobeStockUrl(absoluteHref) ?? absoluteHref;

      if (seen.has(normalizedUrl)) return;
      seen.add(normalizedUrl);

      const $img = $tile.find("img").first();
      const thumbnail =
        $img.attr("src") ?? $img.attr("data-src") ?? $img.attr("data-lazy") ?? undefined;
      const title =
        $img.attr("alt")?.trim() || $link.attr("title")?.trim() || undefined;

      const assetId = parseAssetIdFromHref(absoluteHref);
      const contentType = guessContentTypeFromHref(absoluteHref) ?? guessContentTypeFromHref(thumbnail);

      if (!normalizedUrl || (!thumbnail && !title)) return;

      const asset: ScrapedAsset = {
        assetId,
        thumbnailUrl: thumbnail,
        title,
        adobeStockUrl: normalizedUrl,
        contentType,
        contributorName: contributor.name,
        contributorUrl: contributor.contributorUrl,
      };
      contributor.assets.push(asset);
    });
  }

  return contributor;
}

/**
 * Fetch and parse a public Adobe Stock contributor page.
 * Never throws — all failure modes produce a structured result.
 *
 * @param input — A contributor ID, contributor name, or full contributor URL
 */
export async function fetchContributorPage(input: string): Promise<ContributorPageResult> {
  if (!isPublicScraperEnabled()) {
    return { status: "disabled", contributor: null, reason: "Public scraper is disabled." };
  }

  if (!isValidContributorInput(input)) {
    return { status: "invalid_input", contributor: null, reason: "Invalid contributor input." };
  }

  const url = buildContributorUrl(input);
  const out = await fetchContributorWithRetry(url);
  if (!out.ok) {
    return { status: out.status, contributor: null, reason: out.reason };
  }

  const contributor = parseContributorPageHtml(out.html, url);

  // A result counts as parseable if we got at least a name
  if (!contributor.name && !contributor.contributorId) {
    return {
      status: "not_found",
      contributor: null,
      reason: "Page parsed but no contributor metadata found.",
    };
  }

  return { status: "ok", contributor };
}

/** Reset rate limiter for tests. */
export function __resetContributorRateLimiterForTests(): void {
  lastContributorRequestAt = 0;
}
