import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { portfolioToCsv } from "@/lib/csv";
import { parseDatasetScope } from "@/lib/dataset-scope";

/**
 * Schema for the contributor payload the client sends back to the server.
 * Mirrors `ProviderContributorResult` but kept loose on optional fields so
 * older client builds that don't yet send `capabilities` still work.
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

const ContributorSchema = z.object({
  name: z.string(),
  joinDate: z.string(),
  totalAssets: z.number(),
  totalDownloads: z.number(),
  avgDownloads: z.number(),
  bestAsset: z.object({
    id: z.string(),
    title: z.string(),
    downloads: z.number(),
  }),
  contentBreakdown: z.array(
    z.object({
      type: z.string(),
      count: z.number(),
      pct: z.number(),
    }),
  ),
  topKeywords: z.array(z.object({ keyword: z.string(), count: z.number() })),
  monthlyTrend: z.array(z.object({ month: z.string(), downloads: z.number() })),
  assets: z.array(AssetSchema),
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
  data: ContributorSchema,
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
  const { query, data, datasetScope: rawScope, params } = parsed.data;

  const csv = portfolioToCsv(data);

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
          type: "portfolio",
          query,
          rowCount: data.assets.length,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          datasetScope: scopeTag,
          datasetId: scopedDatasetId,
          paramsJson: JSON.stringify({
            ...params,
            contributor: data.name,
            providerId: data.providerId,
          }).slice(0, 2_048),
        },
      })
      .catch(() => {});
  }

  const filename = `sn-portfolio-${(data.name || query)
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase() || "export"}-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
