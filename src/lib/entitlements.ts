import { isOwnerEmail } from "@/lib/owner";
import { deviceLimitForPlan, type PlanTier } from "@/lib/device-limits";

/**
 * Plan-gating + owner-whitelist entitlements (SERVER + CLIENT SAFE).
 *
 * Single source of truth for "which features can this user use, given
 * their plan + owner status?". PRD §7 lays out the plan matrix; this
 * module encodes it exactly once and hands it out via `entitlementsFor`.
 *
 * ## Why a plain object, not a class
 * We want the shape to be JSON-serializable so the API can return it
 * verbatim in `/api/user/entitlements` and the client can render
 * feature-gate UI from the same facts the server enforces.
 *
 * ## Owner override
 * `isOwner === true` short-circuits every gate. Owners bypass plan
 * limits regardless of `plan` field value — this is deliberate because
 * the operator's own account might still have `plan: "FREE"` in the DB
 * (we haven't added admin-self-upgrade UX yet).
 *
 * ## Owner-detection order (PR #18)
 * Owner status is derived in this order, stopping at the first match:
 *   1. Explicit `ownerOverride: true` (tests).
 *   2. `role` = "OWNER" or "ADMIN" (persisted DB role — the primary
 *      source of truth once the user has been through bootstrap).
 *   3. `email` is on OWNER_EMAILS whitelist (bootstrap fallback — covers
 *      the window between sign-in and the DB write, and the edge case
 *      where the DB write transiently failed).
 *
 * ## Unknown plans / roles
 * Unknown / malformed values fall back to the most-restrictive tier
 * (plan: FREE, role: USER) so a typo never silently grants full access.
 */

export type UnlimitedDailySearches = "unlimited";

export interface Entitlements {
  /** Normalized plan tier. "FREE" on unknown / missing plan values. */
  plan: PlanTier;
  /**
   * Normalized DB role. "USER" on unknown / missing values. Useful for
   * UI copy ("Owner" vs "Admin" badge) — the actual "does this user
   * bypass plan gates?" signal is `isOwner`, which collapses OWNER +
   * ADMIN + env-bootstrap into one boolean.
   */
  role: "USER" | "OWNER" | "ADMIN";
  /** True if this caller bypasses every plan gate (role OR env match). */
  isOwner: boolean;
  /** Human-friendly label for the current access tier. */
  planLabel: string;
  /** Feature gates — true means the feature is available. */
  canSearch: boolean;
  canExportCsv: boolean;
  canUseSimilarSearch: boolean;
  canUsePortfolioTracker: boolean;
  canUseHeatMap: boolean;
  canUseTrending: boolean;
  canUsePerformanceAnalytics: boolean;
  canUseSavedTracking: boolean;
  /**
   * Per-day search budget. `"unlimited"` for Pro / Annual / Owner.
   * Numeric limits (FREE=2, STARTER=50) are enforced by the search API
   * against `User.searchesUsedToday` with a daily reset window.
   */
  maxSearchesPerDay: number | UnlimitedDailySearches;
  /**
   * Device limit (see PRD §6 + src/lib/device-limits.ts). Owner gets
   * a deliberately-high ceiling rather than Infinity so the UI can
   * still render a useful "N of M" figure.
   */
  maxDevices: number;
}

/**
 * Owner ceiling for device count. 99 is arbitrary-but-plenty — the UI
 * still renders meaningfully ("3 of 99 devices used") and we don't have
 * to special-case Infinity everywhere.
 */
const OWNER_DEVICE_CEILING = 99;

/**
 * Normalize an arbitrary string (including legacy lowercase values like
 * `"free"`) into one of the canonical plan tiers. Unknown => FREE.
 */
export function normalizePlan(raw: string | null | undefined): PlanTier {
  if (!raw) return "FREE";
  const k = raw.toUpperCase();
  if (k === "STARTER" || k === "PRO" || k === "ANNUAL") return k;
  return "FREE";
}

/**
 * Normalize a stored role value. Kept local to this module so the
 * client-safe entitlements.ts doesn't need to import from
 * `owner-bootstrap.ts` (which would pull Prisma into the client bundle).
 * The server-side counterpart in `owner-bootstrap.ts` accepts the same
 * value set.
 */
export function normalizeRole(
  raw: string | null | undefined,
): "USER" | "OWNER" | "ADMIN" {
  if (!raw) return "USER";
  const k = raw.toUpperCase();
  if (k === "OWNER" || k === "ADMIN") return k;
  return "USER";
}

export interface EntitlementInput {
  /** Value of `User.plan` (any casing). Missing / unknown => FREE. */
  plan?: string | null;
  /** User's email — used to check the OWNER_EMAILS whitelist. */
  email?: string | null;
  /**
   * Value of `User.role` (any casing). Missing / unknown => USER.
   * Set to "OWNER" or "ADMIN" by `owner-bootstrap.ts` on sign-in; read
   * straight from the `User` row on every gate check.
   */
  role?: string | null;
  /**
   * Optional explicit owner override. Useful in tests. If omitted we
   * derive it from `role` (DB-backed, preferred) then `email` (env
   * bootstrap fallback) via `isOwnerEmail`.
   */
  ownerOverride?: boolean;
}

/**
 * Compute the full entitlement bundle for a given user. Safe to call
 * with zero info (anonymous caller); returns the FREE bundle.
 */
export function entitlementsFor(input: EntitlementInput = {}): Entitlements {
  const plan = normalizePlan(input.plan);
  const role = normalizeRole(input.role);
  const isOwner =
    input.ownerOverride === true ||
    role === "OWNER" ||
    role === "ADMIN" ||
    isOwnerEmail(input.email ?? null);

  if (isOwner) {
    return {
      plan,
      role,
      isOwner: true,
      planLabel: role === "ADMIN" ? "Admin access" : "Owner access",
      canSearch: true,
      canExportCsv: true,
      canUseSimilarSearch: true,
      canUsePortfolioTracker: true,
      canUseHeatMap: true,
      canUseTrending: true,
      canUsePerformanceAnalytics: true,
      canUseSavedTracking: true,
      maxSearchesPerDay: "unlimited",
      maxDevices: OWNER_DEVICE_CEILING,
    };
  }

  switch (plan) {
    case "STARTER":
      return {
        plan,
        role,
        isOwner: false,
        planLabel: "Starter",
        canSearch: true,
        canExportCsv: true,
        canUseSimilarSearch: true,
        // Starter explicitly does NOT include portfolio / heat map /
        // trending / performance analytics per PRD §7.
        canUsePortfolioTracker: false,
        canUseHeatMap: false,
        canUseTrending: false,
        canUsePerformanceAnalytics: false,
        canUseSavedTracking: true,
        maxSearchesPerDay: 50,
        maxDevices: deviceLimitForPlan("STARTER"),
      };
    case "PRO":
      return {
        plan,
        role,
        isOwner: false,
        planLabel: "Pro",
        canSearch: true,
        canExportCsv: true,
        canUseSimilarSearch: true,
        canUsePortfolioTracker: true,
        canUseHeatMap: true,
        canUseTrending: true,
        canUsePerformanceAnalytics: true,
        canUseSavedTracking: true,
        maxSearchesPerDay: "unlimited",
        maxDevices: deviceLimitForPlan("PRO"),
      };
    case "ANNUAL":
      return {
        plan,
        role,
        isOwner: false,
        planLabel: "Annual",
        canSearch: true,
        canExportCsv: true,
        canUseSimilarSearch: true,
        canUsePortfolioTracker: true,
        canUseHeatMap: true,
        canUseTrending: true,
        canUsePerformanceAnalytics: true,
        canUseSavedTracking: true,
        maxSearchesPerDay: "unlimited",
        maxDevices: deviceLimitForPlan("ANNUAL"),
      };
    case "FREE":
    default:
      return {
        plan: "FREE",
        role,
        isOwner: false,
        planLabel: "Free",
        // Free tier can search (limited per-day) but NOT export / similar
        // / portfolio / heat map / trending / saved-tracking per PRD §7.
        canSearch: true,
        canExportCsv: false,
        canUseSimilarSearch: false,
        canUsePortfolioTracker: false,
        canUseHeatMap: false,
        canUseTrending: false,
        canUsePerformanceAnalytics: false,
        canUseSavedTracking: false,
        maxSearchesPerDay: 2,
        maxDevices: deviceLimitForPlan("FREE"),
      };
  }
}

/** Anonymous (guest) bundle — FREE tier rules, `isOwner: false`. */
export function guestEntitlements(): Entitlements {
  return entitlementsFor({ plan: "FREE", email: null, role: null });
}

/**
 * Stable feature keys for the plan-comparison UI + feature-gate errors.
 * Matches the PRD §7 column order.
 */
export const FEATURE_KEYS = [
  "canSearch",
  "canExportCsv",
  "canUseSimilarSearch",
  "canUsePortfolioTracker",
  "canUseHeatMap",
  "canUseTrending",
  "canUsePerformanceAnalytics",
  "canUseSavedTracking",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

/** Human-friendly label for a feature key. Used by the pricing page. */
export const FEATURE_LABELS: Readonly<Record<FeatureKey, string>> = {
  canSearch: "Keyword search",
  canExportCsv: "Export CSV",
  canUseSimilarSearch: "Similar Image Search",
  canUsePortfolioTracker: "Portfolio Tracker",
  canUseHeatMap: "Heat Map",
  canUseTrending: "Trending Insights",
  canUsePerformanceAnalytics: "Performance Analytics",
  canUseSavedTracking: "Save & Track Favorites",
};

/**
 * Short denial messages we can show in the UI when a feature gate is
 * closed. Each mentions upgrading because we never want a blocked user
 * to stare at an empty page and wonder what went wrong.
 */
export const FEATURE_DENIAL_REASONS: Readonly<Record<FeatureKey, string>> = {
  canSearch:
    "Sign in to run searches. Guests can browse demo data only.",
  canExportCsv:
    "CSV export is available on Starter, Pro, and Annual plans. Upgrade your plan to continue.",
  canUseSimilarSearch:
    "Similar Image Search is available on Starter, Pro, and Annual plans.",
  canUsePortfolioTracker:
    "Portfolio Tracker is available on Pro and Annual plans.",
  canUseHeatMap:
    "Heat Map is available on Pro and Annual plans.",
  canUseTrending:
    "Trending Insights is available on Pro and Annual plans.",
  canUsePerformanceAnalytics:
    "Performance Analytics is available on Pro and Annual plans.",
  canUseSavedTracking:
    "Save & Track Favorites is available on Starter, Pro, and Annual plans.",
};
