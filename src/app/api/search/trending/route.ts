import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runTrending } from "@/lib/providers";
import { resolveDatasetScope } from "@/lib/dataset-scope";
import { parseTrendingFilters } from "@/lib/trending";
import { requireEntitlement } from "@/lib/entitlement-gate";

/**
 * GET /api/search/trending
 *
 * Query params (all optional):
 *   - period=7d|30d|90d|1y
 *   - contentType=all|photo|illustration|vector|video|template|3d|other
 *   - minVolume=<integer>
 *   - sort=growth|volume
 *   - limit=<integer 1..50>
 *
 * Responses always include:
 *   - the provider envelope (dataQuality, providerName, capabilities, notice)
 *   - `appliedFilters` so the UI knows what actually ran
 *   - the active dataset scope (so banners stay in sync after filter changes)
 *
 * Filters affect provider aggregation, not just frontend display \u2014 PRD
 * \u00a75.8 explicitly requires this for trending.
 */
export async function GET(req: Request) {
  // PRD §7: Trending Insights is Pro/Annual. Owners bypass.
  const gate = await requireEntitlement("canUseTrending", {
    requireSignedIn: true,
  });
  if (!gate.ok) return gate.response;
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const scopeInfo = await resolveDatasetScope(userId);

  const url = new URL(req.url);
  const filters = parseTrendingFilters({
    period: url.searchParams.get("period"),
    contentType: url.searchParams.get("contentType"),
    minVolume: url.searchParams.get("minVolume"),
    sort: url.searchParams.get("sort"),
    limit: url.searchParams.get("limit"),
  });

  const result = await runTrending(
    { userId, datasetScope: scopeInfo.scope },
    filters,
  );
  return NextResponse.json({
    ...result,
    datasetScope: scopeInfo.scope,
    datasetName: scopeInfo.datasetName ?? null,
    scopeReason: scopeInfo.reason,
    hasAnyDatasets: scopeInfo.hasAnyDatasets,
  });
}
