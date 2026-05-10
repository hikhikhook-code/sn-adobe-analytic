/**
 * Metadata-based similarity scoring for the "Similar Image Search" feature.
 *
 * The PRD is explicit that this is NOT a real visual AI / perceptual hashing
 * pipeline. We never claim to match pixels. Instead we tokenize whatever
 * textual signal we have about the query image (URL path, filename, optional
 * hint text) and rank candidate assets by metadata overlap (title, keywords,
 * categories, content type). The UI labels every result as
 * `Estimated / metadata similarity` so users never mistake this for true
 * visual search.
 *
 * Public surface:
 *   - {@link tokenize}            — split text into lowercase alpha-numeric tokens
 *   - {@link extractQueryTokens}  — derive a query-token bag from the request
 *   - {@link scoreSimilarity}     — score a single asset against the query
 *   - {@link rankSimilar}         — sort candidates desc and assign scores
 */

import type { SearchAsset } from "@/types/search";

/** Words too generic to contribute meaningful similarity. Kept short so the
 *  heuristic stays predictable. */
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "is",
  "are",
  "be",
  "this",
  "that",
  "it",
  "as",
  "image",
  "images",
  "photo",
  "photos",
  "picture",
  "pic",
  "stock",
  "adobe",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "tiff",
  "raw",
  "media",
  "asset",
  "file",
  "files",
  "thumb",
  "thumbnail",
]);

/**
 * Split arbitrary text into lowercase alphanumeric tokens, dropping
 * stopwords and 1-character tokens (which are too noisy to be useful).
 */
export function tokenize(input: string | null | undefined): string[] {
  if (!input) return [];
  // Decode percent-encoded URL pieces best-effort so e.g. "business%20laptop"
  // becomes ["business", "laptop"] not ["business20laptop"].
  let s = input;
  try {
    s = decodeURIComponent(input);
  } catch {
    /* ignore malformed */
  }
  const raw = s
    .toLowerCase()
    .replace(/https?:\/\/\S*/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/**
 * Try to read the trailing path segment of a URL — typically the asset
 * filename. We strip the extension and any querystring. Returns "" if
 * parsing fails, never throws.
 */
export function basenameFromUrl(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop() ?? "";
    return last.replace(/\.[a-z0-9]+$/i, "");
  } catch {
    return url.replace(/\.[a-z0-9]+$/i, "");
  }
}

/**
 * Build the query token bag from whatever signal the request provides.
 * URL path segments and the filename are mined for tokens; an optional
 * free-text `hint` is added verbatim. Tokens are deduped while preserving
 * insertion order so the highest-signal pieces (hint > filename > URL)
 * weight earlier in tie-breaks.
 */
export function extractQueryTokens(input: {
  imageUrl?: string;
  imageFileName?: string;
  hint?: string;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (toks: string[]) => {
    for (const t of toks) {
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
  };
  push(tokenize(input.hint));
  push(tokenize(input.imageFileName));
  if (input.imageUrl) {
    push(tokenize(basenameFromUrl(input.imageUrl)));
    try {
      const u = new URL(input.imageUrl);
      // Path segments give us extra niche hints (e.g. /search/business/...)
      push(tokenize(u.pathname.replace(/\//g, " ")));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * Compute a 0..100 metadata similarity score between a query-token bag
 * and a candidate asset. The breakdown:
 *
 *   - URL match boost      → 100 (short-circuit) when `imageUrl` exactly
 *                            matches the asset's adobeStockUrl or
 *                            thumbnailUrl. A real "this is the same image"
 *                            signal trumps token similarity.
 *   - Title overlap        → 35pt  (Jaccard over tokenize(title) ∩ query)
 *   - Keyword overlap      → 40pt  (Jaccard over asset.keywords ∩ query)
 *   - Category match       → 15pt  (any query token in asset.categories OR
 *                                   asset.contentType matches a query token)
 *   - Content-type bonus   → 10pt  (request.contentType === asset.contentType)
 *
 * When the query has zero tokens AND no URL match, returns
 * `{ score: 0, available: false }` — the caller should mark the result
 * as "Unavailable" rather than render a fake zero.
 */
export interface SimilarityInput {
  queryTokens: string[];
  imageUrl?: string;
  contentType?: string;
}

export interface SimilarityScore {
  score: number;
  available: boolean;
  /** Whether the result was a perfect URL hit (used for tie-break sort). */
  exactUrlMatch: boolean;
}

export function scoreSimilarity(
  asset: SearchAsset,
  input: SimilarityInput,
): SimilarityScore {
  const exactUrlMatch =
    !!input.imageUrl &&
    !!asset.adobeStockUrl &&
    asset.adobeStockUrl === input.imageUrl;
  const thumbMatch =
    !!input.imageUrl &&
    !!asset.thumbnailUrl &&
    asset.thumbnailUrl === input.imageUrl;
  if (exactUrlMatch || thumbMatch) {
    return { score: 100, available: true, exactUrlMatch: true };
  }

  const q = new Set(input.queryTokens);
  if (q.size === 0) {
    return { score: 0, available: false, exactUrlMatch: false };
  }

  const titleTokens = new Set(tokenize(asset.title));
  const keywordTokens = new Set(asset.keywords.map((k) => k.toLowerCase()));
  const categoryTokens = new Set(
    asset.categories.flatMap((c) => tokenize(c)),
  );

  const jaccard = (a: Set<string>, b: Set<string>): number => {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    Array.from(a).forEach((t) => {
      if (b.has(t)) inter += 1;
    });
    const union = a.size + b.size - inter;
    return union > 0 ? inter / union : 0;
  };

  const titleScore = jaccard(q, titleTokens) * 35;
  const keywordScore = jaccard(q, keywordTokens) * 40;
  const queryHasCategoryHit = Array.from(q).some(
    (t) => categoryTokens.has(t) || tokenize(asset.contentType).includes(t),
  );
  const categoryScore = queryHasCategoryHit ? 15 : 0;
  const contentTypeBonus =
    input.contentType &&
    input.contentType !== "all" &&
    asset.contentType === input.contentType
      ? 10
      : 0;

  const total = titleScore + keywordScore + categoryScore + contentTypeBonus;
  return {
    score: Math.max(0, Math.min(100, Math.round(total))),
    available: true,
    exactUrlMatch: false,
  };
}

/**
 * Score every candidate against the query and return them sorted
 * descending by score. Ties break on `exactUrlMatch` then on the asset's
 * own `downloads` so a more popular asset wins when scores are identical.
 *
 * Assets that cannot be scored (`available === false`) are returned at
 * the end of the list with `score = 0` and `available = false` so the UI
 * can render "Unavailable" without losing them entirely.
 */
export function rankSimilar(
  candidates: SearchAsset[],
  input: SimilarityInput,
): { asset: SearchAsset; score: SimilarityScore }[] {
  const scored = candidates.map((asset) => ({
    asset,
    score: scoreSimilarity(asset, input),
  }));
  scored.sort((a, b) => {
    if (a.score.exactUrlMatch !== b.score.exactUrlMatch) {
      return a.score.exactUrlMatch ? -1 : 1;
    }
    if (a.score.available !== b.score.available) {
      return a.score.available ? -1 : 1;
    }
    if (b.score.score !== a.score.score) return b.score.score - a.score.score;
    return (b.asset.downloads ?? 0) - (a.asset.downloads ?? 0);
  });
  return scored;
}
