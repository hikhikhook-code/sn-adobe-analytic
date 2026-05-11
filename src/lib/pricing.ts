/**
 * Centralized pricing configuration (PR #26).
 *
 * Source of truth for plan pricing. USD is the canonical base currency.
 * IDR display prices are computed from USD using `USD_TO_IDR_RATE` env
 * var (or a safe default for local/demo use only). The converted IDR
 * price is for DISPLAY purposes only — actual checkout uses the Stripe
 * Price ID configured for that currency.
 *
 * Hard rules:
 *   - No live exchange-rate API calls.
 *   - No real secrets in this file.
 *   - IDR display is informational; final checkout price is the one
 *     configured in Stripe's dashboard for the IDR Price ID.
 */

export type PlanId = "FREE" | "STARTER" | "PRO" | "ANNUAL";
export type Currency = "USD" | "IDR";

export interface PlanPricing {
  id: PlanId;
  label: string;
  /** Monthly price in USD cents (e.g. 900 = $9.00). */
  monthlyUsdCents: number;
  /** Billing period label shown on the pricing card. */
  billingPeriod: string;
  /** Features included in this plan (for the pricing card). */
  features: string[];
  /** True if this is the "recommended" / highlighted plan. */
  recommended?: boolean;
}

/**
 * Plan pricing definitions. USD cents are the source of truth.
 * Free plan has no price (not purchasable via checkout).
 */
export const PLANS: Record<PlanId, PlanPricing> = {
  FREE: {
    id: "FREE",
    label: "Free",
    monthlyUsdCents: 0,
    billingPeriod: "forever",
    features: [
      "2 searches / day",
      "1 device",
      "Basic search results",
    ],
  },
  STARTER: {
    id: "STARTER",
    label: "Starter",
    monthlyUsdCents: 900, // $9/month
    billingPeriod: "month",
    features: [
      "50 searches / day",
      "1 device",
      "Export CSV",
      "Save & track favorites",
      "Similar image search",
    ],
  },
  PRO: {
    id: "PRO",
    label: "Pro",
    monthlyUsdCents: 2900, // $29/month
    billingPeriod: "month",
    recommended: true,
    features: [
      "Unlimited searches",
      "3 devices",
      "Export CSV",
      "Portfolio Tracker",
      "Heat Map",
      "Trending Insights",
      "Performance Analytics",
    ],
  },
  ANNUAL: {
    id: "ANNUAL",
    label: "Annual",
    monthlyUsdCents: 1900, // $19/month billed annually ($228/year)
    billingPeriod: "month (billed annually)",
    features: [
      "Everything in Pro",
      "5 devices",
      "Priority support",
      "Annual billing discount",
    ],
  },
};

/** Ordered list of plans for display. */
export const PLAN_ORDER: PlanId[] = ["FREE", "STARTER", "PRO", "ANNUAL"];

/**
 * Get the USD to IDR exchange rate from env. Falls back to a safe
 * default (16000) for local/demo display only.
 *
 * WARNING: This rate is NOT a live financial quote. It is a static
 * configuration value for approximate display purposes. The actual
 * checkout price in IDR is determined by the Stripe Price ID
 * configured for IDR in the operator's Stripe dashboard.
 */
export function getUsdToIdrRate(): number {
  const envRate = process.env.USD_TO_IDR_RATE ?? process.env.NEXT_PUBLIC_USD_TO_IDR_RATE;
  if (envRate) {
    const parsed = Number(envRate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  // Safe default for local/demo only. Not a live exchange rate.
  return 16_000;
}

/**
 * Format a price for display in the given currency.
 */
export function formatPrice(cents: number, currency: Currency): string {
  if (currency === "USD") {
    const dollars = cents / 100;
    return dollars % 1 === 0 ? `$${dollars}` : `$${dollars.toFixed(2)}`;
  }
  // IDR: convert from USD cents to IDR, round to nearest 1000
  const rate = getUsdToIdrRate();
  const idr = Math.round((cents / 100) * rate / 1000) * 1000;
  return `Rp${idr.toLocaleString("id-ID")}`;
}

/**
 * Get the display price string for a plan in the given currency.
 * Returns null for the Free plan (not purchasable).
 */
export function getPlanDisplayPrice(
  planId: PlanId,
  currency: Currency,
): string | null {
  const plan = PLANS[planId];
  if (!plan || plan.monthlyUsdCents === 0) return null;
  const price = formatPrice(plan.monthlyUsdCents, currency);
  return `${price} / ${plan.billingPeriod === "month" ? "month" : plan.billingPeriod}`;
}

/**
 * Stripe Price ID configuration. Each plan × currency combination
 * maps to a Stripe Price ID configured in the operator's dashboard.
 * These are read from env vars at runtime.
 *
 * When a Price ID is not configured, the checkout button shows a
 * clean "not configured" state rather than faking a payment flow.
 */
export interface StripePriceIds {
  STARTER_USD?: string;
  PRO_USD?: string;
  ANNUAL_USD?: string;
  STARTER_IDR?: string;
  PRO_IDR?: string;
  ANNUAL_IDR?: string;
}

export function getStripePriceIds(): StripePriceIds {
  return {
    STARTER_USD: process.env.STRIPE_STARTER_PRICE_ID_USD || undefined,
    PRO_USD: process.env.STRIPE_PRO_PRICE_ID_USD || undefined,
    ANNUAL_USD: process.env.STRIPE_ANNUAL_PRICE_ID_USD || undefined,
    STARTER_IDR: process.env.STRIPE_STARTER_PRICE_ID_IDR || undefined,
    PRO_IDR: process.env.STRIPE_PRO_PRICE_ID_IDR || undefined,
    ANNUAL_IDR: process.env.STRIPE_ANNUAL_PRICE_ID_IDR || undefined,
  };
}

/**
 * Get the Stripe Price ID for a given plan + currency.
 * Returns undefined when not configured.
 */
export function getStripePriceId(
  planId: PlanId,
  currency: Currency,
): string | undefined {
  const ids = getStripePriceIds();
  const key = `${planId}_${currency}` as keyof StripePriceIds;
  return ids[key];
}

/**
 * Check if Stripe is configured at all (secret key present).
 */
export function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY?.trim());
}
