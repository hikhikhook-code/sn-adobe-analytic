import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDatasetScope } from "@/lib/dataset-scope";

/**
 * Saved searches — the user pins a keyword + filter set so they can
 * quickly re-run it later.
 *
 * Distinct from `SearchHistory`, which is a transient auto-log of every
 * query. A SavedSearch is an explicit user intent.
 *
 * We snapshot the provider + data-quality + dataset scope at save time so
 * the UI can show an honest "saved from <source>" label even if the user
 * later switches their active provider or archives the dataset.
 */

const ScopeSchema = z
  .object({
    kind: z.enum(["all", "specific", "demo"]),
    datasetId: z.string().optional(),
  })
  .optional();

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  keyword: z.string().trim().min(1).max(200),
  sort: z
    .enum(["relevance", "newest", "featured", "most_downloaded", "undiscovered"])
    .default("relevance"),
  contentType: z
    .enum(["all", "photo", "illustration", "vector", "video", "template", "3d"])
    .default("all"),
  aiFilter: z.enum(["all", "ai_only", "exclude_ai"]).default("all"),
  resultCount: z.number().int().min(0).nullable().optional(),
  dataQuality: z
    .enum(["demo", "estimated", "public_metadata", "verified"])
    .default("demo"),
  providerName: z.string().max(120).default("Mock data provider"),
  providerId: z.string().max(40).optional(),
  datasetScope: ScopeSchema,
  collectionId: z.string().optional(),
  notes: z.string().max(2_000).optional(),
});

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ savedSearches: [] });

  const { searchParams } = new URL(req.url);
  const collectionId = searchParams.get("collectionId");

  // Build a narrow `where` inline so we don't fight Prisma's generic
  // typing just to support the two scopes we actually need.
  const where: { userId: string; collectionId?: string | null } = { userId };
  if (collectionId === "uncategorized") {
    where.collectionId = null;
  } else if (collectionId) {
    where.collectionId = collectionId;
  }

  const rows = await prisma.savedSearch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return NextResponse.json({
    savedSearches: rows.map((s) => ({
      id: s.id,
      name: s.name,
      keyword: s.keyword,
      sort: s.sort,
      contentType: s.contentType,
      aiFilter: s.aiFilter,
      resultCount: s.resultCount,
      dataQuality: s.dataQuality,
      providerName: s.providerName,
      providerId: s.providerId,
      datasetScope: s.datasetScope,
      datasetId: s.datasetId,
      collectionId: s.collectionId,
      notes: s.notes,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
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
  const data = parsed.data;

  // Verify collection ownership if provided.
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

  // Normalize dataset scope into the string tag we persist. Matches the
  // ExportHistory.datasetScope convention so the UI badges are shared.
  const scope = parseDatasetScope(data.datasetScope);
  let scopeTag: "all_datasets" | "selected_dataset" | "demo_data";
  let scopedDatasetId: string | null = null;
  if (scope?.kind === "specific") {
    scopeTag = "selected_dataset";
    scopedDatasetId = scope.datasetId;
  } else if (scope?.kind === "all") {
    scopeTag = "all_datasets";
  } else {
    scopeTag = "demo_data";
  }

  const created = await prisma.savedSearch.create({
    data: {
      userId,
      name: data.name ?? null,
      keyword: data.keyword,
      sort: data.sort,
      contentType: data.contentType,
      aiFilter: data.aiFilter,
      resultCount: data.resultCount ?? null,
      dataQuality: data.dataQuality,
      providerName: data.providerName,
      providerId: data.providerId ?? null,
      datasetScope: scopeTag,
      datasetId: scopedDatasetId,
      collectionId: data.collectionId ?? null,
      notes: data.notes ?? null,
    },
  });

  return NextResponse.json({
    savedSearch: {
      id: created.id,
      name: created.name,
      keyword: created.keyword,
      sort: created.sort,
      contentType: created.contentType,
      aiFilter: created.aiFilter,
      resultCount: created.resultCount,
      dataQuality: created.dataQuality,
      providerName: created.providerName,
      providerId: created.providerId,
      datasetScope: created.datasetScope,
      datasetId: created.datasetId,
      collectionId: created.collectionId,
      notes: created.notes,
      createdAt: created.createdAt,
    },
  });
}
