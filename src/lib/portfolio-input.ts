/**
 * Parses a portfolio search input into a normalized lookup query.
 *
 * Accepts:
 *   - Plain contributor name           → `{ kind: "name", value: "Studio Lumen" }`
 *   - Numeric contributor ID           → `{ kind: "id", value: "203876" }`
 *   - Adobe Stock contributor URL      → `{ kind: "url", value: "<id-or-name>" }`
 *
 * Adobe Stock contributor URL shapes we recognize (case-insensitive scheme):
 *   - https://stock.adobe.com/contributor/<numericId>/<slug>
 *   - https://stock.adobe.com/contributor/<numericId>
 *   - stock.adobe.com/contributor/<numericId>
 *   - any localized prefix: https://stock.adobe.com/<lang>/contributor/<numericId>/<slug>
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
  | { kind: "url"; value: string; raw: string; slug?: string };

const URL_RE =
  /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*stock\.adobe\.com\/(?:[a-z]{2}(?:_[a-z]{2})?\/)?contributor\/([0-9]+)(?:\/([^\s/?#]+))?/i;

export function parseContributorInput(raw: string): ParsedContributorInput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const urlMatch = URL_RE.exec(trimmed);
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
  }
}
