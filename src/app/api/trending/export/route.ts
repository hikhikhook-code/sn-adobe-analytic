import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { trendingToCsv } from "@/lib/trending";
import { parseDatasetScope } from "@/lib/dataset-scope";
import type { ProviderTrendingResult } from "@/lib/providers/types";

/**
 * POST /api/trending/export
 *
 * Body shape mirrors `/api/heatmap/export`:
 *
 *   {
 *     // The full provider response the user is currently looking at.
 *     // Re-using the response keeps the CSV honest \u2014 we export exactly
 *     // what the user sees, including the same data-quality badge,
 *     // applied filters, and "Unavailable" cells.
 *     data: ProviderTrendingResult,
 *     query: string,         // free-text label for the export-history row
 *     datasetScope?: { kind: "all" | "specific" | "demo", datasetId?: string },
 *     params?: Record<string, unknown>,  // raw filters etc, for "download again"
 *   }
 *
 * Records an `ExportHistory` row with `type = "trending"`. Honors the
 * dataset-scope tag captured at export time so the audit trail survives a
 * later archive/delete of the dataset.
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

const TrendingKeywordSchema = z.object({
  keyword: z.string(),
  volume: z.number(),
  growth: z.number(),
  metricsAvailable: z.boolean().optional(),
});

const RisingNicheSchema = z.object({
  keyword: z.string(),
  downloads: z.number(),
  assets: z.number(),
  growth: z.number(),
  competition: z.number(),
  metricsAvailable: z.boolean().optional(),
});

const TopPerformerSchema = z.object({
  asset: AssetSchema,
  recentDownloads: z.number(),
});

const SeasonalTrendSchema = z.object({
  keyword: z.string(),
  peakMonth: z.number(),
  peakLift: z.number(),
  status: z.enum(["in_season", "approaching", "off_season"]),
  available: z.boolean(),
});

const FiltersSchema = z
  .object({
    period: z.enum(["7d", "30d", "90d", "1y"]).optional(),
    contentType: z.string().optional(),
    minVolume: z.number().optional(),
    sort: z.enum(["growth", "volume"]).optional(),
    limit: z.number().optional(),
  })
  .partial();

const ResultSchema = z.object({
  trending: z.array(TrendingKeywordSchema),
  risingNiches: z.array(RisingNicheSchema),
  topPerformers: z.array(TopPerformerSchema),
  seasonal: z.array(SeasonalTrendSchema),
  appliedFilters: FiltersSchema,
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
    query,
    data,
    datasetScope: rawScope,
    params,
  } = parsed.data;

  const totalRows =
    data.trending.length +
    data.risingNiches.length +
    data.topPerformers.length +
    data.seasonal.length;
  if (totalRows === 0) {
    return NextResponse.json(
      { error: "No trending data to export" },
      { status: 400 },
    );
  }

  const csv = trendingToCsv(data as ProviderTrendingResult);

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (userId) {
    // Normalize the scope into the string tag we store. As with /api/export,
    // the export itself already passed through runTrending whose
    // resolveDatasetScope call enforces ownership; this row is informational.
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
          // PRD \u00a75.8: trending exports get their own type so the
          // export-history surface can group them and the user can re-run
          // via params.
          type: "trending",
          query: query || "trending",
          rowCount: totalRows,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          datasetScope: scopeTag,
          datasetId: scopedDatasetId,
          paramsJson: JSON.stringify({
            ...params,
            providerId: data.providerId,
            appliedFilters: data.appliedFilters,
            sections: {
              trending: data.trending.length,
              risingNiches: data.risingNiches.length,
              topPerformers: data.topPerformers.length,
              seasonal: data.seasonal.length,
            },
          }).slice(0, 2_048),
        },
      })
      .catch(() => {});
  }

  const filename = `sn-trending-${(query || "export").replace(/[^a-z0-9]+/gi, "-")}-${
    new Date().toISOString().slice(0, 10)
  }.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
