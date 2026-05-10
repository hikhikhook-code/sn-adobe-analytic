"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Download,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
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
  TrendingFilters,
  type TrendingFilterState,
  DEFAULT_TRENDING_FILTER_STATE,
} from "@/components/trending/trending-filters";
import { formatNumber } from "@/lib/utils";
import { useActiveDataset } from "@/hooks/use-active-dataset";
import { describeMonth, describeSeasonalStatus } from "@/lib/trending";
import type {
  ProviderTrendingResult,
  SeasonalTrend,
} from "@/lib/providers/types";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";

interface TrendingApiResponse extends ProviderTrendingResult {
  datasetScope: DatasetScope;
  datasetName: string | null;
  scopeReason: DatasetScopeInfo["reason"];
  hasAnyDatasets: boolean;
}

function buildQuery(filters: TrendingFilterState): string {
  const params = new URLSearchParams();
  if (filters.period !== DEFAULT_TRENDING_FILTER_STATE.period)
    params.set("period", filters.period);
  if (filters.contentType !== "all")
    params.set("contentType", filters.contentType);
  if (filters.minVolume > 0)
    params.set("minVolume", String(filters.minVolume));
  if (filters.sort !== DEFAULT_TRENDING_FILTER_STATE.sort)
    params.set("sort", filters.sort);
  const s = params.toString();
  return s ? `?${s}` : "";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function seasonalStatusVariant(
  s: SeasonalTrend["status"],
): "success" | "warning" | "secondary" {
  if (s === "in_season") return "success";
  if (s === "approaching") return "warning";
  return "secondary";
}

export default function TrendingPage() {
  const { scope } = useActiveDataset();
  const [filters, setFilters] = useState<TrendingFilterState>(
    DEFAULT_TRENDING_FILTER_STATE,
  );
  const [data, setData] = useState<TrendingApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Re-fetch when filters change. AbortController prevents stale rapid-fire
  // responses from overwriting newer ones.
  const abortRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/search/trending${buildQuery(filters)}`, {
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Trending failed (${res.status})`);
      const json: TrendingApiResponse = await res.json();
      if (!ctrl.signal.aborted) setData(json);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [filters]);

  // Refetch on filter change OR active dataset selector change. The
  // server reads the active dataset from the session cookie; we need an
  // explicit dep on `scopeKey` to trigger a re-run when the user
  // switches dataset elsewhere in the app.
  const scopeKey =
    scope.kind === "specific" ? `specific:${scope.datasetId}` : scope.kind;
  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
    // `load` is memoized over filters; `scopeKey` covers dataset switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, scopeKey]);

  const onResetFilters = useCallback(() => {
    setFilters(DEFAULT_TRENDING_FILTER_STATE);
  }, []);

  const exportCsv = useCallback(async () => {
    if (!data) return;
    const total =
      data.trending.length +
      data.risingNiches.length +
      data.topPerformers.length +
      data.seasonal.length;
    if (total === 0) return;
    setExporting(true);
    try {
      const res = await fetch("/api/trending/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `trending-${data.appliedFilters?.period ?? "30d"}`,
          data,
          datasetScope: data.datasetScope,
          params: { filters },
        }),
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      downloadBlob(blob, `sn-trending-${todayIso()}.csv`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [data, filters]);

  const trending = useMemo(() => data?.trending ?? [], [data?.trending]);
  const risingNiches = useMemo(
    () => data?.risingNiches ?? [],
    [data?.risingNiches],
  );
  const topPerformers = useMemo(
    () => data?.topPerformers ?? [],
    [data?.topPerformers],
  );
  const seasonal = useMemo(() => data?.seasonal ?? [], [data?.seasonal]);

  const dataQuality = data?.dataQuality ?? "demo";
  const providerName = data?.providerName ?? "Mock data provider";
  const trendingCapability = data?.capabilities?.trending;
  const isUnsupported = trendingCapability === "unsupported";
  const downloadsAvailable = data?.capabilities?.downloadsAvailable !== false;
  const totalRows =
    trending.length +
    risingNiches.length +
    topPerformers.length +
    seasonal.length;

  return (
    <>
      <TopBar
        title="Trending"
        subtitle="Keyword & niche trends across Adobe Stock"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Trending right now"
          description={
            "Trending keywords, rising niches, top performers this period, and seasonal trends \u2014 all scoped to your active dataset."
          }
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
              ? "Search-volume and growth percentages are synthetic demo signals. They do not reflect real Adobe Stock search trends."
              : dataQuality === "verified"
                ? "Trending keywords, niches, top performers, and seasonal patterns are derived from your imported CSV data."
                : dataQuality === "public_metadata"
                  ? "Public-metadata sources do not expose trending search data. Numbers below are unavailable."
                  : "Trending metrics are estimated from the active provider."
          }
        />

        <TrendingFilters
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
              Trending not supported by this provider
            </p>
            <p className="mt-1 max-w-prose mx-auto">
              {providerName} doesn&apos;t expose aggregated trending data.
              Switch to demo mode or import your own CSV to see trending
              analytics.
            </p>
          </div>
        ) : null}

        {!isUnsupported && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/40 bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
            <div>
              {loading
                ? "Loading\u2026"
                : totalRows === 0
                  ? "No trending data matching filters."
                  : `${trending.length} keywords \u00b7 ${risingNiches.length} rising niches \u00b7 ${topPerformers.length} top performers \u00b7 ${seasonal.length} seasonal`}
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || totalRows === 0 || exporting}
              onClick={exportCsv}
            >
              <Download className="h-4 w-4" />
              {exporting ? "Exporting\u2026" : "Export trending CSV"}
            </Button>
          </div>
        )}

        {!isUnsupported && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Trending keywords</CardTitle>
                  <CardDescription>
                    {filters.sort === "volume"
                      ? "Highest search volume in this period"
                      : "Highest search-volume growth"}
                  </CardDescription>
                </div>
                <DataQualityBadge level={dataQuality} size="sm" />
              </CardHeader>
              <CardContent className="space-y-2">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))
                  : null}
                {!loading && trending.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                    No trending keywords for the current filters.
                  </p>
                ) : null}
                {trending.map((t, i) => (
                  <div
                    key={t.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium capitalize">
                          {t.keyword}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {!downloadsAvailable || t.metricsAvailable === false
                            ? "Volume unavailable"
                            : `${formatNumber(t.volume)} volume`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.metricsAvailable === false ? (
                        <Badge variant="secondary">Unavailable</Badge>
                      ) : (
                        <Badge variant={t.growth >= 0 ? "success" : "danger"} className="gap-1">
                          <TrendingUp className="h-3 w-3" />
                          {t.growth >= 0 ? "+" : ""}
                          {t.growth}%
                        </Badge>
                      )}
                      <Button size="sm" variant="ghost" asChild>
                        <Link
                          href={`/search?q=${encodeURIComponent(t.keyword)}`}
                          aria-label={`Search ${t.keyword}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle>Rising niches</CardTitle>
                  <CardDescription>
                    Niches gaining momentum, ranked by{" "}
                    {filters.sort === "volume" ? "demand" : "growth"}
                  </CardDescription>
                </div>
                <DataQualityBadge level={dataQuality} size="sm" />
              </CardHeader>
              <CardContent className="space-y-2">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))
                  : null}
                {!loading && risingNiches.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                    No rising niches for the current filters.
                  </p>
                ) : null}
                {risingNiches.map((n, i) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium capitalize">
                          {n.keyword}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {!downloadsAvailable || n.metricsAvailable === false
                            ? `Downloads unavailable \u00b7 comp ${n.competition}`
                            : `${formatNumber(n.downloads)} downloads \u00b7 ${n.assets} assets \u00b7 comp ${n.competition}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {n.metricsAvailable === false ? (
                        <Badge variant="secondary">Unavailable</Badge>
                      ) : (
                        <Badge variant="success" className="gap-1">
                          <TrendingUp className="h-3 w-3" />+{n.growth}%
                        </Badge>
                      )}
                      <Button size="sm" variant="ghost" asChild>
                        <Link
                          href={`/search?q=${encodeURIComponent(n.keyword)}`}
                          aria-label={`Search ${n.keyword}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent-blue" />
                    Top performers this period
                  </CardTitle>
                  <CardDescription>
                    Top assets uploaded within the active period
                  </CardDescription>
                </div>
                <DataQualityBadge level={dataQuality} size="sm" />
              </CardHeader>
              <CardContent className="space-y-2">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))
                  : null}
                {!loading && topPerformers.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                    No top performers for the current filters. Try widening
                    the time period or content type.
                  </p>
                ) : null}
                {topPerformers.map((p, i) => {
                  const a = p.asset;
                  const downloadsLabel =
                    !downloadsAvailable || a.metricsAvailable === false
                      ? "Unavailable"
                      : `${formatNumber(p.recentDownloads)} dl`;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-blue/10 text-xs font-semibold text-accent-blue">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {a.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {a.contentType}
                            {" \u00b7 "}
                            {a.contributorName}
                            {" \u00b7 "}
                            {downloadsLabel}
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="ghost" asChild>
                        <a
                          href={a.adobeStockUrl || "#"}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${a.title} on Adobe Stock`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-amber-700" />
                    Seasonal trends
                  </CardTitle>
                  <CardDescription>
                    Keywords with a strong calendar-month peak signal
                  </CardDescription>
                </div>
                <DataQualityBadge
                  level={dataQuality === "verified" ? "estimated" : dataQuality}
                  size="sm"
                  description="Seasonal lift is derived from the upload-date distribution of your imported assets."
                />
              </CardHeader>
              <CardContent className="space-y-2">
                {loading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))
                  : null}
                {!loading && seasonal.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                    Not enough data to surface seasonal trends. Seasonal
                    detection needs at least six months of upload history per
                    keyword.
                  </p>
                ) : null}
                {seasonal.map((s, i) => (
                  <div
                    key={s.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium capitalize">
                          {s.keyword}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {s.available
                            ? `Peaks in ${describeMonth(s.peakMonth)} \u00b7 ${s.peakLift.toFixed(1)}\u00d7 lift`
                            : "Seasonal signal unavailable"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.available ? (
                        <Badge
                          variant={seasonalStatusVariant(s.status)}
                          className="gap-1"
                        >
                          {describeSeasonalStatus(s.status)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Unavailable</Badge>
                      )}
                      <Button size="sm" variant="ghost" asChild>
                        <Link
                          href={`/search?q=${encodeURIComponent(s.keyword)}`}
                          aria-label={`Search ${s.keyword}`}
                        >
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
