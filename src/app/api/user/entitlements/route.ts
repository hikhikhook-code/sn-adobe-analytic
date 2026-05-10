import { NextResponse } from "next/server";
import { getSessionEntitlements } from "@/lib/entitlements-server";

/**
 * GET /api/user/entitlements
 *
 * Returns the plan-gating facts for the signed-in caller so the UI can
 * render feature-gate chips / pricing card highlights / owner badges
 * without duplicating the plan-tier tables in JS.
 *
 * Privacy posture: we expose the single `isOwner: true/false` flag and
 * `planLabel` (e.g. `"Owner access"` vs `"Pro"`), but we never echo the
 * `OWNER_EMAILS` list itself. The client can tell whether THIS caller
 * is an owner; it cannot enumerate who else is.
 */
export async function GET() {
  const s = await getSessionEntitlements();
  return NextResponse.json({
    signedIn: Boolean(s.userId),
    plan: s.plan,
    searchesUsedToday: s.searchesUsedToday,
    searchResetAt: s.searchResetAt?.toISOString() ?? null,
    entitlements: s.entitlements,
  });
}
