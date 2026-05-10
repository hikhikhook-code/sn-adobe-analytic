import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assetsToCsv, similarAssetsToCsv } from "@/lib/csv";
import { parseDatasetScope } from "@/lib/dataset-scope";
import { requireEntitlement } from "@/lib/entitlement-gate";
import type { SearchAsset, SimilarAsset } from "@/types/search";

const AssetSchema = z.object({
  id: z.string(),
  title: z.string(),
  downloads: z.number(),
  performanceScore: z.number(),
  downloadsPerMonth: z.number(),
  categories: z.array(z.string()),
  contentType: z.string(),
  uploadDate: z.string(),
  contributorName: z.string(),
  contributorId: z.string(),
  isPremium: z.boolean(),
  isAiGenerated: z.boolean(),
  keywords: z.array(z.string()),
  thumbnailUrl: z.string(),
  adobeStockUrl: z.string(),
  // Optional similarity fields — only set when type === "similar".
  similarityScore: z.number().optional(),
  similarityAvailable: z.boolean().optional(),
  metricsAvailable: z.boolean().optional(),
});

const ScopeSchema = z
  .object({
    kind: z.enum(["all", "specific", "demo"]),
    datasetId: z.string().optional(),
  })
  .optional();

const ExportSchema = z.object({
  type: z
    .enum(["search", "portfolio", "saved", "imported", "similar"])
    .default("search"),
  query: z.string().default(""),
  results: z.array(AssetSchema).min(1).max(2000),
  dataQuality: z
    .enum(["demo", "estimated", "public_metadata", "verified"])
    .default("demo"),
  providerName: z.string().default("Mock data provider"),
  /**
   * The dataset scope the caller was looking at when they exported. Lets
   * the history table show "Dataset: Q3 2025" vs "All imported datasets"
   * vs "Demo data" at a glance — even after the dataset is later archived
   * or renamed. If omitted, we infer `demo_data` so old clients keep
   * working.
   */
  datasetScope: ScopeSchema,
  /**
   * Opaque payload describing the request that produced this export. Stored
   * alongside the history row so the user can re-run "download again" later.
   * Keep small (max 2KB).
   */
  params: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ExportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // PRD §7: CSV export is Starter+ only. Owners bypass. Unauthenticated
  // callers are rejected up front — export-history rows require a user
  // anyway, and we don't ship a guest-export surface.
  const gate = await requireEntitlement("canExportCsv", {
    requireSignedIn: true,
  });
  if (!gate.ok) return gate.response;
  const {
    type,
    query,
    results,
    dataQuality,
    providerName,
    datasetScope: rawScope,
    params,
  } = parsed.data;
  // Similar Image Search exports get an extra Similarity Score column
  // and honor `similarityAvailable: false` so unavailable cells render
  // "Unavailable" instead of fake zeros.
  const csv =
    type === "similar"
      ? similarAssetsToCsv(results as SimilarAsset[])
      : assetsToCsv(results as SearchAsset[]);

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (userId) {
    // Normalize the scope into the string tag we store. Note we don't
    // re-verify dataset ownership here — the export itself already
    // passed through runSearch/runContributor/... whose resolveDatasetScope
    // call enforces ownership. Worst case a rogue body claims
    // "selected_dataset" for a non-owned id; the history row is
    // informational-only, not a capability grant.
    const scope = parseDatasetScope(rawScope);
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
    prisma.exportHistory
      .create({
        data: {
          userId,
          type,
          query,
          rowCount: results.length,
          dataQuality,
          providerName,
          datasetScope: scopeTag,
          datasetId: scopedDatasetId,
          paramsJson: JSON.stringify(params).slice(0, 2_048),
        },
      })
      .catch(() => {});
  }

  const filename = `sn-${type}-${query.replace(/[^a-z0-9]+/gi, "-") || "export"}-${
    new Date().toISOString().slice(0, 10)
  }.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
