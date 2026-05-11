/**
 * POST /api/billing/webhook — Stripe Webhook Handler (PR #26).
 *
 * Receives Stripe webhook events, verifies the signature, and updates
 * the user's plan in the database upon successful checkout/subscription.
 *
 * Hard rules:
 *   - Always verifies the webhook signature (STRIPE_WEBHOOK_SECRET).
 *   - Never trusts client-side redirects for plan upgrades.
 *   - Owner/admin roles are never overwritten by billing events.
 *   - Invalid signatures return 400 immediately.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { PlanId } from "@/lib/pricing";

// Next.js App Router: disable body parsing for webhooks (we need raw body)
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Normalize a Stripe plan ID from metadata to our internal PlanId.
 */
function normalizePlanId(raw: string | undefined | null): PlanId | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "STARTER" || upper === "PRO" || upper === "ANNUAL") {
    return upper as PlanId;
  }
  return null;
}

export async function POST(req: Request) {
  // 1. Check webhook secret is configured
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    console.error("[billing/webhook] STRIPE_WEBHOOK_SECRET is not configured.");
    return NextResponse.json(
      { error: "webhook_not_configured" },
      { status: 500 },
    );
  }

  // 2. Read raw body for signature verification
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "missing_signature", message: "No stripe-signature header." },
      { status: 400 },
    );
  }

  // 3. Verify signature and parse event
  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2024-04-10" as unknown as "2025-04-30.basil",
    });
    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    ) as unknown as typeof event;
  } catch (err) {
    console.error(
      "[billing/webhook] Signature verification failed:",
      (err as Error).message,
    );
    return NextResponse.json(
      { error: "invalid_signature", message: "Webhook signature invalid." },
      { status: 400 },
    );
  }

  // 4. Handle relevant events
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as {
          client_reference_id?: string;
          metadata?: Record<string, string>;
          subscription?: string;
          customer?: string;
        };

        const userId =
          session.client_reference_id ?? session.metadata?.userId;
        const planId = normalizePlanId(session.metadata?.planId);

        if (!userId || !planId) {
          console.warn(
            "[billing/webhook] checkout.session.completed missing userId or planId in metadata.",
          );
          break;
        }

        // Update user plan — but NEVER downgrade an OWNER/ADMIN role
        await prisma.user.updateMany({
          where: {
            id: userId,
            // Only update if user is currently a regular USER.
            // Owners and admins keep their elevated access regardless.
            role: "USER",
          },
          data: { plan: planId },
        });

        console.log(
          `[billing/webhook] Plan updated: user=${userId} plan=${planId}`,
        );
        break;
      }

      case "customer.subscription.updated": {
        // Handle plan changes (upgrade/downgrade via Stripe portal)
        const subscription = event.data.object as {
          metadata?: Record<string, string>;
          status?: string;
        };

        const userId = subscription.metadata?.userId;
        const planId = normalizePlanId(subscription.metadata?.planId);

        if (userId && planId && subscription.status === "active") {
          await prisma.user.updateMany({
            where: { id: userId, role: "USER" },
            data: { plan: planId },
          });
          console.log(
            `[billing/webhook] Subscription updated: user=${userId} plan=${planId}`,
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        // Downgrade to FREE when subscription is canceled
        const subscription = event.data.object as {
          metadata?: Record<string, string>;
        };
        const userId = subscription.metadata?.userId;

        if (userId) {
          await prisma.user.updateMany({
            where: { id: userId, role: "USER" },
            data: { plan: "FREE" },
          });
          console.log(
            `[billing/webhook] Subscription canceled: user=${userId} downgraded to FREE`,
          );
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error(
      "[billing/webhook] Error processing event:",
      (err as Error).message,
    );
    // Return 200 so Stripe doesn't retry (we logged the error)
  }

  // Always return 200 to acknowledge receipt
  return NextResponse.json({ received: true });
}
