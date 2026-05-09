import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/export/history — list the current user's recent exports.
 *
 * Returns at most 100 rows. Sorted newest-first.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ exports: [] });
  }
  const exports = await prisma.exportHistory.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      type: true,
      query: true,
      rowCount: true,
      dataQuality: true,
      providerName: true,
      paramsJson: true,
      createdAt: true,
    },
  });
  return NextResponse.json({
    exports: exports.map((e) => ({
      id: e.id,
      type: e.type,
      query: e.query,
      rowCount: e.rowCount,
      dataQuality: e.dataQuality,
      providerName: e.providerName,
      createdAt: e.createdAt,
      // Don't echo paramsJson back unless the UI needs it. Currently no
      // re-run path uses params, so keep them server-side only.
    })),
  });
}
