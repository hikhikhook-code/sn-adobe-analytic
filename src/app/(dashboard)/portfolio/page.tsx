"use client";

import { useCallback, useState } from "react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { DataQualityBanner } from "@/components/ui/data-quality";
import {
  parseContributorInput,
  describeContributorInput,
} from "@/lib/portfolio-input";
import { PortfolioSearchForm } from "@/components/portfolio/portfolio-search-form";
import { PortfolioOverview } from "@/components/portfolio/portfolio-overview";
import { PortfolioBestSellers } from "@/components/portfolio/portfolio-best-sellers";
import { PortfolioKeywordAnalysis } from "@/components/portfolio/portfolio-keyword-analysis";
import { PortfolioContentBreakdown } from "@/components/portfolio/portfolio-content-breakdown";
import { PortfolioMonthlyTrends } from "@/components/portfolio/portfolio-monthly-trends";
import { PortfolioAssetGrid } from "@/components/portfolio/portfolio-asset-grid";
import { PortfolioCompare } from "@/components/portfolio/portfolio-compare";
import type { ProviderContributorResult } from "@/lib/providers/types";

import type { DatasetScope } from "@/lib/dataset-scope";

interface PortfolioApiResponse extends ProviderContributorResult {
  datasetScope?: DatasetScope;
  datasetName?: string | null;
  scopeReason?: string;
  hasAnyDatasets?: boolean;
}

type LookupState =
  | { kind: "idle" }
  | { kind: "loading"; describe: string }
  | { kind: "ready"; data: PortfolioApiResponse }
  | { kind: "not-found"; describe: string; provider?: string }
  | { kind: "unsupported"; provider?: string; reason: string }
  | { kind: "error"; message: string };

export default function PortfolioPage() {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<LookupState>({ kind: "idle" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const onSubmit = useCallback(async () => {
    const parsed = parseContributorInput(query);
    if (!parsed) return;
    const describe = describeContributorInput(parsed);
    setState({ kind: "loading", describe });
    setSelected(new Set());
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: parsed.value }),
      });
      if (res.status === 404) {
        const json = (await res.json().catch(() => ({}))) as {
          providerName?: string;
        };
        setState({
          kind: "not-found",
          describe,
          provider: json.providerName,
        });
        return;
      }
      if (res.status === 501 || res.status === 503) {
        const json = (await res.json().catch(() => ({}))) as {
          providerName?: string;
          message?: string;
          notice?: string;
        };
        setState({
          kind: "unsupported",
          provider: json.providerName,
          reason:
            json.message ??
            json.notice ??
            "The active data provider does not support contributor lookup.",
        });
        return;
      }
      if (!res.ok) {
        throw new Error(`Lookup failed (${res.status})`);
      }
      const data: PortfolioApiResponse = await res.json();
      // Empty + notice = the active provider can't actually serve this
      // contributor (e.g. Public Metadata Provider not configured).
      // Render a clean "unsupported / not configured" state rather than
      // implying we just couldn't find the contributor.
      if (data.assets.length === 0 && data.totalAssets === 0) {
        if (data.notice) {
          setState({
            kind: "unsupported",
            provider: data.providerName,
            reason: data.notice,
          });
          return;
        }
        setState({ kind: "not-found", describe, provider: data.providerName });
        return;
      }
      setState({ kind: "ready", data });
    } catch (err) {
      setState({
        kind: "error",
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }, [query]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (state.kind !== "ready") return;
    if (selected.size === state.data.assets.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(state.data.assets.map((a) => a.id)));
  }, [state, selected.size]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const handleExport = useCallback(
    async (kind: "selected" | "all") => {
      if (state.kind !== "ready") return;
      const data = state.data;
      const filteredData =
        kind === "selected" && selected.size > 0
          ? { ...data, assets: data.assets.filter((a) => selected.has(a.id)) }
          : data;
      setExporting(true);
      try {
        const res = await fetch("/api/portfolio/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: data.name,
            data: filteredData,
            datasetScope: data.datasetScope,
            params: { contributor: data.name, scope: kind },
          }),
        });
        if (!res.ok) throw new Error("Export failed");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `sn-portfolio-${(data.name || "export")
          .replace(/\s+/g, "-")
          .toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : "Export failed",
        });
      } finally {
        setExporting(false);
      }
    },
    [state, selected],
  );

  return (
    <>
      <TopBar
        title="Portfolio Tracker"
        subtitle="Analyze any Adobe Stock contributor's portfolio"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Track a contributor"
          description="Search by contributor name, numeric contributor ID, or paste a stock.adobe.com/contributor URL."
        />

        <PortfolioSearchForm
          query={query}
          onQueryChange={setQuery}
          onSubmit={onSubmit}
          loading={state.kind === "loading"}
        />

        {state.kind === "idle" ? (
          <div className="space-y-4">
            <DataQualityBanner
              level="demo"
              providerName="Mock data provider"
              message="Portfolio numbers shown here are generated demo data. They are not real contributor stats."
            />
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
              Enter a contributor to see their stats, top assets, content
              breakdown, and most-used keywords.
            </div>
          </div>
        ) : null}

        {state.kind === "loading" ? (
          <div className="space-y-4">
            <p className="text-xs text-muted-foreground">
              Looking up {state.describe}…
            </p>
            <Skeleton className="h-28 w-full" />
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-72 w-full" />
              ))}
            </div>
          </div>
        ) : null}

        {state.kind === "not-found" ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">No contributor matched.</p>
            <p className="mt-1">
              We couldn&apos;t find {state.describe}
              {state.provider ? ` in ${state.provider}` : ""}. Try a different
              name or paste the contributor URL from stock.adobe.com.
            </p>
          </div>
        ) : null}

        {state.kind === "unsupported" ? (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-6 text-sm text-violet-900">
            <p className="text-xs font-semibold uppercase tracking-wide">
              Provider not supported · {state.provider ?? "Active provider"}
            </p>
            <p className="mt-1">{state.reason}</p>
            <p className="mt-2 text-xs">
              Switch to a different provider or import a CSV via{" "}
              <span className="font-medium">/import</span> to use the manual
              provider for contributor analytics.
            </p>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {state.message}
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <div className="space-y-6">
            <DataQualityBanner
              level={state.data.dataQuality}
              providerName={state.data.providerName}
            />

            {state.data.notice ? (
              <div
                role="status"
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900"
              >
                <p className="font-semibold uppercase tracking-wide">
                  Partial support · {state.data.providerName}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug">
                  {state.data.notice}
                </p>
              </div>
            ) : null}

            <PortfolioOverview data={state.data} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <PortfolioContentBreakdown data={state.data} />
              <PortfolioBestSellers data={state.data} />
            </div>

            <PortfolioMonthlyTrends data={state.data} />

            <PortfolioKeywordAnalysis data={state.data} />

            <PortfolioAssetGrid
              data={state.data}
              selected={selected}
              onToggleSelect={toggleSelect}
              onSelectAll={selectAll}
              onClearSelection={clearSelection}
              onExport={handleExport}
              exporting={exporting}
            />

            <PortfolioCompare primaryContributor={state.data.name} />
          </div>
        ) : null}
      </div>
    </>
  );
}
