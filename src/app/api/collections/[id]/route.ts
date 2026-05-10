import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Per-collection operations. PATCH is used to rename / edit description;
 * DELETE removes the collection and falls its contents back to
 * "Uncategorized" via the schema's `onDelete: SetNull` on the Favorite
 * and SavedSearch relations.
 *
 * Ownership is re-verified on every mutation so a rogue URL can't touch
 * another user's folders.
 */

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(400).nullable().optional(),
  })
  .refine(
    (v) => v.name !== undefined || v.description !== undefined,
    "Provide at least one field to update.",
  );

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const collection = await prisma.collection.findFirst({
    where: { id: params.id, userId },
  });
  if (!collection) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, description } = parsed.data;
  if (name && name.toLowerCase() !== collection.name.toLowerCase()) {
    // Case-insensitive clash check done in JS (SQLite compat — Prisma's
    // `mode: "insensitive"` is Postgres-only). The DB unique index
    // still backstops a true race.
    const siblings = await prisma.collection.findMany({
      where: { userId, id: { not: collection.id } },
      select: { id: true, name: true },
    });
    const lowered = name.toLowerCase();
    const clash = siblings.find((s) => s.name.toLowerCase() === lowered);
    if (clash) {
      return NextResponse.json(
        { error: "A collection with that name already exists." },
        { status: 409 },
      );
    }
  }
  try {
    const updated = await prisma.collection.update({
      where: { id: collection.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(description !== undefined ? { description } : {}),
      },
    });
    return NextResponse.json({
      collection: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (e) {
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

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const collection = await prisma.collection.findFirst({
    where: { id: params.id, userId },
    select: { id: true },
  });
  if (!collection) {
    // Idempotent — "nothing to delete" is success from the client's POV.
    return NextResponse.json({ ok: true });
  }
  // Favorite.collectionId and SavedSearch.collectionId are SetNull on
  // delete, so the contents fall back to "Uncategorized" automatically.
  await prisma.collection.delete({ where: { id: collection.id } });
  return NextResponse.json({ ok: true });
}
