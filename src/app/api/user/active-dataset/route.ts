import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  DEMO_SENTINEL,
  resolveDatasetScope,
} from "@/lib/dataset-scope";

/**
 * GET /api/user/active-dataset — return the current user's dataset
 * selection. Anonymous callers get a demo scope.
 *
 * The payload is what the DatasetSelector dropdown needs to render:
 *   - current scope (for the active state)
 *   - optional current datasetName (so the trigger can show the pretty name)
 *   - list of the user's non-archived datasets (so the dropdown can
 *     populate without a second fetch)
 *   - flags for whether to show the "All datasets" / "Demo data" items
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const info = await resolveDatasetScope(userId);

  let datasets: { id: string; name: string; rowCount: number }[] = [];
  if (userId) {
    datasets = await prisma.importedDataset.findMany({
      where: { userId, archived: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, rowCount: true },
    });
  }

  return NextResponse.json({
    signedIn: !!userId,
    scope: info.scope,
    reason: info.reason,
    datasetName: info.datasetName ?? null,
    hasAnyDatasets: info.hasAnyDatasets,
    datasets,
  });
}

const PutSchema = z.object({
  /**
   * Required. One of:
   *   - "all"          → aggregate across every non-archived dataset (stored
   *                      as NULL in the DB)
   *   - "demo"         → explicit demo (stored as DEMO_SENTINEL)
   *   - "specific"     → requires `datasetId`
   */
  kind: z.enum(["all", "demo", "specific"]),
  datasetId: z.string().optional(),
});

/**
 * PUT /api/user/active-dataset — persist the user's dataset selection.
 *
 * User-isolation guardrail: a `specific` pick is rejected (404) if the
 * dataset doesn't belong to the caller or is archived. That's enforced
 * against the DB, not just trusted from the request body.
 */
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "You must be signed in to change the active dataset." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { kind, datasetId } = parsed.data;

  let toStore: string | null;
  if (kind === "all") {
    toStore = null;
  } else if (kind === "demo") {
    toStore = DEMO_SENTINEL;
  } else {
    if (!datasetId) {
      return NextResponse.json(
        {
          error:
            "datasetId is required when kind is 'specific'.",
          code: "missing_dataset_id",
        },
        { status: 400 },
      );
    }
    // Verify ownership + not archived before trusting the id.
    const ds = await prisma.importedDataset.findFirst({
      where: { id: datasetId, userId, archived: false },
      select: { id: true },
    });
    if (!ds) {
      return NextResponse.json(
        {
          error:
            "That dataset is not available. It may have been archived, deleted, or belongs to a different account.",
          code: "dataset_not_found",
        },
        { status: 404 },
      );
    }
    toStore = ds.id;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { activeDatasetId: toStore },
  });

  // Echo back the fully resolved info so the client can update its local
  // state without a second GET.
  const info = await resolveDatasetScope(userId);
  return NextResponse.json({
    scope: info.scope,
    reason: info.reason,
    datasetName: info.datasetName ?? null,
    hasAnyDatasets: info.hasAnyDatasets,
  });
}
