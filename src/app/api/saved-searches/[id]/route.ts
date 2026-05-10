import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Per-saved-search operations. PATCH supports renaming, moving between
 * collections, and editing notes. DELETE is idempotent.
 *
 * We don't allow PATCHing the underlying keyword / filters on purpose —
 * saved searches are an explicit user intent, and editing the filters
 * after save would silently change what the user actually pinned. They
 * can delete + re-save to change the query.
 */

const UpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).nullable().optional(),
    collectionId: z.string().nullable().optional(),
    notes: z.string().max(2_000).nullable().optional(),
  })
  .refine(
    (v) => Object.keys(v).length > 0,
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
  const saved = await prisma.savedSearch.findFirst({
    where: { id: params.id, userId },
  });
  if (!saved) {
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
  const { name, collectionId, notes } = parsed.data;
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
  const updated = await prisma.savedSearch.update({
    where: { id: saved.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(collectionId !== undefined ? { collectionId } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
  });
  return NextResponse.json({
    savedSearch: {
      id: updated.id,
      name: updated.name,
      collectionId: updated.collectionId,
      notes: updated.notes,
      updatedAt: updated.updatedAt,
    },
  });
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
  await prisma.savedSearch
    .deleteMany({ where: { id: params.id, userId } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
