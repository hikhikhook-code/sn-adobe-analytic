import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runSearch } from "@/lib/providers";
import { parseDatasetScope, resolveDatasetScope } from "@/lib/dataset-scope";

const ScopeSchema = z
  .object({
    kind: z.enum(["all", "specific", "demo"]),
    datasetId: z.string().optional(),
  })
  .optional();

const SearchSchema = z.object({
  keyword: z.string().min(1).max(200),
  sort: z
    .enum(["relevance", "newest", "featured", "most_downloaded", "undiscovered"])
    .optional(),
  contentType: z
    .enum(["all", "photo", "illustration", "vector", "video", "template", "3d"])
    .optional(),
  aiFilter: z.enum(["all", "ai_only", "exclude_ai"]).optional(),
  page: z.number().int().min(1).max(50).optional(),
  /**
   * Optional per-request override of the user's stored dataset preference.
   * Useful when a page wants to force a specific scope for a single query
   * without flipping the global selector. Invalid/foreign datasetIds fall
   * back to the user's stored preference (see resolveDatasetScope).
   */
  datasetScope: ScopeSchema,
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SearchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const scopeInfo = await resolveDatasetScope(
    userId,
    parseDatasetScope(data.datasetScope),
  );
  const result = await runSearch(data, {
    userId,
    datasetScope: scopeInfo.scope,
  });

  // Best-effort search history logging — never block the response on it.
  if (userId) {
    prisma.searchHistory
      .create({
        data: {
          userId,
          keyword: data.keyword,
          sort: data.sort ?? "relevance",
          contentType: data.contentType ?? "all",
          aiFilter: data.aiFilter ?? "all",
          resultCount: result.results.length,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({
    totalResults: result.totalResults,
    competitionLevel: result.competitionLevel,
    aiSaturation: result.aiSaturation,
    contentBreakdown: result.contentBreakdown,
    results: result.results,
    page: data.page ?? 1,
    pageSize: result.results.length,
    dataQuality: result.dataQuality,
    providerName: result.providerName,
    // Echo the scope back so the search page can render the right banner
    // without making a separate /api/user/active-dataset call.
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
  });
}
