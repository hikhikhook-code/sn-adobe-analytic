/**
 * POST /api/billing/checkout — Create a Stripe Checkout Session (PR #26).
 *
 * Accepts { planId, currency } and redirects the user to Stripe's hosted
 * checkout page. The Price ID used is determined by the plan × currency
 * combination configured in env vars.
 *
 * Hard rules:
 *   - Never fakes payment success.
 *   - Never upgrades the plan from this route (that's the webhook's job).
 *   - Returns a clean error when Stripe is not configured or the Price ID
 *     for the requested currency is missing.
 *   - Owner/admin access is unaffected by billing flows.
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getStripePriceId,
  isStripeConfigured,
  PLANS,
  type Currency,
  type PlanId,
} from "@/lib/pricing";

const VALID_PLANS: PlanId[] = ["STARTER", "PRO", "ANNUAL"];
const VALID_CURRENCIES: Currency[] = ["USD", "IDR"];

export async function POST(req: Request) {
  // 1. Auth check
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in required to start checkout." },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: { planId?: string; currency?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Invalid request body." },
      { status: 400 },
    );
  }

  const planId = (body.planId ?? "").toUpperCase() as PlanId;
  const currency = (body.currency ?? "USD").toUpperCase() as Currency;

  // 3. Validate plan
  if (!VALID_PLANS.includes(planId)) {
    return NextResponse.json(
      {
        error: "invalid_plan",
        message: `Invalid plan. Choose one of: ${VALID_PLANS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // 4. Validate currency
  if (!VALID_CURRENCIES.includes(currency)) {
    return NextResponse.json(
      {
        error: "invalid_currency",
        message: `Invalid currency. Supported: ${VALID_CURRENCIES.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // 5. Check Stripe is configured
  if (!isStripeConfigured()) {
    return NextResponse.json(
      {
        error: "stripe_not_configured",
        message:
          "Payment processing is not configured. Set STRIPE_SECRET_KEY in the environment.",
      },
      { status: 503 },
    );
  }

  // 6. Resolve Price ID for plan × currency
  const priceId = getStripePriceId(planId, currency);
  if (!priceId) {
    const currencyLabel = currency === "IDR" ? "IDR" : "USD";
    return NextResponse.json(
      {
        error: "price_not_configured",
        message: `${currencyLabel} checkout is not configured yet for the ${PLANS[planId].label} plan. Contact the operator.`,
        plan: planId,
        currency,
      },
      { status: 503 },
    );
  }

  // 7. Create Stripe Checkout Session
  try {
    // Dynamic import so the app doesn't crash when stripe isn't installed
    // in a minimal dev setup.
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2025-02-24.acacia",
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: session.user.email,
      client_reference_id: session.user.id,
      metadata: {
        userId: session.user.id,
        planId,
        currency,
      },
      success_url: `${baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/billing/cancel`,
    });

    return NextResponse.json({
      url: checkoutSession.url,
      sessionId: checkoutSession.id,
    });
  } catch (err) {
    console.error("[/api/billing/checkout] Stripe error:", (err as Error).message);
    return NextResponse.json(
      {
        error: "checkout_failed",
        message: "Could not create checkout session. Please try again later.",
      },
      { status: 500 },
    );
  }
}
