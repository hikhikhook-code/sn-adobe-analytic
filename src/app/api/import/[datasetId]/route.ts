import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface Params {
  params: { datasetId: string };
}

/**
 * DELETE /api/import/:datasetId — soft-delete (archive) a dataset.
 *
 * The row stays in the DB so we don't lose the user's data on a fat-finger,
 * but `manualImportProvider` ignores archived datasets.
 */
export async function DELETE(_req: Request, { params }: Params) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  const dataset = await prisma.importedDataset.findUnique({
    where: { id: params.datasetId },
    select: { userId: true },
  });
  if (!dataset || dataset.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  await prisma.importedDataset.update({
    where: { id: params.datasetId },
    data: { archived: true },
  });
  return NextResponse.json({ ok: true });
}
