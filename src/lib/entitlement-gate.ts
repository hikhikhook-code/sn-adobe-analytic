import { NextResponse } from "next/server";
import {
  FEATURE_DENIAL_REASONS,
  type Entitlements,
  type FeatureKey,
} from "@/lib/entitlements";
import { getSessionEntitlements } from "@/lib/entitlements-server";

/**
 * Server-side feature-gate helper.
 *
 * Wraps the common pattern:
 *
 *   const gate = await requireEntitlement("canExportCsv");
 *   if (!gate.ok) return gate.response;
 *   const userId = gate.userId;   // may still be null for guest-allowed gates
 *   const plan   = gate.entitlements;
 *
 * Owners auto-pass every gate (they always have every capability true).
 *
 * ## Guest policy
 *   - `requireSignedIn: true` (default false) forces a 401 for anonymous
 *     callers. Most feature-gated endpoints want this because the free-
 *     tier demo surface is served by the page routes, not the API.
 *
 * ## Rationale for a unified shape
 * Returning `{ ok: false, response }` keeps the call site to two lines
 * and guarantees every gated endpoint emits a structurally consistent
 * 401 / 402 / 403 payload (same `error`, `message`, `plan` keys). The
 * UI can then switch on `error` without sniffing HTTP status codes.
 */
export interface GateAllowed {
  ok: true;
  userId: string | null;
  email: string | null;
  plan: string | null;
  entitlements: Entitlements;
}

export interface GateDenied {
  ok: false;
  response: NextResponse;
}

export type GateResult = GateAllowed | GateDenied;

export interface RequireOptions {
  requireSignedIn?: boolean;
}

export async function requireEntitlement(
  feature: FeatureKey,
  opts: RequireOptions = {},
): Promise<GateResult> {
  const sessionCtx = await getSessionEntitlements();
  const { entitlements, userId } = sessionCtx;

  if (opts.requireSignedIn && !userId) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "unauthorized",
          message: "Sign in to use this feature.",
        },
        { status: 401 },
      ),
    };
  }

  if (!entitlements[feature]) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "plan_gate",
          feature,
          plan: entitlements.plan,
          isOwner: entitlements.isOwner,
          message: FEATURE_DENIAL_REASONS[feature],
        },
        { status: 402 },
      ),
    };
  }

  return {
    ok: true,
    userId,
    email: sessionCtx.email,
    plan: sessionCtx.plan,
    entitlements,
  };
}
