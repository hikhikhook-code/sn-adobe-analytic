import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assetsToCsv } from "@/lib/csv";
import type { SearchAsset } from "@/types/search";

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
});

const ExportSchema = z.object({
  type: z.enum(["search", "portfolio"]).default("search"),
  query: z.string().default(""),
  results: z.array(AssetSchema).min(1).max(500),
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
  const { type, query, results } = parsed.data;
  const csv = assetsToCsv(results as SearchAsset[]);

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (userId) {
    prisma.exportHistory
      .create({
        data: { userId, type, query, rowCount: results.length },
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
