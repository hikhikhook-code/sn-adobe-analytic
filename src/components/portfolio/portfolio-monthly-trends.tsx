"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { formatNumber } from "@/lib/utils";
import type { ProviderContributorResult } from "@/lib/providers/types";

interface PortfolioMonthlyTrendsProps {
  data: ProviderContributorResult;
}

/**
 * 12-month bar chart of the contributor's per-month download totals. The
 * underlying numbers are bucket-summed by `uploadDate` so they are best
 * interpreted as activity-shaped trend rather than verified time-series
 * sales — we tag the panel `Estimated` regardless of provider quality.
 *
 * Renders an honest "Unavailable" panel when the provider cannot supply
 * verified downloads (e.g. Public Metadata) — fake bars would mislead.
 */
export function PortfolioMonthlyTrends({ data }: PortfolioMonthlyTrendsProps) {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;
  const hasData =
    data.monthlyTrend.length > 0 &&
    data.monthlyTrend.some((m) => m.downloads > 0);
  const max = Math.max(1, ...data.monthlyTrend.map((m) => m.downloads));

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Monthly trends</CardTitle>
          <CardDescription>
            {downloadsAvailable
              ? "Downloads per upload month (last 12)"
              : "Time-series downloads not available from this provider"}
          </CardDescription>
        </div>
        <DataQualityBadge
          level={downloadsAvailable ? "estimated" : "public_metadata"}
          size="sm"
        />
      </CardHeader>
      <CardContent>
        {!downloadsAvailable || !hasData ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/30 px-4 py-8 text-center text-xs text-muted-foreground">
            {downloadsAvailable
              ? "No upload activity in the last 12 months on the visible asset list."
              : "Verified time-series downloads are unavailable. Import a CSV via /import to populate this view."}
          </div>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {data.monthlyTrend.map((m) => {
              const h = (m.downloads / max) * 100;
              return (
                <div
                  key={m.month}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={`${m.month}: ${formatNumber(m.downloads)} downloads`}
                >
                  <div
                    className="w-full rounded-t bg-accent-blue/80"
                    style={{ height: `${Math.max(h, 2)}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {m.month}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
