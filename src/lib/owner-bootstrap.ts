import { prisma } from "@/lib/prisma";
import { isOwnerEmail } from "@/lib/owner";

/**
 * Database-backed owner-access bootstrap.
 *
 * PR #17 recognized owner accounts purely from the `OWNER_EMAILS` env
 * var on every request. PR #18 makes owner access **persistent** in
 * the DB so:
 *
 *   1. The grant survives even if the operator later removes the env
 *      var (useful for demo / ops takeover — you don't want to lock
 *      yourself out by mistyping the env on the next deploy).
 *   2. The Settings UI can show a truthful "Owner since <date>" that
 *      doesn't reset every time the user re-signs-in.
 *   3. Admins granted via direct DB edits (`role = "ADMIN"`) are
 *      honored even when their email is NOT on OWNER_EMAILS.
 *
 * ## Contract
 *
 * Call this AFTER the user has been authenticated (NextAuth sign-in
 * event, existing session load on an API route). Never call it with
 * an untrusted email — the whole point is that OWNER_EMAILS compares
 * against a session email that came out of a real auth check.
 *
 * The function is:
 *
 *   - **Idempotent.** Running it twice on the same user does not
 *     toggle anything. If the user is already OWNER / ADMIN we return
 *     early without touching the DB.
 *   - **Non-destructive.** We never DOWNgrade an ADMIN to OWNER or a
 *     role-bearing user back to USER. Env-var bootstrap only ever
 *     PROMOTES a plain USER. If the operator wants to revoke a role,
 *     they update the DB directly (there is no admin-edit UI yet on
 *     purpose — keeps the blast radius of a UI bug tiny).
 *   - **Failure-tolerant.** DB errors are swallowed. Bootstrap must
 *     never block a sign-in — the user can still access their normal
 *     (non-owner) surface if the DB update fails, and the next
 *     successful request will retry the promotion transparently.
 *
 * ## Hard constraints
 *
 * - This helper is server-only. `prisma` / `isOwnerEmail` never reach
 *   the client bundle.
 * - We NEVER write `role` to anything other than "OWNER" here. The
 *   "ADMIN" tier is reserved for out-of-band DB edits. See
 *   `src/lib/entitlements.ts#normalizeRole` for how the app treats
 *   each value at read time.
 */

export type PersistedRole = "USER" | "OWNER" | "ADMIN";

/**
 * Role values that grant unlimited access. Kept as a tuple so TypeScript
 * preserves the narrowed type at callsites, and so new roles (e.g. a
 * future `"READONLY"` or `"SUPPORT"`) don't accidentally inherit owner
 * privileges just because they were added to the enum.
 */
export const ELEVATED_ROLES: readonly PersistedRole[] = ["OWNER", "ADMIN"] as const;

export function normalizeRole(raw: string | null | undefined): PersistedRole {
  if (!raw) return "USER";
  const k = raw.toUpperCase();
  if (k === "OWNER" || k === "ADMIN") return k;
  return "USER";
}

export function isElevatedRole(role: string | null | undefined): boolean {
  return ELEVATED_ROLES.includes(normalizeRole(role));
}

export interface BootstrapResult {
  /** Normalized role AFTER the bootstrap attempt. */
  role: PersistedRole;
  /** True when this call performed a DB update (USER → OWNER). */
  promoted: boolean;
  /** Why the user has their current role. null for plain USERs. */
  source: string | null;
  /** When the user first became OWNER/ADMIN. null for plain USERs. */
  grantedAt: Date | null;
}

/**
 * If the signed-in user's email is on the OWNER_EMAILS whitelist AND
 * their DB role is still the default "USER", promote them to "OWNER"
 * and stamp `ownerAccessGrantedAt` / `ownerAccessSource = "env_bootstrap"`.
 *
 * Returns a `BootstrapResult` describing the post-call state so the
 * caller can surface it in UI badges without a second DB read.
 *
 * Preconditions:
 *   - `userId` must come from a verified NextAuth session.
 *   - `email` must come from the same session / the user's DB row, NOT
 *     from a request body.
 */
export async function bootstrapOwnerIfEligible(
  userId: string,
  email: string | null | undefined,
): Promise<BootstrapResult> {
  // Fetch current role + grant metadata in a single query. We don't
  // blindly update — idempotency + avoiding the "re-stamp grantedAt
  // every login" problem both require knowing the current state.
  let current: {
    role: string;
    ownerAccessGrantedAt: Date | null;
    ownerAccessSource: string | null;
    email: string | null;
  } | null = null;
  try {
    current = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        ownerAccessGrantedAt: true,
        ownerAccessSource: true,
        email: true,
      },
    });
  } catch {
    // If we can't read, fall back to the most restrictive answer —
    // treat the user as a plain USER for this request. A future
    // successful bootstrap will correct this.
    return {
      role: "USER",
      promoted: false,
      source: null,
      grantedAt: null,
    };
  }

  if (!current) {
    return {
      role: "USER",
      promoted: false,
      source: null,
      grantedAt: null,
    };
  }

  const role = normalizeRole(current.role);

  // Already elevated — nothing to do. ADMIN stays ADMIN; OWNER stays
  // OWNER regardless of whether their email is still on the env list.
  // This is deliberate: removing OWNER_EMAILS should not silently
  // revoke a previously-granted role. Ops has to revoke via the DB.
  if (role !== "USER") {
    return {
      role,
      promoted: false,
      source: current.ownerAccessSource ?? null,
      grantedAt: current.ownerAccessGrantedAt,
    };
  }

  // Plain USER. Check the whitelist against BOTH the email we were
  // passed and the email in the DB row (they should match, but if
  // they don't we want the stricter behavior — only promote when the
  // DB-recorded email matches the env var). This closes a theoretical
  // race where a user's email was updated between the session issuance
  // and the bootstrap call.
  const eligible = isOwnerEmail(email) && isOwnerEmail(current.email);
  if (!eligible) {
    return {
      role: "USER",
      promoted: false,
      source: null,
      grantedAt: null,
    };
  }

  const now = new Date();
  try {
    // Race-safe promotion: only succeed when the row is still in the
    // USER state we read a moment ago. If a concurrent request beat
    // us to it, our update matches 0 rows and we treat the user as
    // already-elevated on the next read.
    const promoted = await prisma.user.updateMany({
      where: { id: userId, role: "USER" },
      data: {
        role: "OWNER",
        ownerAccessGrantedAt: now,
        ownerAccessSource: "env_bootstrap",
      },
    });
    if (promoted.count > 0) {
      return {
        role: "OWNER",
        promoted: true,
        source: "env_bootstrap",
        grantedAt: now,
      };
    }
    // Concurrent request won — re-read to surface the authoritative
    // state for this caller. Best-effort; on read failure we assume
    // the winner promoted us.
    const after = await prisma.user
      .findUnique({
        where: { id: userId },
        select: {
          role: true,
          ownerAccessGrantedAt: true,
          ownerAccessSource: true,
        },
      })
      .catch(() => null);
    return {
      role: normalizeRole(after?.role),
      promoted: false,
      source: after?.ownerAccessSource ?? null,
      grantedAt: after?.ownerAccessGrantedAt ?? null,
    };
  } catch {
    // DB failure — do NOT block sign-in. Return USER and let the next
    // successful request try again. Env-level isOwnerEmail() stays as
    // a belt-and-suspenders path in `entitlementsFor()` so the user
    // isn't locked out of owner access if the DB write transiently
    // fails on their first login.
    return {
      role: "USER",
      promoted: false,
      source: null,
      grantedAt: null,
    };
  }
}
