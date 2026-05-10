import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runSearch } from "@/lib/providers";
import {
  ProviderNoDataError,
  ProviderRequiresUserError,
} from "@/lib/providers/types";
import { parseDatasetScope, resolveDatasetScope } from "@/lib/dataset-scope";
import {
  checkAndResetDailySearchBudget,
  recordDailySearch,
} from "@/lib/entitlements-server";
import { searchDedupKey, seenRecently } from "@/lib/search-dedup";

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

/**
 * POST /api/search — keyword search.
 *
 * PR #21 note — duplicate-count fix (server side):
 * PR #20 fixed the client so one user action should only fire one POST
 * here, but QA still saw `Searches Today` incrementing by +2 and
 * duplicate `SearchHistory` rows. Root cause: React Strict Mode
 * unmounts then remounts the /search page once on initial navigation
 * (and fast-refresh / back-forward can do the same). The page-level
 * dedup ref is recreated on the second mount, so the mount-only
 * initial-URL effect fires twice and each call lands here before the
 * first one finishes. Since both requests already got past the Zod
 * validator + scope resolution, both were writing a `SearchHistory`
 * row and ticking the daily counter.
 *
 * Fix: a process-local idempotency cache keyed by
 * `(userId, keyword, sort, contentType, aiFilter, page, 30s-bucket)`.
 * We still run the provider search and return fresh results on every
 * call (never serve stale data from the cache), but the second call
 * within the window is treated as a no-op for the *side effects* —
 * no duplicate `SearchHistory` row, no duplicate `searchesUsedToday`
 * increment. The practical window (30s) was chosen so that a deliberate
 * re-run of the same search ~30s later still counts as a new search,
 * while every duplicate-on-mount / refresh / back-forward flow
 * collapses to one record. See `src/lib/search-dedup.ts`.
 */
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

  // PRD §7 daily-search budget. We only enforce for signed-in users —
  // anonymous callers already hit the guest-flow demo data path and
  // never touch the per-user counter. Unlimited plans + owners bypass
  // the gate entirely inside `checkAndResetDailySearchBudget`.
  if (userId) {
    const budget = await checkAndResetDailySearchBudget(userId);
    if (!budget.allowed) {
      return NextResponse.json(
        {
          error: "daily_search_limit_reached",
          message:
            "You've hit your daily search limit. Upgrade your plan for more searches.",
          plan: budget.plan,
          limit: budget.limit,
          used: budget.used,
          remaining: budget.remaining,
        },
        { status: 429 },
      );
    }
  }

  const scopeInfo = await resolveDatasetScope(
    userId,
    parseDatasetScope(data.datasetScope),
  );

  let result;
  try {
    result = await runSearch(data, {
      userId,
      datasetScope: scopeInfo.scope,
    });
  } catch (err) {
    // PR #23: when a signed-in user has no data and hasn't opted into
    // demo mode, runProvider now throws instead of silently substituting
    // mock data. Return an honest empty response the UI can render as
    // a "no data configured" state.
    if (
      err instanceof ProviderNoDataError ||
      err instanceof ProviderRequiresUserError
    ) {
      return NextResponse.json({
        totalResults: 0,
        competitionLevel: "low",
        aiSaturation: 0,
        contentBreakdown: [],
        results: [],
        page: data.page ?? 1,
        pageSize: 0,
        dataQuality: "demo",
        providerName: "No data source",
        providerId: "none",
        datasetScope: scopeInfo.scope,
        datasetName: scopeInfo.datasetName ?? null,
        scopeReason: scopeInfo.reason,
        hasAnyDatasets: scopeInfo.hasAnyDatasets,
        capabilities: null,
        notice:
          "No data source is configured. Import a CSV, configure the public metadata provider, or switch to demo mode.",
        noDataConfigured: true,
      });
    }
    throw err;
  }

  // Dedup the side effects (history row + counter tick) but always
  // return fresh results. Gated on a signed-in user — anonymous callers
  // don't write SearchHistory / increment counters anyway, so there's
  // nothing to dedup.
  if (userId) {
    const dedupKey = searchDedupKey({
      userId,
      keyword: data.keyword,
      sort: data.sort ?? "relevance",
      contentType: data.contentType ?? "all",
      aiFilter: data.aiFilter ?? "all",
      page: data.page ?? 1,
    });
    if (!seenRecently(dedupKey)) {
      // Best-effort search history logging — never block the response on it.
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
      // Non-blocking: increment the per-day counter. recordDailySearch
      // is a no-op for unlimited plans + owners so it's safe to always
      // call after a successful search.
      recordDailySearch(userId).catch(() => {});
    }
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
    providerId: result.providerId,
    // Echo the scope back so the search page can render the right banner
    // without making a separate /api/user/active-dataset call.
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
    // Provider capabilities + per-call notice. Drive "Coming Soon" /
    // "Provider not configured" UI without a second round-trip.
    capabilities: result.capabilities,
    notice: result.notice,
  });
}
