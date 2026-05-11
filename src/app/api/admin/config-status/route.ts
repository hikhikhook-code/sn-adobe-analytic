/**
 * GET /api/admin/config-status — owner-only deployment config status.
 *
 * Lets an operator confirm, from inside the deployed app, which env
 * vars and feature flags are wired for this deployment. Exposes
 * **booleans / states / categorical values only** — no secret values
 * are ever echoed back. See `src/lib/config-status.ts` for the
 * classification logic.
 *
 * Access control:
 *   - 401 for unauthenticated callers.
 *   - 403 for signed-in non-owner callers (so a customer can't
 *     enumerate env vars or feature flags).
 *   - 200 with the config-status object for signed-in OWNER/ADMIN.
 *
 * This is the safe mirror of the one-line startup log that
 * `src/lib/config-status.ts` emits. Operators who can't easily read
 * Vercel logs (e.g. because logs are retained for a short window and
 * the deploy happened hours ago) can come here instead.
 */

import { NextResponse } from "next/server";
import { getSessionEntitlements } from "@/lib/entitlements-server";
import { getConfigStatus } from "@/lib/config-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSessionEntitlements();

  if (!session.userId) {
    return NextResponse.json(
      {
        error: "unauthenticated",
        message: "Sign in as an owner to view deployment config status.",
      },
      { status: 401 },
    );
  }

  if (!session.entitlements.isOwner) {
    return NextResponse.json(
      {
        error: "forbidden",
        message:
          "Deployment config status is restricted to owner / admin accounts.",
      },
      { status: 403 },
    );
  }

  const status = getConfigStatus();

  return NextResponse.json({
    // Safe mirror of the startup log payload. Booleans only.
    summary: status.summary,
    nodeEnv: status.nodeEnv,
    isBuildPhase: status.isBuildPhase,
    isStrictRuntime: status.isStrictRuntime,
    required: status.required,
    providers: status.providers,
    googleOAuth: status.googleOAuth,
    ownerBootstrap: status.ownerBootstrap,
    payment: status.payment,
    supabaseClient: status.supabaseClient,
    // Small caller-facing reminder. The response itself already
    // carries no secret values, but it's worth saying plainly on
    // every response so a future reviewer doesn't get tempted to add
    // more detail.
    _note:
      "Contains booleans and non-sensitive scalars only. Secret values are never echoed. See docs/PRODUCTION-CHECKLIST.md.",
  });
}
