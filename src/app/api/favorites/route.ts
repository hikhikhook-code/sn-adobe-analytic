import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJsonArray } from "@/lib/utils";

/**
 * Favorites (saved individual assets).
 *
 * PR #15 adds three new capabilities on top of the PR #1-era shape:
 *
 *   1. Snapshot semantics. The `downloads` and `performanceScore` columns
 *      are now explicitly the SAVED-AT SNAPSHOT — we never overwrite them
 *      after the first save. A subsequent save-again call is a no-op on
 *      the snapshot, so the UI can diff against it to compute deltas.
 *
 *   2. Collection + notes. `collectionId` is the user's folder
 *      assignment (SetNull on collection delete), and `notes` is a
 *      short free-text memo. Both are editable via PATCH.
 *
 *   3. Track-changes telemetry. `lastChecked*` columns are populated
 *      by `/api/saved/track`, not here. The GET endpoint surfaces them
 *      so the client can render the delta card without a second call.
 */

const FavoriteSchema = z.object({
  assetId: z.string().min(1),
  thumbnailUrl: z.string().url(),
  title: z.string().min(1).max(300),
  downloads: z.number().int().min(0),
  performanceScore: z.number().int().min(0).max(100),
  contributorName: z.string().optional(),
  keywords: z.array(z.string()).default([]),
  // Optional folder assignment at save time.
  collectionId: z.string().optional(),
  notes: z.string().max(2_000).optional(),
});

const PatchSchema = z
  .object({
    assetId: z.string().min(1),
    collectionId: z.string().nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
  })
  .refine(
    (v) => v.collectionId !== undefined || v.notes !== undefined,
    "Provide at least one field to update.",
  );

/**
 * Convert a row into the JSON shape the UI consumes. Centralized so the
 * GET list and the POST/PATCH single-row responses stay in lockstep.
 */
function serialize(
  f: Awaited<ReturnType<typeof prisma.favorite.findFirst>>,
): Record<string, unknown> | null {
  if (!f) return null;
  return {
    id: f.id,
    assetId: f.assetId,
    thumbnailUrl: f.thumbnailUrl,
    title: f.title,
    downloads: f.downloads,
    performanceScore: f.performanceScore,
    contributorName: f.contributorName,
    keywords: parseJsonArray<string>(f.keywordsJson),
    savedAt: f.savedAt,
    collectionId: f.collectionId,
    notes: f.notes,
    // Track-changes snapshot. `null` on every field means the user hasn't
    // run a refresh yet — the UI renders "Not yet checked" rather than
    // a zero delta.
    lastCheckedAt: f.lastCheckedAt,
    lastCheckedDownloads: f.lastCheckedDownloads,
    lastCheckedPerformanceScore: f.lastCheckedPerformanceScore,
    lastCheckedDataQuality: f.lastCheckedDataQuality,
    lastCheckedProviderId: f.lastCheckedProviderId,
  };
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ favorites: [] });

  const { searchParams } = new URL(req.url);
  const collectionId = searchParams.get("collectionId");

  const where: { userId: string; collectionId?: string | null } = { userId };
  if (collectionId === "uncategorized") {
    where.collectionId = null;
  } else if (collectionId) {
    where.collectionId = collectionId;
  }

  const favorites = await prisma.favorite.findMany({
    where,
    orderBy: { savedAt: "desc" },
  });
  return NextResponse.json({
    favorites: favorites.map((f) => serialize(f)),
  });
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = FavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;

  // Verify collection ownership if a folder was provided.
  if (data.collectionId) {
    const owned = await prisma.collection.findFirst({
      where: { id: data.collectionId, userId },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 400 },
      );
    }
  }

  // On re-save of an existing asset: preserve the original snapshot
  // (downloads / performanceScore / savedAt) so the delta card keeps its
  // original baseline. Only allow updating the mutable fields
  // (keywords we've learned since, folder assignment, notes).
  const fav = await prisma.favorite.upsert({
    where: { userId_assetId: { userId, assetId: data.assetId } },
    update: {
      keywordsJson: JSON.stringify(data.keywords),
      ...(data.collectionId !== undefined
        ? { collectionId: data.collectionId }
        : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
    },
    create: {
      userId,
      assetId: data.assetId,
      thumbnailUrl: data.thumbnailUrl,
      title: data.title,
      downloads: data.downloads,
      performanceScore: data.performanceScore,
      contributorName: data.contributorName,
      keywordsJson: JSON.stringify(data.keywords),
      collectionId: data.collectionId ?? null,
      notes: data.notes ?? null,
    },
  });
  return NextResponse.json({ favorite: serialize(fav) });
}

export async function PATCH(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { assetId, collectionId, notes } = parsed.data;
  const existing = await prisma.favorite.findUnique({
    where: { userId_assetId: { userId, assetId } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (collectionId) {
    const owned = await prisma.collection.findFirst({
      where: { id: collectionId, userId },
      select: { id: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 400 },
      );
    }
  }
  const updated = await prisma.favorite.update({
    where: { id: existing.id },
    data: {
      ...(collectionId !== undefined ? { collectionId } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
  });
  return NextResponse.json({ favorite: serialize(updated) });
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const assetId = searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "Missing assetId" }, { status: 400 });
  }
  await prisma.favorite
    .delete({ where: { userId_assetId: { userId, assetId } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
