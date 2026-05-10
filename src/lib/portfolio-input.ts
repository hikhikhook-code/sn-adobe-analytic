/**
 * Parses a portfolio search input into a normalized lookup query.
 *
 * Accepts:
 *   - Plain contributor name           → `{ kind: "name", value: "Studio Lumen" }`
 *   - Numeric contributor ID           → `{ kind: "id", value: "203876" }`
 *   - Adobe Stock contributor URL      → `{ kind: "url", value: "<id-or-name>" }`
 *   - Adobe Stock search-by-creator_id URL (PR #20)
 *                                      → `{ kind: "creator_id", value: "<id>" }`
 *
 * Adobe Stock contributor URL shapes we recognize (case-insensitive scheme):
 *   - https://stock.adobe.com/contributor/<numericId>/<slug>
 *   - https://stock.adobe.com/contributor/<numericId>
 *   - stock.adobe.com/contributor/<numericId>
 *   - any localized prefix: https://stock.adobe.com/<lang>/contributor/<numericId>/<slug>
 *
 * Adobe Stock creator-id search URLs we recognize (PR #20 QA fix):
 *   - https://stock.adobe.com/uk/search/images?creator_id=203204060
 *   - https://stock.adobe.com/search?creator_id=203204060
 *   - stock.adobe.com/<locale>/search[/images|/templates|/video|/3d]?creator_id=<id>&...
 *
 * These are the URLs Adobe Stock itself hands out when you click a
 * contributor name on a search results page — they don't carry the
 * numeric contributor id in the path (`/contributor/<id>`), they carry
 * it in the `creator_id` query string. Before PR #20 the parser only
 * matched the path-based form, so pasting one of these creator-id URLs
 * fell through to `{ kind: "name", value: <the whole URL> }`, and the
 * provider raised a 400 because the literal URL was never a match for
 * any contributor name. We now extract the numeric id out of the
 * query string (either from a proper URL or a bare
 * `stock.adobe.com/...?creator_id=<id>` fragment).
 *
 * The parser is deliberately permissive: anything we can't recognize as a URL
 * falls through to `{ kind: "name", value: <trimmed> }` so the caller never
 * has to special-case "user typed a name". Callers should still send the
 * normalized `value` to the provider; the manual provider matches against
 * either contributor name or contributor ID, so the provider does not need
 * to know how the value was parsed.
 */

export type ParsedContributorInput =
  | { kind: "name"; value: string; raw: string }
  | { kind: "id"; value: string; raw: string }
  | { kind: "url"; value: string; raw: string; slug?: string }
  | { kind: "creator_id"; value: string; raw: string };

const CONTRIBUTOR_URL_RE =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*stock\.adobe\.com\/(?:[a-z]{2}(?:_[a-z]{2})?\/)?contributor\/([0-9]+)(?:\/([^\s/?#]+))?/i;

/**
 * Matches a stock.adobe.com URL that points at a search page (any locale,
 * any sub-type like `/search`, `/search/images`, `/search/video`, ...)
 * AND carries a `creator_id=<digits>` parameter. The query-string
 * extraction is done in a second step so we don't have to enumerate
 * every valid query permutation inside one regex.
 */
const SEARCH_URL_RE =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*stock\.adobe\.com\/(?:[a-z]{2}(?:_[a-z]{2})?\/)?search(?:\/[a-z0-9_-]+)?\?([^\s#]*)/i;

/**
 * Extract a `creator_id` parameter value from a URL's query-string body
 * (everything after `?`, without the leading `?`). Returns null when the
 * parameter is absent or not a positive integer.
 *
 * We hand-parse rather than use `URLSearchParams` because the regex
 * above also matches bare `stock.adobe.com/...?creator_id=...` fragments
 * that aren't valid absolute URLs, and `new URL()` rejects those.
 */
function readCreatorId(query: string): string | null {
  // Split on `&` so we don't confuse `?creator_id=1234&k=foo` with
  // `?creator_name=1234` (substring-match would otherwise false-positive).
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    if (key !== "creator_id") continue;
    const raw = pair.slice(eq + 1).trim();
    // URL-decoded so a value like "203204060%0A" (unlikely but possible
    // from paste-mangled input) still extracts cleanly.
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      decoded = raw;
    }
    decoded = decoded.trim();
    // Adobe Stock creator ids are numeric. Guard against non-numeric
    // values so we never promote arbitrary strings to `kind: "creator_id"`.
    if (/^\d{3,}$/.test(decoded)) return decoded;
    return null;
  }
  return null;
}

export function parseContributorInput(raw: string): ParsedContributorInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Path-based contributor URL: /contributor/<id>/<slug?>
  const urlMatch = CONTRIBUTOR_URL_RE.exec(trimmed);
  if (urlMatch) {
    const id = urlMatch[1];
    const slug = urlMatch[2];
    return {
      kind: "url",
      value: id,
      raw: trimmed,
      slug: slug ? decodeURIComponent(slug.replace(/[-_+]/g, " ")) : undefined,
    };
  }

  // Query-based creator_id URL: /<locale>/search[/<type>]?creator_id=<id>
  const searchMatch = SEARCH_URL_RE.exec(trimmed);
  if (searchMatch) {
    const creatorId = readCreatorId(searchMatch[1] ?? "");
    if (creatorId) {
      return { kind: "creator_id", value: creatorId, raw: trimmed };
    }
  }

  // Plain numeric ID — Adobe Stock contributor IDs are numeric.
  if (/^\d{3,}$/.test(trimmed)) {
    return { kind: "id", value: trimmed, raw: trimmed };
  }

  return { kind: "name", value: trimmed, raw: trimmed };
}

/**
 * Pretty label for the input parser's output. Used by the empty-state /
 * loading UI so the user sees "Looking up contributor #203876" rather than
 * the raw URL they pasted.
 */
export function describeContributorInput(parsed: ParsedContributorInput): string {
  switch (parsed.kind) {
    case "name":
      return `contributor "${parsed.value}"`;
    case "id":
      return `contributor #${parsed.value}`;
    case "url":
      return parsed.slug
        ? `contributor "${parsed.slug}" (#${parsed.value})`
        : `contributor #${parsed.value}`;
    case "creator_id":
      return `contributor #${parsed.value}`;
  }
}

/**
 * True when the parsed input is a numeric lookup (plain id, path-based
 * contributor URL, or query-string creator_id URL). The portfolio API
 * uses this to decide whether a "not found" result from the user's
 * imported data should fall back to mock (for a free-text name the mock
 * generator can synthesize a demo contributor; for a numeric id it
 * must not, because every id would otherwise appear to have a real
 * Adobe portfolio).
 */
export function isNumericContributorLookup(
  parsed: ParsedContributorInput,
): boolean {
  return (
    parsed.kind === "id" ||
    parsed.kind === "url" ||
    parsed.kind === "creator_id"
  );
}
