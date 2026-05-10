import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { heatmapToCsv } from "@/lib/csv";
import { parseDatasetScope } from "@/lib/dataset-scope";
import type { ProviderHeatmapResult } from "@/lib/providers/types";

/**
 * POST /api/heatmap/export
 *
 * Body shape mirrors `/api/portfolio/export` so the client side has a
 * consistent surface across export targets:
 *
 *   {
 *     mode: "list" | "detail",
 *     // The full provider response the user is currently looking at.
 *     // Re-using the response keeps the CSV honest \u2014 we export exactly
 *     // what the user sees, including the same data-quality badge,
 *     // applied filters, and "Unavailable" cells.
 *     data: ProviderHeatmapResult,
 *     query: string,         // free-text label for the export history row
 *     datasetScope?: { kind: "all" | "specific" | "demo", datasetId?: string },
 *     params?: Record<string, unknown>,  // raw filters etc, for "download again"
 *   }
 *
 * Records an `ExportHistory` row with `type = "heatmap"`. The dataset-
 * scope tag captured at export time matches the convention used by
 * `/api/export` and `/api/portfolio/export`.
 */
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
  metricsAvailable: z.boolean().optional(),
});

const TileSchema = z.object({
  keyword: z.string(),
  downloads: z.number(),
  assets: z.number(),
  competition: z.number(),
  trend: z.enum(["up", "down", "stable"]),
  opportunityScore: z.number(),
  avgPerformanceScore: z.number(),
  contentTypeBreakdown: z.array(
    z.object({ contentType: z.string(), count: z.number() }),
  ),
  relatedKeywords: z.array(z.string()),
  topAssets: z.array(AssetSchema),
  metricsAvailable: z.boolean(),
  trendAvailable: z.boolean(),
});

const FiltersSchema = z
  .object({
    contentType: z.string().optional(),
    period: z.string().optional(),
    minDownloads: z.number().optional(),
    sort: z.string().optional(),
    niche: z.string().optional(),
  })
  .partial();

const ResultSchema = z.object({
  niches: z.array(TileSchema),
  appliedFilters: FiltersSchema,
  detail: z.boolean().optional(),
  dataQuality: z.enum(["demo", "estimated", "public_metadata", "verified"]),
  providerName: z.string(),
  providerId: z.string().optional(),
  capabilities: z
    .object({
      search: z.enum(["supported", "partial", "unsupported"]),
      contributor: z.enum(["supported", "partial", "unsupported"]),
      heatmap: z.enum(["supported", "partial", "unsupported"]),
      trending: z.enum(["supported", "partial", "unsupported"]),
      similarImage: z.enum(["supported", "partial", "unsupported"]),
      dashboard: z.enum(["supported", "partial", "unsupported"]),
      downloadsAvailable: z.boolean(),
    })
    .optional(),
  notice: z.string().optional(),
});

const ScopeSchema = z
  .object({
    kind: z.enum(["all", "specific", "demo"]),
    datasetId: z.string().optional(),
  })
  .optional();

const ExportSchema = z.object({
  mode: z.enum(["list", "detail"]),
  query: z.string().default(""),
  data: ResultSchema,
  datasetScope: ScopeSchema,
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
  const {
    mode,
    query,
    data,
    datasetScope: rawScope,
    params,
  } = parsed.data;

  if (mode === "detail" && data.niches.length === 0) {
    return NextResponse.json(
      { error: "No niche to export in detail mode" },
      { status: 400 },
    );
  }
  if (mode === "list" && data.niches.length === 0) {
    return NextResponse.json(
      { error: "No niches to export" },
      { status: 400 },
    );
  }

  // Cast to the provider type to feed the CSV builder. Zod has already
  // validated the structural shape; the only extra constraint it can't
  // express is the `as const` on the trend literal, which the schema
  // already enforces via z.enum.
  const csv = heatmapToCsv(data as ProviderHeatmapResult, mode);

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (userId) {
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
          // PRD: heatmap exports get their own type so the export-history
          // surface can group them and the user can re-run via params.
          type: "heatmap",
          query: query || (mode === "detail" ? data.niches[0]?.keyword ?? "heatmap" : "heatmap"),
          rowCount:
            mode === "list"
              ? data.niches.length
              : (data.niches[0]?.topAssets.length ?? 0) + 1,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          datasetScope: scopeTag,
          datasetId: scopedDatasetId,
          paramsJson: JSON.stringify({
            ...params,
            mode,
            providerId: data.providerId,
            appliedFilters: data.appliedFilters,
          }).slice(0, 2_048),
        },
      })
      .catch(() => {});
  }

  const tag =
    mode === "detail"
      ? `niche-${(data.niches[0]?.keyword ?? "niche").replace(/[^a-z0-9]+/gi, "-")}`
      : "niches";
  const filename = `sn-heatmap-${tag}-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
