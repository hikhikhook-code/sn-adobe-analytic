"use client";

import Link from "next/link";
import { Download, Gauge, PieChart, Sparkles, Trophy } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { UnavailableCardState } from "@/components/dashboard/unavailable-card-state";
import { cn, formatNumber } from "@/lib/utils";
import type {
  DataQuality,
  ProviderDashboardResult,
} from "@/lib/providers/types";

interface PerformanceAnalyticsProps {
  analytics: ProviderDashboardResult;
  /** Default notice copy, used when the provider didn't emit one. */
  fallbackNotice?: string;
}

/**
 * Performance Analytics section — the big rollup introduced by PR #13.
 *
 * Every panel checks the matching `*Available` flag on
 * `ProviderDashboardResult` and renders `UnavailableCardState` rather
 * than a fake zero when the active provider can't honestly supply the
 * figure. This preserves the app's hard rule about never claiming a
 * number is verified when it isn't.
 */
export function PerformanceAnalytics({
  analytics,
  fallbackNotice,
}: PerformanceAnalyticsProps) {
  const quality = analytics.dataQuality;
  const notice = analytics.notice ?? fallbackNotice;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle>Performance analytics</CardTitle>
              <DataQualityBadge level={quality} size="sm" />
            </div>
            <CardDescription>
              Portfolio rollup from{" "}
              <span className="font-medium">{analytics.providerName}</span> —
              scoped to the active dataset selection.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        {notice ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {notice}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <MetricBlock
            icon={Download}
            label="Total downloads"
            value={analytics.totalDownloads}
            available={analytics.totalDownloadsAvailable}
            quality={quality}
            unavailableMessage="Verified downloads are not supplied by this provider."
          />
          <MetricBlock
            icon={Gauge}
            label="Avg performance score"
            value={analytics.averagePerformanceScore}
            available={analytics.averagePerformanceScoreAvailable}
            quality={quality}
            suffix="/100"
            unavailableMessage="Average performance is not derivable from the active provider."
          />
          <MetricBlock
            icon={Sparkles}
            label="Assets in scope"
            value={analytics.importedAssets}
            available={analytics.importedAssetsAvailable}
            quality={quality}
            unavailableMessage="Scoped asset count is unavailable from the active provider."
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopPerformersPanel analytics={analytics} />
          <ContentBreakdownPanel analytics={analytics} />
        </div>

        <KeywordHighlightsPanel analytics={analytics} />
      </CardContent>
    </Card>
  );
}

interface MetricBlockProps {
  icon: React.ElementType;
  label: string;
  value: number;
  available: boolean;
  quality: DataQuality;
  suffix?: string;
  unavailableMessage: string;
}

function MetricBlock({
  icon: Icon,
  label,
  value,
  available,
  quality,
  suffix,
  unavailableMessage,
}: MetricBlockProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {label}
        </div>
        {available ? <DataQualityBadge level={quality} size="xs" /> : null}
      </div>
      {available ? (
        <p className="mt-1.5 text-2xl font-semibold tracking-tight text-navy">
          {formatNumber(value)}
          {suffix ? (
            <span className="ml-1 text-sm font-medium text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </p>
      ) : (
        <div className="mt-2">
          <UnavailableCardState message={unavailableMessage} />
        </div>
      )}
    </div>
  );
}

function TopPerformersPanel({
  analytics,
}: {
  analytics: ProviderDashboardResult;
}) {
  const available = analytics.topPerformersAvailable;
  const rows = analytics.topPerformers.slice(0, 5);
  const downloadsAvailable =
    analytics.capabilities?.downloadsAvailable !== false;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Trophy className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold">Top performing assets</h3>
        </div>
        {available ? (
          <DataQualityBadge level={analytics.dataQuality} size="xs" />
        ) : null}
      </div>
      {!available || rows.length === 0 ? (
        <UnavailableCardState
          message={
            !available
              ? "Top-performers ranking requires download or performance signal."
              : "No assets in the current scope. Import a CSV or switch datasets."
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <li
              key={row.asset.id}
              className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border/60 hover:bg-muted/40"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                {i + 1}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.asset.thumbnailUrl}
                alt=""
                loading="lazy"
                className="h-10 w-10 flex-none rounded object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {row.asset.title || "Untitled asset"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {row.asset.contributorName || "Unknown contributor"} ·{" "}
                  {row.asset.contentType || "asset"}
                </p>
              </div>
              <div className="text-right text-xs">
                {downloadsAvailable && row.asset.metricsAvailable !== false ? (
                  <span className="block font-semibold">
                    {formatNumber(row.recentDownloads || row.asset.downloads)}
                    <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                      dl
                    </span>
                  </span>
                ) : (
                  <span className="block font-semibold text-muted-foreground">
                    —
                  </span>
                )}
                <span className="block text-[11px] text-muted-foreground">
                  {row.asset.performanceScore
                    ? `${row.asset.performanceScore}/100`
                    : "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContentBreakdownPanel({
  analytics,
}: {
  analytics: ProviderDashboardResult;
}) {
  const available = analytics.contentBreakdownAvailable;
  const rows = analytics.contentBreakdown.slice(0, 5);
  const maxPct = Math.max(1, ...rows.map((r) => r.pct));

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-accent-blue" />
          <h3 className="text-sm font-semibold">Content type breakdown</h3>
        </div>
        {available ? (
          <DataQualityBadge level={analytics.dataQuality} size="xs" />
        ) : null}
      </div>
      {!available || rows.length === 0 ? (
        <UnavailableCardState
          message={
            !available
              ? "Content-type breakdown requires imported metadata."
              : "No assets to group. Import a CSV to populate this chart."
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li key={row.type} className="text-xs">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="font-medium capitalize">
                  {row.type || "unknown"}
                </span>
                <span className="text-muted-foreground">
                  {formatNumber(row.count)} · {row.pct}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-accent-blue"
                  style={{ width: `${(row.pct / maxPct) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KeywordHighlightsPanel({
  analytics,
}: {
  analytics: ProviderDashboardResult;
}) {
  const available = analytics.keywordHighlightsAvailable;
  const rows = analytics.keywordHighlights.slice(0, 8);
  const downloadsAvailable =
    analytics.capabilities?.downloadsAvailable !== false;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Keyword highlights</h3>
        {available ? (
          <DataQualityBadge level={analytics.dataQuality} size="xs" />
        ) : null}
      </div>
      {!available || rows.length === 0 ? (
        <UnavailableCardState
          message={
            !available
              ? "Keyword highlights require imported asset metadata."
              : "No keywords found in the current scope."
          }
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {rows.map((k) => (
            <Link
              key={k.keyword}
              href={`/search?q=${encodeURIComponent(k.keyword)}`}
              className={cn(
                "group inline-flex items-center gap-2 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs transition-colors",
                "hover:border-accent-blue/40 hover:bg-accent-blue/5",
              )}
            >
              <span className="font-medium">{k.keyword}</span>
              <span className="text-muted-foreground">
                {formatNumber(k.assets)} assets
              </span>
              {downloadsAvailable && k.metricsAvailable ? (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {formatNumber(k.downloads)} dl
                </Badge>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
