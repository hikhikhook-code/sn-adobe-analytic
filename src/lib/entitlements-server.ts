import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  entitlementsFor,
  guestEntitlements,
  type Entitlements,
} from "@/lib/entitlements";
import { bootstrapOwnerIfEligible } from "@/lib/owner-bootstrap";

/**
 * Server-side convenience that merges "who is the caller?" + "what's
 * their plan?" into a single entitlements bundle.
 *
 * Why this lives in its own file (separate from `entitlements.ts`):
 * `entitlements.ts` must stay safe to import from client components
 * (the pricing page, settings, feature-gate notices). Pulling
 * `getServerSession` / `prisma` into that module would drag the auth +
 * Prisma runtime into every client bundle, ballooning size and leaking
 * server-only globals. Keeping the DB-touching helper here means the
 * client can `import { entitlementsFor }` freely and only server routes
 * import from `entitlements-server.ts`.
 */
export interface SessionEntitlements {
  userId: string | null;
  email: string | null;
  plan: string | null;
  /** Normalized DB role. "USER" for plain users / guests. */
  role: "USER" | "OWNER" | "ADMIN";
  /** ISO timestamp the user first became OWNER/ADMIN, or null. */
  ownerAccessGrantedAt: Date | null;
  /** "env_bootstrap" | "manual" | "seed" | null. Null while role === USER. */
  ownerAccessSource: string | null;
  searchesUsedToday: number;
  searchResetAt: Date | null;
  entitlements: Entitlements;
}

/**
 * Load entitlements for the currently-signed-in user. Returns a guest
 * bundle (no userId) when unauthenticated.
 *
 * ## Owner bootstrap
 * On every signed-in call we attempt `bootstrapOwnerIfEligible`. That
 * helper is idempotent, race-safe, and only PROMOTES plain USERs when
 * their email is on `OWNER_EMAILS`. Calling it here (rather than only
 * from the NextAuth sign-in event) buys us two things:
 *
 *   1. If the sign-in event's DB write transiently failed, the next
 *      gated request succeeds and the user sees Owner access.
 *   2. Operators can add an already-signed-in user to OWNER_EMAILS
 *      and have that user's next request promote them, without
 *      forcing a sign-out / sign-in.
 *
 * We do not cache at module level — the session cookie can change
 * between requests and role updates must be reflected on the next
 * request, not the next cold start.
 */
export async function getSessionEntitlements(): Promise<SessionEntitlements> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return {
      userId: null,
      email: session?.user?.email ?? null,
      plan: null,
      role: "USER",
      ownerAccessGrantedAt: null,
      ownerAccessSource: null,
      searchesUsedToday: 0,
      searchResetAt: null,
      entitlements: guestEntitlements(),
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      plan: true,
      role: true,
      ownerAccessGrantedAt: true,
      ownerAccessSource: true,
      searchesUsedToday: true,
      searchResetAt: true,
    },
  });

  // Lazy bootstrap — idempotent and swallows its own errors. Returns the
  // authoritative post-call role so we can feed it straight into the
  // entitlements bundle without a second DB read.
  const bootstrapped = await bootstrapOwnerIfEligible(userId, user?.email);

  const entitlements = entitlementsFor({
    plan: user?.plan,
    email: user?.email,
    role: bootstrapped.role,
  });

  return {
    userId,
    email: user?.email ?? session?.user?.email ?? null,
    plan: user?.plan ?? null,
    role: bootstrapped.role,
    ownerAccessGrantedAt: bootstrapped.grantedAt,
    ownerAccessSource: bootstrapped.source,
    searchesUsedToday: user?.searchesUsedToday ?? 0,
    searchResetAt: user?.searchResetAt ?? null,
    entitlements,
  };
}

/**
 * Daily-search-budget accounting. Returns a record with:
 *   - `allowed`: whether this caller can run another search right now.
 *   - `remaining`: how many searches they have left today (null for
 *     unlimited / owner).
 *   - `used`: current counter value after any reset (not incremented).
 *   - `limit`: plan's per-day cap (null for unlimited).
 *
 * The function resets the counter when `searchResetAt` has rolled into
 * a new calendar day — so a user who ran 50 searches yesterday gets a
 * fresh 50 today without needing an external cron.
 */
export interface SearchQuotaStatus {
  allowed: boolean;
  unlimited: boolean;
  remaining: number | null;
  used: number;
  limit: number | null;
}

export async function checkAndResetDailySearchBudget(
  userId: string,
  now: Date = new Date(),
): Promise<SearchQuotaStatus & { plan: string; isOwner: boolean }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      plan: true,
      role: true,
      searchesUsedToday: true,
      searchResetAt: true,
    },
  });

  // Give the bootstrap a chance to promote a USER-on-whitelist BEFORE
  // we decide whether this request is subject to the daily cap.
  // `bootstrapOwnerIfEligible` is idempotent + error-tolerant, so the
  // extra call is safe even on the hot path.
  const bootstrapped = await bootstrapOwnerIfEligible(userId, user?.email);

  const entitlements = entitlementsFor({
    plan: user?.plan,
    email: user?.email,
    role: bootstrapped.role,
  });
  const unlimited = entitlements.maxSearchesPerDay === "unlimited";
  const limit = unlimited
    ? null
    : (entitlements.maxSearchesPerDay as number);

  // Daily reset: compare the stored reset timestamp against "start of
  // today" UTC. Using UTC avoids a Daylight Savings edge case where a
  // local-time midnight could double-reset or skip a reset.
  const startOfToday = new Date(now);
  startOfToday.setUTCHours(0, 0, 0, 0);

  let used = user?.searchesUsedToday ?? 0;
  const lastReset = user?.searchResetAt ?? null;
  if (!lastReset || lastReset < startOfToday) {
    await prisma.user.update({
      where: { id: userId },
      data: { searchesUsedToday: 0, searchResetAt: now },
    });
    used = 0;
  }

  if (unlimited) {
    return {
      allowed: true,
      unlimited: true,
      remaining: null,
      used,
      limit: null,
      plan: entitlements.plan,
      isOwner: entitlements.isOwner,
    };
  }

  const remaining = Math.max(0, (limit ?? 0) - used);
  return {
    allowed: remaining > 0,
    unlimited: false,
    remaining,
    used,
    limit,
    plan: entitlements.plan,
    isOwner: entitlements.isOwner,
  };
}

/**
 * Increment the daily-search counter. Called AFTER a search successfully
 * executes. Kept separate from `checkAndResetDailySearchBudget` so the
 * route can short-circuit on invalid input without wasting a counter
 * tick. No-ops for owners / unlimited plans.
 */
export async function recordDailySearch(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true, role: true },
  });
  const entitlements = entitlementsFor({
    plan: user?.plan,
    email: user?.email,
    role: user?.role,
  });
  if (entitlements.maxSearchesPerDay === "unlimited") return;

  await prisma.user
    .update({
      where: { id: userId },
      data: { searchesUsedToday: { increment: 1 } },
    })
    .catch(() => {
      // Incrementing the counter must never block the search response,
      // so swallow DB errors. Worst case a single search doesn't count
      // against the daily budget; better than an unhandled 500.
    });
}
