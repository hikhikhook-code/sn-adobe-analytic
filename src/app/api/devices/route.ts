import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDeviceUsage } from "@/lib/device-limits";

/**
 * GET /api/devices
 *
 * Returns the signed-in user's plan, device limit, and the list of
 * recorded sign-in devices. Backs the /auth/device-limit foundation
 * page plus the settings "Active devices" card.
 *
 * Unauthenticated callers get a 401 — no public shape for this endpoint.
 * PR #16 is foundation only, so we expose `overLimit` but we do NOT
 * actually block sign-ins on it yet; see `deviceLimitForPlan` for the
 * rationale.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const usage = await getDeviceUsage(userId);
  return NextResponse.json(usage);
}
