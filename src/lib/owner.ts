/**
 * Owner / whitelist helper (SERVER-ONLY).
 *
 * PRD §7 carves out an "owner / whitelisted" access tier that bypasses
 * all plan limits. This is meant for the operator's own accounts and any
 * teammates who should have unlimited access during development or early
 * admin work — it is NOT a customer-facing plan, and must NOT be derived
 * from any client-visible data.
 *
 * ## Where the list lives
 *   - `OWNER_EMAILS` env var, comma-separated.
 *   - Server-only: never read from `process.env` on the client; never
 *     shipped in a `NEXT_PUBLIC_*` form; never echoed back in an API
 *     response body beyond a single boolean "is the signed-in caller an
 *     owner?" flag. The actual email list is not sent to the browser.
 *
 * ## Matching
 *   - Case-insensitive email compare. Both the configured entries and
 *     the incoming session email are lowercased + trimmed before compare.
 *   - Empty entries are skipped so a trailing comma in the env doesn't
 *     accidentally whitelist the empty string (which matches no account
 *     but is still worth guarding against).
 *
 * ## Caching
 *   - The parsed set is built once at module load. Operators who rotate
 *     OWNER_EMAILS at runtime should redeploy (same as NEXTAUTH_SECRET).
 *
 * ## Hard constraints
 *   - Do not commit real owner emails to git. `.env.example` documents
 *     the variable with a placeholder; actual values go into Vercel /
 *     local `.env` only.
 */

function parseOwnerEmails(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  const out = new Set<string>();
  for (const part of raw.split(",")) {
    const normalized = part.trim().toLowerCase();
    if (!normalized) continue;
    out.add(normalized);
  }
  return out;
}

const OWNER_EMAIL_SET = parseOwnerEmails(process.env.OWNER_EMAILS);

/**
 * True when the provided email is on the server-side whitelist.
 *
 * Callers must pass an email they've already verified came from a
 * trusted source (NextAuth session, Prisma row) — never the raw form
 * body of a request.
 */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return OWNER_EMAIL_SET.has(email.trim().toLowerCase());
}

/**
 * Exposed primarily for tests / diagnostics. Returns whether any
 * OWNER_EMAILS are configured. Never returns the actual list — the
 * email values stay server-side only.
 */
export function ownerWhitelistConfigured(): boolean {
  return OWNER_EMAIL_SET.size > 0;
}
