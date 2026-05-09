import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJsonArray } from "@/lib/utils";

const FavoriteSchema = z.object({
  assetId: z.string().min(1),
  thumbnailUrl: z.string().url(),
  title: z.string().min(1).max(300),
  downloads: z.number().int().min(0),
  performanceScore: z.number().int().min(0).max(100),
  contributorName: z.string().optional(),
  keywords: z.array(z.string()).default([]),
});

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ favorites: [] });
  const favorites = await prisma.favorite.findMany({
    where: { userId },
    orderBy: { savedAt: "desc" },
  });
  return NextResponse.json({
    favorites: favorites.map((f) => ({
      id: f.id,
      assetId: f.assetId,
      thumbnailUrl: f.thumbnailUrl,
      title: f.title,
      downloads: f.downloads,
      performanceScore: f.performanceScore,
      contributorName: f.contributorName,
      keywords: parseJsonArray<string>(f.keywordsJson),
      savedAt: f.savedAt,
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
  const parsed = FavoriteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const fav = await prisma.favorite.upsert({
    where: { userId_assetId: { userId, assetId: data.assetId } },
    update: {
      downloads: data.downloads,
      performanceScore: data.performanceScore,
      keywordsJson: JSON.stringify(data.keywords),
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
    },
  });
  return NextResponse.json({ favorite: { id: fav.id, assetId: fav.assetId } });
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
