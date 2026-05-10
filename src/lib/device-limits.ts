import { prisma } from "@/lib/prisma";

/**
 * PRD plan → device limit mapping.
 *
 * These are the PRD-specified limits. PR #16 ships them as a FOUNDATION
 * only: we log every sign-in against the Device model and expose the
 * count + limit on `/auth/device-limit` and `/api/devices`, but we do
 * NOT hard-block sign-ins when the user is over the limit yet. Blocking
 * will land in a later PR once the enforcement path has a proper
 * "sign out other device" UX attached to it — shipping a hard block
 * without that UX would let a user accidentally lock themselves out.
 */
export type PlanTier = "FREE" | "STARTER" | "PRO" | "ANNUAL";

export const DEVICE_LIMITS: Readonly<Record<PlanTier, number>> = {
  FREE: 1,
  STARTER: 1,
  PRO: 3,
  ANNUAL: 5,
};

/**
 * Look up the limit for any string plan value. Unknown plans fall back
 * to the most restrictive tier so a typo in the `User.plan` column never
 * silently grants unlimited devices.
 */
export function deviceLimitForPlan(plan: string | null | undefined): number {
  if (!plan) return DEVICE_LIMITS.FREE;
  const key = plan.toUpperCase() as PlanTier;
  return DEVICE_LIMITS[key] ?? DEVICE_LIMITS.FREE;
}

export interface DeviceSummary {
  id: string;
  deviceName: string;
  deviceId: string;
  userAgent: string | null;
  ipHint: string | null;
  lastActive: string;
  firstSeen: string;
  isActive: boolean;
}

export interface DeviceUsage {
  plan: PlanTier | string;
  limit: number;
  activeCount: number;
  overLimit: boolean;
  devices: DeviceSummary[];
}

/**
 * Fetch every active device row for a user + the plan-derived limit, in
 * the shape the `/auth/device-limit` page and the settings card consume.
 *
 * We load ALL rows for the user — including the soft-revoked ones —
 * because the UI surfaces "previously signed-in device" history, but
 * only the `isActive=true` rows count against the plan limit.
 */
export async function getDeviceUsage(userId: string): Promise<DeviceUsage> {
  const [user, devices] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { plan: true },
    }),
    prisma.device.findMany({
      where: { userId },
      orderBy: { lastActive: "desc" },
    }),
  ]);

  const plan = (user?.plan ?? "FREE") as PlanTier;
  const limit = deviceLimitForPlan(plan);
  const activeCount = devices.filter((d) => d.isActive).length;

  return {
    plan,
    limit,
    activeCount,
    overLimit: activeCount > limit,
    devices: devices.map((d) => ({
      id: d.id,
      deviceName: d.deviceName,
      deviceId: d.deviceId,
      userAgent: d.userAgent ?? null,
      ipHint: d.ipHint ?? null,
      lastActive: d.lastActive.toISOString(),
      firstSeen: d.firstSeen.toISOString(),
      isActive: d.isActive,
    })),
  };
}

/**
 * Best-effort user-agent → friendly label. Kept intentionally simple —
 * we show the full UA string in a title attribute on the device card,
 * this just extracts a reasonable summary for the row header.
 */
export function prettyDeviceName(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const s = ua.toLowerCase();
  let os = "Unknown OS";
  if (s.includes("windows")) os = "Windows";
  else if (s.includes("mac os") || s.includes("macintosh")) os = "macOS";
  else if (s.includes("iphone") || s.includes("ios")) os = "iOS";
  else if (s.includes("android")) os = "Android";
  else if (s.includes("linux")) os = "Linux";
  let browser = "Browser";
  if (s.includes("edg/")) browser = "Edge";
  else if (s.includes("chrome/") && !s.includes("edg/")) browser = "Chrome";
  else if (s.includes("firefox/")) browser = "Firefox";
  else if (s.includes("safari/") && !s.includes("chrome/")) browser = "Safari";
  return `${browser} on ${os}`;
}
