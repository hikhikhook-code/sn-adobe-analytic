import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runSimilar } from "@/lib/providers";
import { parseDatasetScope, resolveDatasetScope } from "@/lib/dataset-scope";
import { extractQueryTokens } from "@/lib/similarity";
import { requireEntitlement } from "@/lib/entitlement-gate";

const ScopeSchema = z
  .object({
    kind: z.enum(["all", "specific", "demo"]),
    datasetId: z.string().optional(),
  })
  .optional();

/**
 * PRD §5 Similar Image Search — `POST /api/search/similar`.
 *
 * Accepts EITHER:
 *   - `imageUrl`              public URL of the image to match against, OR
 *   - `imageFileName`         original filename when the user uploaded a file
 *
 * Plus an optional `hint` (free text, e.g. "business meeting laptop") and
 * the same content-type / AI / pagination filters as `/api/search`.
 *
 * Why we DON'T accept the image bytes:
 *   - This provider stack does no real visual / pixel matching today (per
 *     PRD: "metadata similarity is not true visual AI search"). Accepting
 *     bytes only to throw them away would be misleading.
 *   - Keeps the request body small and the route resilient to large
 *     uploads. The client renders its own preview from a `URL.createObjectURL`.
 *
 * `imageFile` is accepted but documented as ignored — old clients that
 * already POST a base64 blob keep working without server errors.
 */
const SimilarSchema = z
  .object({
    imageUrl: z
      .string()
      .url("imageUrl must be a valid http(s) URL")
      .max(2_048)
      .optional(),
    imageFileName: z.string().max(260).optional(),
    hint: z.string().max(200).optional(),
    /**
     * Accepted for forward compatibility but NOT used for ranking. The
     * provider scores against URL/filename/hint tokens only — see the
     * route docstring for the rationale. Capped at 1MB so a misbehaving
     * client can't OOM the server.
     */
    imageFile: z.string().max(1_000_000).optional(),
    contentType: z
      .enum(["all", "photo", "illustration", "vector", "video", "template", "3d"])
      .optional(),
    aiFilter: z.enum(["all", "ai_only", "exclude_ai"]).optional(),
    page: z.number().int().min(1).max(50).optional(),
    datasetScope: ScopeSchema,
  })
  .refine(
    (v) => Boolean(v.imageUrl || v.imageFileName || v.hint),
    "Provide at least one of: imageUrl, imageFileName, or hint",
  );

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = SimilarSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const data = parsed.data;
  // PRD §7: Similar Image Search is Starter+ only. Guests hit the gate too
  // (they have no plan). Owners bypass automatically.
  const gate = await requireEntitlement("canUseSimilarSearch", {
    requireSignedIn: true,
  });
  if (!gate.ok) return gate.response;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  const scopeInfo = await resolveDatasetScope(
    userId,
    parseDatasetScope(data.datasetScope),
  );

  // Pre-tokenize once on the route so every provider downstream sees the
  // same canonical token bag. Empty array → no usable signal; providers
  // surface an "Unavailable" notice in that case.
  const queryTokens = extractQueryTokens({
    imageUrl: data.imageUrl,
    imageFileName: data.imageFileName,
    hint: data.hint,
  });

  const result = await runSimilar(
    {
      imageUrl: data.imageUrl,
      imageFileName: data.imageFileName,
      hint: data.hint,
      contentType: data.contentType,
      aiFilter: data.aiFilter,
      page: data.page,
      queryTokens,
    },
    {
      userId,
      datasetScope: scopeInfo.scope,
    },
  );

  // Best-effort search-history logging. We reuse the SearchHistory table
  // and prefix the keyword with `[similar] ` so users can tell the two
  // search modes apart in their dashboard. Never block the response on it.
  if (userId) {
    const historyKeyword = data.imageUrl
      ? `[similar] ${data.imageUrl}`
      : data.imageFileName
        ? `[similar] ${data.imageFileName}`
        : `[similar] ${data.hint ?? ""}`;
    prisma.searchHistory
      .create({
        data: {
          userId,
          keyword: historyKeyword.slice(0, 280),
          sort: "relevance",
          contentType: data.contentType ?? "all",
          aiFilter: data.aiFilter ?? "all",
          resultCount: result.results.length,
        },
      })
      .catch(() => {});
  }

  return NextResponse.json({
    totalResults: result.totalResults,
    results: result.results,
    page: data.page ?? 1,
    pageSize: result.results.length,
    dataQuality: result.dataQuality,
    providerName: result.providerName,
    providerId: result.providerId,
    capabilities: result.capabilities,
    notice: result.notice,
    queryTokens: result.queryTokens,
    query: {
      imageUrl: data.imageUrl,
      imageFileName: data.imageFileName,
      hint: data.hint,
    },
    // Echo scope so the search page can render the right banner without a
    // second round-trip.
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
  });
}
