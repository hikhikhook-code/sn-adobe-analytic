import bcrypt from "bcryptjs";
import { randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";

/**
 * Password reset token helpers.
 *
 * Security posture
 * ----------------
 *   - Plaintext tokens are generated with `crypto.randomBytes(32)` (256 bits
 *     of entropy) and URL-safe base64-encoded. 2^256 search space makes
 *     brute-forcing infeasible; rate-limiting the API endpoint adds defense
 *     in depth but is not strictly required for confidentiality.
 *   - Only the bcrypt hash of the token is persisted. We never log the
 *     plaintext and we never store it in the DB, so a read-only DB leak
 *     cannot be converted into a password-reset exploit.
 *   - Lookups scan the candidate user's non-expired, non-used tokens and
 *     `bcrypt.compare` against each one. `bcrypt.compare` is itself
 *     constant-time, and we bound the scan to recent tokens to keep
 *     the per-request cost predictable.
 *   - Tokens are one-time use: once `usedAt` is stamped, subsequent
 *     verification attempts fail. We also invalidate every other pending
 *     token for the same user on a successful reset so a stolen older
 *     token can't be reused after the password changes.
 *   - Default lifetime: 60 minutes. Long enough that a user can finish
 *     the flow after switching email clients; short enough to limit
 *     the blast radius of an email-in-transit interception.
 *   - Dev-mode only: when `NODE_ENV !== "production"` we return the raw
 *     plaintext in the forgot-password API response and log a clearly
 *     prefixed `[dev]` line so the developer can click through without
 *     wiring a mailer. Production must NEVER echo the plaintext.
 */

export const RESET_TOKEN_BYTES = 32;
export const RESET_TOKEN_TTL_MINUTES = 60;
const BCRYPT_COST = 10;

/**
 * Generate a URL-safe base64 plaintext token. Callers hand this to the
 * user verbatim (via email or, in dev, via the API response). The hash
 * we persist is derived from this same string.
 */
export function generateResetToken(): string {
  const buf = randomBytes(RESET_TOKEN_BYTES);
  // URL-safe base64 without padding. `.replace` chain is fine here because
  // the output character set is a small constant and we're on a known-size
  // buffer.
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function hashResetToken(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_COST);
}

/**
 * Persist a fresh reset token for the given user, returning the raw
 * plaintext that should be placed in the reset URL. We pre-expire any
 * other pending rows for this user so the inbox never has two live
 * links at once — simpler mental model for the user and smaller attack
 * surface.
 */
export async function issueResetToken(userId: string): Promise<{
  plaintext: string;
  expiresAt: Date;
}> {
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + RESET_TOKEN_TTL_MINUTES * 60 * 1000,
  );

  const plaintext = generateResetToken();
  const tokenHash = await hashResetToken(plaintext);

  // Best-effort "mark every older pending row as used". This is purely a
  // cleanup — even if a concurrent request races us, `consumeResetToken`
  // will still enforce one-time-use via its own update.
  await prisma.passwordResetToken.updateMany({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  });

  await prisma.passwordResetToken.create({
    data: { userId, tokenHash, expiresAt },
  });

  return { plaintext, expiresAt };
}

/**
 * Attempt to consume a plaintext token. Returns the matching userId on
 * success, or null on any failure (no match, expired, already used).
 * The caller should treat null as "invalid or expired link" — do not
 * leak which of the three it was in the UI or in logs.
 *
 * Caller must know the owning userId ahead of time (the reset link
 * carries the userId alongside the opaque token). This avoids an O(N)
 * scan across every user's tokens.
 */
export async function consumeResetToken(
  userId: string,
  plaintext: string,
): Promise<{ ok: boolean }> {
  if (!userId || !plaintext) return { ok: false };

  const now = new Date();
  const candidates = await prisma.passwordResetToken.findMany({
    where: {
      userId,
      usedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: { createdAt: "desc" },
    // Cap the scan so an attacker spamming the forgot-password endpoint
    // can't slow a legitimate user's reset by filling their row set.
    take: 5,
  });

  for (const row of candidates) {
    let match = false;
    try {
      match = await bcrypt.compare(plaintext, row.tokenHash);
    } catch {
      match = false;
    }
    if (!match) continue;

    // Race-free one-time consume: only succeed if we're the one who
    // stamps usedAt. If another concurrent request beats us here, the
    // updateMany returns count=0 and we treat it as invalid.
    const consumed = await prisma.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: now },
    });
    if (consumed.count === 0) return { ok: false };

    // Invalidate every other pending row for this user — if this token
    // was the real one, no other older tokens should remain valid.
    await prisma.passwordResetToken.updateMany({
      where: {
        userId,
        usedAt: null,
        id: { not: row.id },
      },
      data: { usedAt: now },
    });
    return { ok: true };
  }
  return { ok: false };
}

/**
 * Returns true when the runtime may safely include the plaintext token
 * in the forgot-password API response. Limited to non-production builds
 * — production must send via email (or a separate, authenticated admin
 * surface) and never round-trip the raw token to the caller.
 */
export function shouldExposeResetTokenInDev(): boolean {
  return !env.isProd;
}

/**
 * Constant-time string compare for small secrets (e.g. comparing two
 * short IDs). We use this to avoid accidentally leaking length via `==`.
 * Kept here rather than inlined so tests can exercise it directly.
 */
export function safeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}
