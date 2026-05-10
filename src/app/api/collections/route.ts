import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Collections are the user-facing "folder" concept for organizing saved
 * items. Two distinct entity types can live in a collection:
 *   - Favorite (saved individual assets)
 *   - SavedSearch (saved keyword + filter sets)
 *
 * Design choices:
 *   - Name is unique per-user. We compare case-insensitively to avoid
 *     "Travel" / "travel" collisions, but preserve the user's casing for
 *     display.
 *   - Deleting a collection sets `collectionId = null` on its contents
 *     (SetNull in Prisma schema), never cascades — a misclick must not
 *     wipe the saved library.
 *   - GET returns counts so the /saved sidebar doesn't need a second
 *     round-trip to render "Travel (12)".
 */

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(400).optional(),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ collections: [] });

  const rows = await prisma.collection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: {
      _count: {
        select: { favorites: true, searches: true },
      },
    },
  });
  return NextResponse.json({
    collections: rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      favoriteCount: c._count.favorites,
      searchCount: c._count.searches,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
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
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const name = parsed.data.name;
  // Case-insensitive dedupe within the user's scope. Prisma's
  // `mode: "insensitive"` is Postgres-only, so we load the user's
  // collections (small result set) and compare in JS to keep SQLite
  // dev + Postgres prod behaviorally identical. The DB-level unique
  // index is a secondary safety net.
  const userCollections = await prisma.collection.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  const lowered = name.toLowerCase();
  const existing = userCollections.find(
    (c) => c.name.toLowerCase() === lowered,
  );
  if (existing) {
    return NextResponse.json(
      {
        error: "A collection with that name already exists.",
        existingId: existing.id,
      },
      { status: 409 },
    );
  }
  try {
    const c = await prisma.collection.create({
      data: {
        userId,
        name,
        description: parsed.data.description ?? null,
      },
    });
    return NextResponse.json({
      collection: {
        id: c.id,
        name: c.name,
        description: c.description,
        favoriteCount: 0,
        searchCount: 0,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      },
    });
  } catch (e) {
    // The unique index is case-sensitive; if our pre-check missed a race
    // the DB still protects us.
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "A collection with that name already exists." },
        { status: 409 },
      );
    }
    throw e;
  }
}
