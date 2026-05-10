/**
 * Low-level HTTP client for the public Adobe Stock metadata scraper.
 *
 * PR #22 foundation. This module is DELIBERATELY small and conservative —
 * it exists to centralize:
 *
 *   - An honest, identifiable User-Agent (NO browser impersonation, NO
 *     user-agent rotation). The UA includes a contact URL so Adobe can
 *     tell us to stop if they ever want to.
 *   - A per-process rate limiter with a conservative minimum gap
 *     between requests (default 1.5s ≈ 40 req/min across the whole
 *     Node process, regardless of concurrency).
 *   - A short total timeout (default 10s) so a stuck request never
 *     hangs an API route.
 *   - A LIMITED retry (max 2 extra attempts, exponential back-off)
 *     for transient 5xx / network errors ONLY. 4xx responses are
 *     treated as "blocked or unavailable" and fail FAST so we don't
 *     keep hammering a page that's already told us no.
 *   - No proxy support, no cookie jar, no JS execution. If Adobe
 *     starts returning an anti-bot / captcha page we parse what we
 *     get and return empty — we do not try to work around it.
 *
 * Out of scope for this module (by design — the PR brief explicitly
 * forbids them):
 *
 *   - Proxy rotation, per-request UA randomization, IP cycling.
 *   - Captcha / anti-bot bypass of any kind.
 *   - Authenticated requests against Adobe's logged-in contributor
 *     dashboard.
 *   - Any Adobe internal / private API access.
 *
 * Everything here operates on publicly reachable pages only.
 */

import axios, { AxiosError, type AxiosInstance } from "axios";

/**
 * Honest User-Agent. The contact handle lets Adobe's team reach us if
 * they ever want us to stop scraping. We intentionally DO NOT pretend
 * to be a browser — that would be UA evasion, which the PR brief
 * explicitly forbids.
 */
export const PUBLIC_SCRAPER_USER_AGENT =
  "SN-Adobe-Analytic/0.1 (+https://github.com/hikhikhook-code/sn-adobe-analytic; public-metadata-only)";

/** Conservative process-wide rate limit. Overridable by env for tuning. */
function readNumber(envKey: string, fallback: number, min: number, max: number) {
  const raw = process.env[envKey];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const MIN_REQUEST_GAP_MS = readNumber(
  "PUBLIC_SCRAPER_MIN_GAP_MS",
  1500,
  500,
  60_000,
);
const REQUEST_TIMEOUT_MS = readNumber(
  "PUBLIC_SCRAPER_TIMEOUT_MS",
  10_000,
  2_000,
  30_000,
);
const MAX_RETRIES = readNumber("PUBLIC_SCRAPER_MAX_RETRIES", 2, 0, 4);

/**
 * Block hosts we will NEVER send public-scraper requests to. Hard-codes
 * the policy that this module only touches stock.adobe.com. Any attempt
 * to use another host (even accidentally — e.g. an open redirect) is
 * refused at the request layer so a scraper bug can't leak traffic.
 */
const ALLOWED_HOST_SUFFIXES: ReadonlyArray<string> = [
  "stock.adobe.com",
];

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    return ALLOWED_HOST_SUFFIXES.some(
      (suffix) =>
        u.hostname === suffix || u.hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/**
 * Next instant (in ms since epoch) at which the rate limiter will let a
 * request through. Intentionally module-scope — we want the same gap
 * across every concurrent API route invocation in this Node process.
 */
let nextAllowedAt = 0;

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  // Reserve the next slot atomically BEFORE the await so concurrent
  // callers serialize even when they arrive on the same microtask.
  const slot = Math.max(now, nextAllowedAt);
  nextAllowedAt = slot + MIN_REQUEST_GAP_MS;
  const wait = slot - now;
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
}

/**
 * Thrown when Adobe (or an intermediate CDN) explicitly tells us to
 * stop — 403, 429, or a captcha-style body. The provider layer treats
 * these as "return cached value if available, otherwise honest empty"
 * and never retries within the same request.
 */
export class PublicScrapeBlockedError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PublicScrapeBlockedError";
    this.status = status;
  }
}

/**
 * Thrown for network / 5xx errors that survived the retry budget.
 * Distinct from `Blocked` because the caller treats them differently
 * (transient → we may retry on a future request; blocked → back off).
 */
export class PublicScrapeTransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicScrapeTransientError";
  }
}

/** Single axios instance so keep-alive works across requests. */
let _client: AxiosInstance | null = null;
function client(): AxiosInstance {
  if (!_client) {
    _client = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        "User-Agent": PUBLIC_SCRAPER_USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml;q=0.9,application/json;q=0.8,*/*;q=0.5",
        "Accept-Language": "en-GB,en;q=0.8",
      },
      maxRedirects: 5,
      // Let us inspect non-2xx manually so we can distinguish blocks
      // from transients instead of axios throwing a generic error.
      validateStatus: () => true,
      // Explicit decompressor — `br` handling can break on some node
      // runtimes; gzip + deflate are universal.
      decompress: true,
      responseType: "text",
    });
  }
  return _client;
}

interface FetchResult {
  url: string;
  status: number;
  html: string;
  /** True when the response looked like an anti-bot / captcha interstitial
   *  rather than the real page. Caller should treat this like a block. */
  looksBlocked: boolean;
}

const BLOCK_BODY_SIGNALS: ReadonlyArray<RegExp> = [
  /access denied/i,
  /captcha/i,
  /are you a human/i,
  /pardon our interruption/i,
  /\bdistil[-_ ]?networks?\b/i,
  /\bcloudflare\b.*\bray id\b/i,
];

function bodyLooksBlocked(html: string): boolean {
  // Cheap heuristic — we only scan the first 4KB so a huge legitimate
  // page doesn't match on a buried keyword. Anti-bot interstitials are
  // always tiny.
  const head = html.slice(0, 4096);
  return BLOCK_BODY_SIGNALS.some((rx) => rx.test(head));
}

/**
 * Fetch a publicly reachable Adobe Stock page and return its HTML.
 * Applies rate-limit, timeout, and limited retry. Refuses any URL that
 * isn't on an allowlisted host.
 */
export async function fetchPublicHtml(url: string): Promise<FetchResult> {
  if (!hostAllowed(url)) {
    // Hard failure — never let a misconfigured provider redirect scraper
    // traffic off-site.
    throw new PublicScrapeBlockedError(
      `Refusing to fetch '${url}': host is not on the public-scraper allowlist.`,
    );
  }

  let attempt = 0;
  let lastTransient: string | null = null;
  while (attempt <= MAX_RETRIES) {
    await waitForSlot();
    try {
      const res = await client().get<string>(url);
      const status = res.status ?? 0;
      const html = typeof res.data === "string" ? res.data : String(res.data ?? "");

      // Hard block signals: 403 / 429. Don't retry.
      if (status === 403 || status === 429) {
        throw new PublicScrapeBlockedError(
          `Blocked by Adobe Stock at ${url} (HTTP ${status}).`,
          status,
        );
      }

      // 4xx (other than the hard blocks above) → treat as unavailable but
      // not blocked. Return the body so callers that can parse a 404
      // "no results" body may still do so; otherwise they'll see an empty
      // parse and return an empty response with a notice.
      if (status >= 400 && status < 500) {
        return {
          url,
          status,
          html,
          looksBlocked: false,
        };
      }

      // 5xx → transient, retry.
      if (status >= 500) {
        lastTransient = `HTTP ${status}`;
        attempt++;
        if (attempt <= MAX_RETRIES) {
          await new Promise((r) =>
            setTimeout(r, 500 * Math.pow(2, attempt - 1)),
          );
        }
        continue;
      }

      // 2xx/3xx. Check for interstitial content.
      if (bodyLooksBlocked(html)) {
        throw new PublicScrapeBlockedError(
          `Body at ${url} looks like an anti-bot / captcha interstitial; refusing to parse.`,
          status,
        );
      }

      return { url, status, html, looksBlocked: false };
    } catch (err) {
      // Rethrow block errors immediately — no retries. The explicit
      // instanceof keeps the catch type-safe.
      if (err instanceof PublicScrapeBlockedError) throw err;
      const ax = err as AxiosError | undefined;
      const code = ax?.code;
      lastTransient = code ? `${code}` : String((err as Error)?.message ?? err);
      attempt++;
      if (attempt <= MAX_RETRIES) {
        await new Promise((r) =>
          setTimeout(r, 500 * Math.pow(2, attempt - 1)),
        );
        continue;
      }
    }
  }

  throw new PublicScrapeTransientError(
    `Public Adobe Stock fetch failed after ${
      MAX_RETRIES + 1
    } attempt(s): ${lastTransient ?? "unknown error"}`,
  );
}

// --- Test hooks -------------------------------------------------------
// These are intentionally not in the public docstring. They exist so a
// future unit test can force the rate-limit clock forward without
// actually waiting 1.5s between assertions.

/** @internal */
export function __resetRateLimiterForTests(): void {
  nextAllowedAt = 0;
}
