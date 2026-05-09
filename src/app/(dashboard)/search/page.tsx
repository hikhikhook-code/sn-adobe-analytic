"use client";

import { useCallback, useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/layout/topbar";
import { SearchBar } from "@/components/search/search-bar";
import { SearchFilters } from "@/components/search/search-filters";
import { ResultsSummary } from "@/components/search/results-summary";
import { ResultsToolbar } from "@/components/search/results-toolbar";
import { ResultCard } from "@/components/search/result-card";
import { Pagination } from "@/components/search/pagination";
import { RecentSearches } from "@/components/search/recent-searches";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useFavorites } from "@/hooks/use-favorites";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBanner } from "@/components/layout/data-source-banner";
import { useActiveDataset } from "@/hooks/use-active-dataset";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";
import type {
  AiFilter,
  ContentType,
  SearchAsset,
  SearchResponse,
  SortMode,
} from "@/types/search";
import type { ProviderCapabilities } from "@/lib/providers/types";

// The /api/search route now echoes back the resolved scope so we can render
// the banner + export payload without a second fetch. We widen SearchResponse
// locally with those optional fields.
interface SearchResponseWithScope extends SearchResponse {
  datasetScope?: DatasetScope;
  datasetName?: string | null;
  scopeReason?: DatasetScopeInfo["reason"];
  hasAnyDatasets?: boolean;
  capabilities?: ProviderCapabilities;
  notice?: string;
}

function SearchPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQ = sp.get("q") ?? "";

  const [keyword, setKeyword] = useState(initialQ);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [contentType, setContentType] = useState<ContentType>("all");
  const [aiFilter, setAiFilter] = useState<AiFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponseWithScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toolbarSort, setToolbarSort] = useState<"default" | "downloads" | "performance">("default");
  const [exporting, setExporting] = useState(false);

  // Mirror the global selector so the empty-state banner can describe the
  // user's scope even before they run a search.
  const active = useActiveDataset();

  const { items: recents, add: addRecent, remove: removeRecent, clear: clearRecents } = useRecentSearches();
  const { isFavorited, toggle: toggleFavorite } = useFavorites();

  const runSearch = useCallback(
    async (kw: string, p = 1) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keyword: kw, sort, contentType, aiFilter, page: p }),
        });
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const json = (await res.json()) as SearchResponseWithScope;
        setData(json);
        setPage(p);
        setSelected(new Set());
        addRecent(kw);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [sort, contentType, aiFilter, addRecent],
  );

  useEffect(() => {
    if (initialQ) {
      setKeyword(initialQ);
      runSearch(initialQ, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQ]);

  // Re-run the current search when the user flips the top-bar selector so
  // the displayed results always match the active data source. We key off
  // the serialized scope so rapid toggles coalesce.
  const scopeKey = useMemo(() => JSON.stringify(active.scope), [active.scope]);
  useEffect(() => {
    if (keyword && !active.loading) {
      runSearch(keyword, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  const handleSubmit = useCallback(
    (kw: string) => {
      setKeyword(kw);
      const params = new URLSearchParams(sp.toString());
      params.set("q", kw);
      router.push(`/search?${params.toString()}`);
      runSearch(kw, 1);
    },
    [router, runSearch, sp],
  );

  const handleFiltersChange = useCallback(
    (next: Partial<{ sort: SortMode; contentType: ContentType; aiFilter: AiFilter }>) => {
      if (next.sort !== undefined) setSort(next.sort);
      if (next.contentType !== undefined) setContentType(next.contentType);
      if (next.aiFilter !== undefined) setAiFilter(next.aiFilter);
    },
    [],
  );

  // Re-run when filters change & we have a keyword
  useEffect(() => {
    if (keyword) {
      runSearch(keyword, 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, contentType, aiFilter]);

  const sortedResults = useMemo(() => {
    if (!data) return [] as SearchAsset[];
    const out = [...data.results];
    if (toolbarSort === "downloads") out.sort((a, b) => b.downloads - a.downloads);
    if (toolbarSort === "performance") out.sort((a, b) => b.performanceScore - a.performanceScore);
    return out;
  }, [data, toolbarSort]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    if (selected.size === data.results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.results.map((r) => r.id)));
    }
  }, [data, selected.size]);

  const handleExport = useCallback(async () => {
    if (!data) return;
    const targets = selected.size > 0
      ? data.results.filter((r) => selected.has(r.id))
      : data.results;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "search",
          query: keyword,
          results: targets,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          // The export history table lives or dies on knowing which scope
          // produced each export; carry it through explicitly instead of
          // re-deriving server-side (which would miss the "demo fallback
          // after orphan" case).
          datasetScope: data.datasetScope,
          params: { keyword, sort, contentType, aiFilter },
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sn-search-${keyword.replace(/\s+/g, "-")}-${
        new Date().toISOString().slice(0, 10)
      }.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [data, keyword, selected, sort, contentType, aiFilter]);

  return (
    <>
      <TopBar
        title="Search"
        subtitle="Find Adobe Stock keywords and analyze performance"
      />
      <div className="space-y-6 p-6">
        <div className="space-y-4 rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
          <SearchBar
            defaultValue={keyword}
            loading={loading}
            onSubmit={handleSubmit}
          />
          <SearchFilters
            sort={sort}
            contentType={contentType}
            aiFilter={aiFilter}
            onChange={handleFiltersChange}
          />
          <RecentSearches
            items={recents}
            onPick={handleSubmit}
            onRemove={removeRecent}
            onClear={clearRecents}
          />
        </div>

        {error && (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[480px] w-full" />
            ))}
          </div>
        )}

        {data && (
          <>
            <DataSourceBanner
              scope={data.datasetScope ?? active.scope}
              datasetName={data.datasetName ?? active.datasetName}
              hasAnyDatasets={data.hasAnyDatasets ?? active.hasAnyDatasets}
              reason={data.scopeReason ?? active.reason}
              dataQuality={data.dataQuality}
              providerName={data.providerName}
            />

            {data.notice ? (
              <div
                role="status"
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900"
              >
                <p className="font-semibold uppercase tracking-wide">
                  Heads up · {data.providerName}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug">{data.notice}</p>
              </div>
            ) : null}

            <ResultsSummary
              totalResults={data.totalResults}
              keyword={keyword}
              competitionLevel={data.competitionLevel}
              aiSaturation={data.aiSaturation}
              contentBreakdown={data.contentBreakdown}
              dataQuality={data.dataQuality}
            />

            <ResultsToolbar
              total={data.results.length}
              selectedCount={selected.size}
              toolbarSort={toolbarSort}
              onSortChange={setToolbarSort}
              onSelectAll={selectAll}
              onExport={handleExport}
              exporting={exporting}
            />

            {data.results.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                <p className="text-sm font-medium">
                  No results for <span className="text-foreground">{keyword}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.datasetScope?.kind === "specific"
                    ? "This dataset has no assets matching that query. Switch to All datasets from the top-bar selector to search across your other imports."
                    : "Try a different keyword or broaden your filters."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedResults.map((asset) => (
                  <ResultCard
                    key={asset.id}
                    asset={asset}
                    isFavorited={isFavorited(asset.id)}
                    onToggleFavorite={toggleFavorite}
                    selected={selected.has(asset.id)}
                    onToggleSelected={toggleSelected}
                    dataQuality={data.dataQuality}
                  />
                ))}
              </div>
            )}

            <Pagination
              page={page}
              hasNext={data.results.length >= data.pageSize}
              onChange={(p) => runSearch(keyword, p)}
            />
          </>
        )}

        {!loading && !data && !error && (
          <div className="space-y-4">
            <DataSourceBanner
              scope={active.scope}
              datasetName={active.datasetName}
              hasAnyDatasets={active.hasAnyDatasets}
              reason={active.reason}
              providerName={
                active.scope.kind === "demo"
                  ? "Mock data provider"
                  : "User imported data"
              }
              dataQuality={active.scope.kind === "demo" ? "demo" : "verified"}
            />
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
              <p className="text-sm">
                Try a demo keyword like{" "}
                <span className="font-medium text-foreground">business</span>,{" "}
                <span className="font-medium text-foreground">nature</span>, or{" "}
                <span className="font-medium text-foreground">ai illustration</span>.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
