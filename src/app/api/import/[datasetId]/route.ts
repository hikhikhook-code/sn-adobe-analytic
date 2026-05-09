import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface Params {
  params: { datasetId: string };
}

/**
 * Shared ownership lookup. Returns the dataset row if it belongs to the
 * current signed-in user, otherwise null. Callers should short-circuit
 * with a 404 on null — we intentionally do NOT leak a 403 here because
 * distinguishing "not yours" from "doesn't exist" would reveal that a
 * dataset with that id exists under another account.
 */
async function loadOwnedDataset(datasetId: string, userId: string) {
  return prisma.importedDataset.findFirst({
    where: { id: datasetId, userId },
    select: {
      id: true,
      name: true,
      archived: true,
      userId: true,
    },
  });
}

const RenameSchema = z.object({
  name: z.string().min(1).max(120),
});

/**
 * PATCH /api/import/:datasetId — rename the dataset. Currently the only
 * mutable field. (Archived state transitions happen via DELETE.)
 */
export async function PATCH(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  const existing = await loadOwnedDataset(params.datasetId, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RenameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Please give this dataset a name between 1 and 120 characters.",
        issues: parsed.error.issues,
        code: "invalid_dataset_name",
      },
      { status: 400 },
    );
  }
  const updated = await prisma.importedDataset.update({
    where: { id: existing.id },
    data: { name: parsed.data.name.trim() },
    select: { id: true, name: true, updatedAt: true },
  });
  return NextResponse.json({ dataset: updated });
}

/**
 * DELETE /api/import/:datasetId — two behaviors, switched by query:
 *
 *   DELETE /api/import/<id>           → soft-delete (archive = true).
 *                                       Rows stay in the DB for recovery
 *                                       but `manualImportProvider` ignores
 *                                       archived datasets.
 *   DELETE /api/import/<id>?hard=true → hard-delete. Permanently drops the
 *                                       dataset row AND all its
 *                                       `ImportedAsset` rows (cascade).
 *                                       Irreversible. Used when the user
 *                                       clicks Delete (not Archive) in the
 *                                       management table.
 *
 * In both cases, if this dataset is the user's currently active one we
 * clear `User.activeDatasetId` so they don't get stuck pointing at
 * something that isn't visible anymore.
 */
export async function DELETE(req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  const existing = await loadOwnedDataset(params.datasetId, session.user.id);
  if (!existing) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const url = new URL(req.url);
  const hard = url.searchParams.get("hard") === "true";

  if (hard) {
    // Cascade from the schema will remove ImportedAsset rows. We issue
    // both operations in one transaction so the active-dataset pointer
    // is never stale for a request-quantum.
    await prisma.$transaction([
      prisma.importedDataset.delete({ where: { id: existing.id } }),
      prisma.user.updateMany({
        where: { id: session.user.id, activeDatasetId: existing.id },
        data: { activeDatasetId: null },
      }),
    ]);
    return NextResponse.json({ ok: true, deleted: "hard" });
  }

  await prisma.$transaction([
    prisma.importedDataset.update({
      where: { id: existing.id },
      data: { archived: true },
    }),
    // If this dataset was the user's active selection, reset to "all"
    // so their next request lands somewhere coherent.
    prisma.user.updateMany({
      where: { id: session.user.id, activeDatasetId: existing.id },
      data: { activeDatasetId: null },
    }),
  ]);
  return NextResponse.json({ ok: true, deleted: "archived" });
}
