import { NextResponse } from "next/server";
import { getSessionEntitlements } from "@/lib/entitlements-server";

/**
 * GET /api/user/entitlements
 *
 * Returns the plan-gating facts for the signed-in caller so the UI can
 * render feature-gate chips / pricing card highlights / owner badges
 * without duplicating the plan-tier tables in JS.
 *
 * Privacy posture:
 *   - `isOwner` is a single boolean — the client learns whether THIS
 *     caller bypasses plan gates, and nothing else.
 *   - `role` is the normalized DB role ("USER" / "OWNER" / "ADMIN").
 *     Safe to expose because it's a property of the caller's own row.
 *   - `ownerAccessGrantedAt` / `ownerAccessSource` let the Settings UI
 *     show "Owner since <date>" + "Source: env bootstrap" without a
 *     second round-trip.
 *   - We NEVER echo the `OWNER_EMAILS` list or any other user's email
 *     anywhere in this response. The env var stays server-only.
 */
export async function GET() {
  const s = await getSessionEntitlements();
  return NextResponse.json({
    signedIn: Boolean(s.userId),
    plan: s.plan,
    role: s.role,
    ownerAccessGrantedAt: s.ownerAccessGrantedAt?.toISOString() ?? null,
    ownerAccessSource: s.ownerAccessSource,
    searchesUsedToday: s.searchesUsedToday,
    searchResetAt: s.searchResetAt?.toISOString() ?? null,
    entitlements: s.entitlements,
  });
}
