"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  Download,
  Heart,
  Minus,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { cn, formatNumber } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";
import type {
  HeatmapTile,
  ProviderHeatmapResult,
} from "@/lib/providers/types";
import type { SearchAsset } from "@/types/search";

interface NicheDetailDrawerProps {
  open: boolean;
  loading: boolean;
  niche: HeatmapTile | null;
  /** The provider envelope from the detail response, for badges / banners. */
  envelope?: Pick<
    ProviderHeatmapResult,
    "dataQuality" | "providerName" | "capabilities" | "notice" | "appliedFilters"
  > | null;
  onClose: () => void;
  onExport: () => void;
  exporting?: boolean;
  isFavorited?: (id: string) => boolean;
  onToggleFavorite?: (asset: SearchAsset) => void;
}

function trendIcon(t: HeatmapTile["trend"]) {
  if (t === "up") return <TrendingUp className="h-3 w-3" />;
  if (t === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

function trendLabel(t: HeatmapTile["trend"]) {
  return t === "up" ? "Rising" : t === "down" ? "Falling" : "Stable";
}

/**
 * Drilldown for a single niche. Wraps a Radix Dialog in a right-aligned
 * sheet so the user can keep the heat-map in view behind it.
 *
 * Renders four sections:
 *   1. Summary stats (downloads, assets, competition, trend, opportunity)
 *   2. Top assets grid
 *   3. Related keywords
 *   4. Content-type breakdown
 *
 * Honors `metricsAvailable` / `trendAvailable` so cells show "Unavailable"
 * instead of fake zeros.
 */
export function NicheDetailDrawer({
  open,
  loading,
  niche,
  envelope,
  onClose,
  onExport,
  exporting,
  isFavorited,
  onToggleFavorite,
}: NicheDetailDrawerProps) {
  // Local fade-in flag so the drawer content doesn't pop in before
  // measure. Pure cosmetic — ok to use even when SSR.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (open) setMounted(true);
    else setMounted(false);
  }, [open]);

  const downloadsAvailable =
    envelope?.capabilities?.downloadsAvailable !== false;
  const showDownload = (n: number, available: boolean) =>
    !downloadsAvailable || !available ? "Unavailable" : formatNumber(n);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed right-0 top-0 z-50 flex h-full w-full max-w-3xl flex-col overflow-hidden bg-card shadow-2xl",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-right",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right",
            mounted && "translate-x-0",
          )}
        >
          <Dialog.Title className="sr-only">
            {niche ? `Niche detail: ${niche.keyword}` : "Niche detail"}
          </Dialog.Title>
          <Dialog.Description className="sr-only">
            Detailed metrics, top assets, related keywords, and content-type
            breakdown for the selected niche.
          </Dialog.Description>

          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-6 py-4">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Niche detail
              </p>
              <h2 className="text-xl font-semibold capitalize">
                {niche?.keyword ?? "\u2014"}
              </h2>
              {envelope ? (
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <DataQualityBadge level={envelope.dataQuality} size="xs" />
                  <span>{envelope.providerName}</span>
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={onExport}
                disabled={exporting || !niche}
              >
                <Download className="h-4 w-4" />
                {exporting ? "Exporting\u2026" : "Export CSV"}
              </Button>
              <Dialog.Close asChild>
                <Button size="icon" variant="ghost" aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {envelope?.notice ? (
              <div
                role="status"
                className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                {envelope.notice}
              </div>
            ) : null}

            {loading || !niche ? (
              <div className="space-y-3">
                <div className="h-24 animate-pulse rounded-xl bg-muted/60" />
                <div className="h-40 animate-pulse rounded-xl bg-muted/60" />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary stats */}
                <section>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat
                      label="Total downloads"
                      value={showDownload(
                        niche.downloads,
                        niche.metricsAvailable,
                      )}
                    />
                    <Stat
                      label="Assets"
                      value={formatNumber(niche.assets)}
                    />
                    <Stat
                      label="Competition"
                      value={`${niche.competition}/100`}
                    />
                    <Stat
                      label="Avg performance"
                      value={
                        niche.metricsAvailable && niche.avgPerformanceScore > 0
                          ? `${niche.avgPerformanceScore}/100`
                          : "Unavailable"
                      }
                      hint={
                        niche.metricsAvailable && niche.avgPerformanceScore > 0
                          ? "Estimated"
                          : undefined
                      }
                    />
                    <Stat
                      label="Opportunity"
                      value={`${niche.opportunityScore}/100`}
                      hint="Estimated"
                    />
                    <Stat
                      label="Trend"
                      value={
                        niche.trendAvailable
                          ? trendLabel(niche.trend)
                          : "Unavailable"
                      }
                      icon={
                        niche.trendAvailable ? trendIcon(niche.trend) : undefined
                      }
                    />
                  </div>
                </section>

                {/* Top assets */}
                <section>
                  <header className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Top performing assets</h3>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/search?q=${encodeURIComponent(niche.keyword)}`}
                        title="Open the Search page pre-filtered to this niche's keyword"
                      >
                        View search results{" "}
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </header>
                  {niche.topAssets.length === 0 ? (
                    <p className="rounded-md border border-dashed border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
                      No assets to show for this niche under the current filters.
                    </p>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {niche.topAssets.map((a) => (
                        <NicheAssetRow
                          key={a.id}
                          asset={a}
                          downloadsAvailable={downloadsAvailable}
                          isFavorited={isFavorited?.(a.id) ?? false}
                          onToggleFavorite={
                            onToggleFavorite
                              ? () => onToggleFavorite(a)
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </section>

                {/* Related keywords */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Related keywords</h3>
                  {niche.relatedKeywords.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No co-occurring keywords found in the current scope.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {niche.relatedKeywords.map((kw) => (
                        <Link
                          key={kw}
                          href={`/search?q=${encodeURIComponent(kw)}`}
                          className="rounded-full border border-border/60 bg-muted/40 px-3 py-1 text-xs hover:bg-muted"
                        >
                          {kw}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>

                {/* Content-type breakdown */}
                <section>
                  <h3 className="mb-2 text-sm font-semibold">
                    Content-type breakdown
                  </h3>
                  {niche.contentTypeBreakdown.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No content-type data available for this niche.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {niche.contentTypeBreakdown.map((row) => {
                        const total = niche.contentTypeBreakdown.reduce(
                          (s, c) => s + c.count,
                          0,
                        );
                        const pct = total > 0
                          ? Math.round((row.count / total) * 100)
                          : 0;
                        return (
                          <div
                            key={row.contentType}
                            className="flex items-center gap-3"
                          >
                            <span className="w-32 flex-none text-xs capitalize text-muted-foreground">
                              {row.contentType}
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full bg-accent-blue"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="w-16 flex-none text-right text-xs tabular-nums">
                              {row.count} ({pct}%)
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface StatProps {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
}
function Stat({ label, value, hint, icon }: StatProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 flex items-center gap-1.5 text-base font-semibold">
        {icon}
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface NicheAssetRowProps {
  asset: SearchAsset;
  downloadsAvailable: boolean;
  isFavorited: boolean;
  onToggleFavorite?: () => void;
}
function NicheAssetRow({
  asset,
  downloadsAvailable,
  isFavorited,
  onToggleFavorite,
}: NicheAssetRowProps) {
  const hasMetrics = asset.metricsAvailable !== false;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-2">
      {asset.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.thumbnailUrl}
          alt={asset.title}
          className="h-16 w-16 flex-none rounded-md object-cover"
        />
      ) : (
        <div className="grid h-16 w-16 flex-none place-items-center rounded-md bg-muted text-xs text-muted-foreground">
          —
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={asset.title}>
          {asset.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {asset.contentType} · {asset.contributorName}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-mono">
            {!downloadsAvailable || !hasMetrics
              ? "Unavailable"
              : `${formatNumber(asset.downloads)} dl`}
          </Badge>
          <Badge variant="outline">
            {!hasMetrics
              ? "Unavailable"
              : `Perf ${asset.performanceScore}`}
          </Badge>
        </div>
      </div>
      {onToggleFavorite ? (
        <Button
          size="icon"
          variant="ghost"
          aria-label={isFavorited ? "Remove favorite" : "Add favorite"}
          onClick={onToggleFavorite}
        >
          <Heart
            className={cn(
              "h-4 w-4",
              isFavorited && "fill-rose-500 text-rose-500",
            )}
          />
        </Button>
      ) : null}
    </div>
  );
}
