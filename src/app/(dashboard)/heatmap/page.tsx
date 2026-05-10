"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Download,
  Minus,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataQualityBadge,
  DataQualityBanner,
} from "@/components/ui/data-quality";
import { DataSourceBanner } from "@/components/layout/data-source-banner";
import {
  HeatmapFilters,
  type HeatmapFilterState,
  DEFAULT_HEATMAP_FILTER_STATE,
} from "@/components/heatmap/heatmap-filters";
import { NicheDetailDrawer } from "@/components/heatmap/niche-detail-drawer";
import { cn, formatNumber } from "@/lib/utils";
import { useActiveDataset } from "@/hooks/use-active-dataset";
import { useFavorites } from "@/hooks/use-favorites";
import type {
  HeatmapTile,
  ProviderHeatmapResult,
} from "@/lib/providers/types";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";
import type { SearchAsset } from "@/types/search";

interface HeatmapApiResponse extends ProviderHeatmapResult {
  datasetScope: DatasetScope;
  datasetName: string | null;
  scopeReason: DatasetScopeInfo["reason"];
  hasAnyDatasets: boolean;
}

function competitionColorBg(level: number): string {
  if (level <= 33) return "from-emerald-500 to-emerald-600";
  if (level <= 66) return "from-amber-500 to-orange-500";
  return "from-rose-500 to-rose-600";
}

function trendIcon(t: HeatmapTile["trend"]) {
  if (t === "up") return <TrendingUp className="h-3 w-3" />;
  if (t === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function buildQuery(filters: HeatmapFilterState): string {
  const params = new URLSearchParams();
  if (filters.contentType !== "all") params.set("contentType", filters.contentType);
  if (filters.period !== "all") params.set("period", filters.period);
  if (filters.minDownloads > 0) params.set("minDownloads", String(filters.minDownloads));
  if (filters.sort !== "opportunity") params.set("sort", filters.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}

export default function HeatmapPage() {
  const { scope } = useActiveDataset();
  const { isFavorited, toggle: toggleFavorite } = useFavorites();
  const [filters, setFilters] = useState<HeatmapFilterState>(
    DEFAULT_HEATMAP_FILTER_STATE,
  );
  const [data, setData] = useState<HeatmapApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Drawer state
  const [openNiche, setOpenNiche] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProviderHeatmapResult | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailExporting, setDetailExporting] = useState(false);
  const [listExporting, setListExporting] = useState(false);

  // Re-fetch when filters change. AbortController prevents stale rapid-fire
  // responses from overwriting newer ones.
  const abortRef = useRef<AbortController | null>(null);
  const loadGrid = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/heatmap${buildQuery(filters)}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Heat map failed (${res.status})`);
      const json: HeatmapApiResponse = await res.json();
      if (!ctrl.signal.aborted) setData(json);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [filters]);

  // Refetch on filter change OR active dataset selector change. The
  // server reads the active dataset from the session cookie, so we
  // need an explicit dep on `scopeKey` to trigger a re-run when the
  // user switches dataset elsewhere in the app.
  const scopeKey =
    scope.kind === "specific" ? `specific:${scope.datasetId}` : scope.kind;
  useEffect(() => {
    void loadGrid();
    return () => abortRef.current?.abort();
    // `loadGrid` is memoized over filters; `scopeKey` covers dataset switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadGrid, scopeKey]);

  const niches = useMemo(() => data?.niches ?? [], [data?.niches]);
  const max = niches.length ? Math.max(...niches.map((n) => n.downloads), 1) : 1;
  const dataQuality = data?.dataQuality ?? "demo";
  const providerName = data?.providerName ?? "Mock data provider";

  // Best opportunities: top 5 by opportunity score, with at least medium
  // demand AND not high competition. Falls back to top-by-opportunity if
  // the strict filter yields nothing (so the section never goes empty for
  // small datasets).
  const opportunities = useMemo(() => {
    const sorted = [...niches].sort(
      (a, b) => b.opportunityScore - a.opportunityScore,
    );
    const strict = sorted.filter((n) => n.competition <= 60);
    return (strict.length > 0 ? strict : sorted).slice(0, 6);
  }, [niches]);

  const onResetFilters = useCallback(() => {
    setFilters(DEFAULT_HEATMAP_FILTER_STATE);
  }, []);

  const openDrawer = useCallback(
    async (keyword: string) => {
      setOpenNiche(keyword);
      setDetail(null);
      setDetailLoading(true);
      try {
        const params = new URLSearchParams();
        if (filters.contentType !== "all")
          params.set("contentType", filters.contentType);
        if (filters.period !== "all") params.set("period", filters.period);
        if (filters.minDownloads > 0)
          params.set("minDownloads", String(filters.minDownloads));
        if (filters.sort !== "opportunity") params.set("sort", filters.sort);
        params.set("niche", keyword);
        const res = await fetch(`/api/heatmap?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed to load niche (${res.status})`);
        const json: ProviderHeatmapResult = await res.json();
        setDetail(json);
      } catch (e) {
        setDetail({
          niches: [],
          appliedFilters: { ...filters, niche: keyword },
          detail: true,
          dataQuality,
          providerName,
          notice:
            e instanceof Error
              ? e.message
              : "Failed to load niche detail.",
        });
      } finally {
        setDetailLoading(false);
      }
    },
    [filters, dataQuality, providerName],
  );

  const closeDrawer = useCallback(() => {
    setOpenNiche(null);
    setDetail(null);
  }, []);

  const exportList = useCallback(async () => {
    if (!data || data.niches.length === 0) return;
    setListExporting(true);
    try {
      const res = await fetch("/api/heatmap/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "list",
          query: `niches-${data.niches.length}`,
          data,
          datasetScope: data.datasetScope,
          params: { filters },
        }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      downloadBlob(blob, `sn-heatmap-niches-${todayIso()}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setListExporting(false);
    }
  }, [data, filters]);

  const exportDetail = useCallback(async () => {
    if (!detail || detail.niches.length === 0) return;
    setDetailExporting(true);
    try {
      const res = await fetch("/api/heatmap/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "detail",
          query: detail.niches[0].keyword,
          data: detail,
          datasetScope: data?.datasetScope,
          params: { filters, niche: detail.niches[0].keyword },
        }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      downloadBlob(
        blob,
        `sn-heatmap-niche-${detail.niches[0].keyword.replace(/[^a-z0-9]+/gi, "-")}-${todayIso()}.csv`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setDetailExporting(false);
    }
  }, [detail, data?.datasetScope, filters]);

  const onToggleFavorite = useCallback(
    (asset: SearchAsset) => {
      void toggleFavorite(asset);
    },
    [toggleFavorite],
  );

  const heatmapCapability = data?.capabilities?.heatmap;
  const isUnsupported = heatmapCapability === "unsupported";

  return (
    <>
      <TopBar
        title="Heat Map"
        subtitle="Visualize niches by demand vs. competition"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Niche heat map"
          description="Bigger tile = more demand. Greener = lower competition. Hunt for small green tiles in busy areas."
        />

        {data ? (
          <DataSourceBanner
            scope={data.datasetScope}
            datasetName={data.datasetName}
            hasAnyDatasets={data.hasAnyDatasets}
            reason={data.scopeReason}
            dataQuality={data.dataQuality}
            providerName={data.providerName}
          />
        ) : null}

        <DataQualityBanner
          level={dataQuality}
          providerName={providerName}
          message={
            dataQuality === "demo"
              ? "Demand and competition scores are derived from synthetic demo data. They are not real Adobe Stock niche metrics."
              : dataQuality === "verified"
                ? "Heat-map metrics are aggregated from your imported CSV data. Trend and opportunity scores are estimated."
                : dataQuality === "public_metadata"
                  ? "Public-metadata sources do not expose niche-level download data. Niche heat-map metrics are unavailable."
                  : "Heat-map metrics are estimated from the active provider."
          }
        />

        <HeatmapFilters
          value={filters}
          onChange={setFilters}
          onReset={onResetFilters}
          loading={loading}
        />

        {error && (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {data?.notice ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {data.notice}
          </div>
        ) : null}

        {isUnsupported ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">
              Heat map not supported by this provider
            </p>
            <p className="mt-1 max-w-prose mx-auto">
              {providerName} doesn&apos;t expose aggregated niche download
              data. Switch to demo mode or import your own CSV to see niche
              analytics.
            </p>
          </div>
        ) : null}

        {/* Top action bar — sort echo + export */}
        {!isUnsupported && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div>
              {loading
                ? "Loading\u2026"
                : niches.length === 0
                  ? "No niches matching filters."
                  : `${niches.length} niche${niches.length === 1 ? "" : "s"} \u2014 sort: ${filters.sort}`}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || niches.length === 0 || listExporting}
              onClick={exportList}
            >
              <Download className="h-4 w-4" />
              {listExporting ? "Exporting\u2026" : "Export niches CSV"}
            </Button>
          </div>
        )}

        {!isUnsupported && loading && (
          <div className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full rounded-xl" />
            ))}
          </div>
        )}

        {!isUnsupported && !loading && data && niches.length === 0 && !data.notice && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No matching niches</p>
            <p className="mt-1">
              Try widening the content type, lowering the minimum downloads,
              or extending the time period.
            </p>
          </div>
        )}

        {!isUnsupported && !loading && niches.length > 0 && (
          <div className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {niches.map((n) => {
              const sizeRatio = n.downloads / max;
              const span =
                sizeRatio > 0.7
                  ? "row-span-2"
                  : sizeRatio > 0.45
                    ? "row-span-2 sm:row-span-1"
                    : "";
              const downloadsLabel = n.metricsAvailable
                ? `${formatNumber(n.downloads)} dl`
                : "Unavailable";
              return (
                <button
                  key={n.keyword}
                  type="button"
                  onClick={() => openDrawer(n.keyword)}
                  className={cn(
                    "group relative flex flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br p-4 text-left text-white transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    competitionColorBg(n.competition),
                    span,
                  )}
                  aria-label={`Open detail for ${n.keyword}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight line-clamp-2 capitalize">
                      {n.keyword}
                    </p>
                    <div className="flex items-center gap-1">
                      <Badge variant="default" className="bg-white/20 text-white">
                        {n.trendAvailable ? trendIcon(n.trend) : <Minus className="h-3 w-3" />}
                      </Badge>
                      <DataQualityBadge
                        level={dataQuality}
                        size="xs"
                        showLabel={false}
                        className="!border-white/40 !bg-white/15 !text-white"
                      />
                    </div>
                  </div>
                  <div className="text-xs opacity-90">
                    <p className="text-base font-bold">{downloadsLabel}</p>
                    <p>
                      {formatNumber(n.assets)} assets · comp {n.competition}
                    </p>
                    <p className="mt-0.5 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">
                      <Sparkles className="h-3 w-3" />
                      Opp {n.opportunityScore}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Best opportunities</CardTitle>
                <CardDescription>
                  High demand, low/medium competition, ranked by opportunity score
                </CardDescription>
              </div>
              <DataQualityBadge level={dataQuality} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && niches.length === 0 ? (
                <Skeleton className="h-16 w-full" />
              ) : opportunities.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No opportunities surfaced under the current filters.
                </p>
              ) : (
                opportunities.map((n) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium capitalize">
                        {n.keyword}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {n.metricsAvailable
                          ? formatNumber(n.downloads)
                          : "—"}{" "}
                        downloads · comp {n.competition} · opp{" "}
                        {n.opportunityScore}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => openDrawer(n.keyword)}
                    >
                      Detail <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Crowded niches</CardTitle>
                <CardDescription>
                  High competition — only enter with a strong angle
                </CardDescription>
              </div>
              <DataQualityBadge level={dataQuality} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {loading && niches.length === 0 ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                niches
                  .filter((n) => n.competition >= 70)
                  .sort((a, b) => b.competition - a.competition)
                  .slice(0, 5)
                  .map((n) => (
                    <div
                      key={n.keyword}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                    >
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {n.keyword}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(n.assets)} assets · comp{" "}
                          {n.competition}
                        </p>
                      </div>
                      <Button asChild size="sm" variant="ghost">
                        <Link
                          href={`/search?q=${encodeURIComponent(n.keyword)}`}
                        >
                          View <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  ))
              )}
              {!loading && niches.filter((n) => n.competition >= 70).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No high-competition niches in the current scope.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <NicheDetailDrawer
        open={!!openNiche}
        loading={detailLoading}
        niche={detail?.niches[0] ?? null}
        envelope={
          detail
            ? {
                dataQuality: detail.dataQuality,
                providerName: detail.providerName,
                capabilities: detail.capabilities,
                notice: detail.notice,
                appliedFilters: detail.appliedFilters,
              }
            : null
        }
        onClose={closeDrawer}
        onExport={exportDetail}
        exporting={detailExporting}
        isFavorited={isFavorited}
        onToggleFavorite={onToggleFavorite}
      />
    </>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
