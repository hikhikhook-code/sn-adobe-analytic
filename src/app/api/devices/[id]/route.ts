import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE /api/devices/:id
 *
 * Soft-revoke a device row for the signed-in user. We set `isActive=false`
 * rather than hard-deleting so the device list keeps an honest audit
 * trail of previously signed-in devices.
 *
 * Future-safe: once the enforcement PR lands, this endpoint will be the
 * trigger point for actually invalidating any sessions that were
 * issued to the revoked device.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = params.id;
  if (!id) {
    return NextResponse.json(
      { error: "Missing device id" },
      { status: 400 },
    );
  }

  // Only update rows the session user owns — no cross-user revokes.
  const result = await prisma.device.updateMany({
    where: { id, userId },
    data: { isActive: false },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
