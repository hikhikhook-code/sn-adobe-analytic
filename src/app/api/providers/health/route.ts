/**
 * GET /api/providers/health — Provider health + cache status (PR #25).
 *
 * Returns the configured/available state of every provider, cache stats,
 * and active provider info. Used by Settings → Data Sources.
 *
 * POST /api/providers/health — Soft-invalidate cache (owner only).
 *
 * Marks all fresh cache entries as stale so the next organic request
 * re-fetches from Adobe Stock. Does NOT trigger any live scrape.
 *
 * Access: GET is available to any signed-in user. POST requires owner
 * role (same gate as other admin-level operations).
 */

import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getProviderHealthReport } from "@/lib/providers/health";
import { getCacheStats, softInvalidateCache } from "@/lib/scraper/cache-management";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  try {
    const report = await getProviderHealthReport(userId);
    const cacheStats = await getCacheStats();

    return NextResponse.json({
      ...report,
      cacheStats,
      signedIn: !!userId,
    });
  } catch (err) {
    console.error("[/api/providers/health] Error:", (err as Error).message);
    return NextResponse.json(
      {
        error: "health_check_failed",
        message: "Could not retrieve provider health status.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", message: "Sign in required." },
      { status: 401 },
    );
  }

  // Only owners can trigger cache refresh. Import the entitlement
  // check lazily to avoid circular deps.
  try {
    const { getSessionEntitlements } = await import(
      "@/lib/entitlements-server"
    );
    const ent = await getSessionEntitlements();
    if (!ent?.entitlements?.isOwner) {
      return NextResponse.json(
        {
          error: "forbidden",
          message: "Cache refresh is restricted to owner accounts.",
        },
        { status: 403 },
      );
    }
  } catch {
    // If entitlements module isn't available, deny by default
    return NextResponse.json(
      { error: "forbidden", message: "Could not verify owner status." },
      { status: 403 },
    );
  }

  try {
    const result = await softInvalidateCache();
    return NextResponse.json({
      success: true,
      message:
        "Cache marked for refresh. Next searches will fetch fresh data.",
      ...result,
    });
  } catch (err) {
    console.error("[/api/providers/health POST]", (err as Error).message);
    return NextResponse.json(
      { error: "refresh_failed", message: "Could not invalidate cache." },
      { status: 500 },
    );
  }
}
