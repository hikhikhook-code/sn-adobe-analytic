import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { runHeatmap } from "@/lib/providers";
import { resolveDatasetScope } from "@/lib/dataset-scope";
import { parseHeatmapFilters } from "@/lib/heatmap";

/**
 * GET /api/heatmap
 *
 * Query params (all optional):
 *   - contentType=all|photo|illustration|vector|video|template|3d|other
 *   - period=7d|30d|90d|1y|all
 *   - minDownloads=<integer>
 *   - sort=opportunity|demand|competition|trend
 *   - niche=<keyword>     // when set, returns single-tile detail mode
 *
 * Responses always include:
 *   - the provider envelope (dataQuality, providerName, capabilities, notice)
 *   - `appliedFilters` so the UI knows what actually ran
 *   - the active dataset scope (so banners stay in sync after filter changes)
 *
 * Filters are applied server-side by the active provider \u2014 they affect the
 * underlying aggregation, not just the displayed grid. PRD \u00a75.3 explicitly
 * requires this so manual/imported data drives heat-map analytics.
 */
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const scopeInfo = await resolveDatasetScope(userId);

  const url = new URL(req.url);
  const filters = parseHeatmapFilters({
    contentType: url.searchParams.get("contentType"),
    period: url.searchParams.get("period"),
    minDownloads: url.searchParams.get("minDownloads"),
    sort: url.searchParams.get("sort"),
    niche: url.searchParams.get("niche"),
  });

  const result = await runHeatmap(
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
