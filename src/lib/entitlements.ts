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
 * ## Unknown plans
 * Unknown / malformed `plan` strings fall back to FREE tier — the most
 * restrictive bucket — so a typo never silently grants full access.
 */

export type UnlimitedDailySearches = "unlimited";

export interface Entitlements {
  /** Normalized plan tier. "FREE" on unknown / missing plan values. */
  plan: PlanTier;
  /** True if the signed-in email is on `OWNER_EMAILS` whitelist. */
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

export interface EntitlementInput {
  /** Value of `User.plan` (any casing). Missing / unknown => FREE. */
  plan?: string | null;
  /** User's email — used to check the OWNER_EMAILS whitelist. */
  email?: string | null;
  /**
   * Optional explicit owner override. Useful in tests. If omitted we
   * derive it from `email` via `isOwnerEmail`.
   */
  ownerOverride?: boolean;
}

/**
 * Compute the full entitlement bundle for a given user. Safe to call
 * with zero info (anonymous caller); returns the FREE bundle.
 */
export function entitlementsFor(input: EntitlementInput = {}): Entitlements {
  const plan = normalizePlan(input.plan);
  const isOwner =
    input.ownerOverride === true || isOwnerEmail(input.email ?? null);

  if (isOwner) {
    return {
      plan,
      isOwner: true,
      planLabel: "Owner access",
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
  return entitlementsFor({ plan: "FREE", email: null });
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
