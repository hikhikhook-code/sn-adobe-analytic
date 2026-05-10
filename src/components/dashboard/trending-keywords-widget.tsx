"use client";

import Link from "next/link";
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { UnavailableCardState } from "@/components/dashboard/unavailable-card-state";
import { formatNumber } from "@/lib/utils";
import type {
  DataQuality,
  TrendingKeyword,
} from "@/lib/providers/types";

interface TrendingKeywordsWidgetProps {
  items: TrendingKeyword[];
  available: boolean;
  dataQuality: DataQuality;
  providerName: string;
}

/**
 * Dashboard "Trending keywords" widget. Consumes the dashboard-scoped
 * subset of trending data served by `/api/dashboard` (not the full
 * `/api/search/trending` payload) so the widget stays aligned with the
 * active dataset scope.
 *
 * Each row links to `/search?q=<keyword>` for a one-click re-search.
 * When the provider can't supply a trending signal, we render an honest
 * "Unavailable" state rather than hiding the card or substituting demo
 * numbers.
 */
export function TrendingKeywordsWidget({
  items,
  available,
  dataQuality,
  providerName,
}: TrendingKeywordsWidgetProps) {
  const rows = items.slice(0, 6);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle>Trending keywords</CardTitle>
              <DataQualityBadge level={dataQuality} size="sm" />
            </div>
            <CardDescription>{providerName}</CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/trending">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {!available ? (
          <div className="px-5 pb-4">
            <UnavailableCardState message="Trending keywords are not supplied by the active provider." />
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-muted-foreground">
            No trending keywords right now.
          </p>
        ) : (
          <ul>
            {rows.map((t, i) => {
              const volumeOk = t.metricsAvailable !== false;
              const growthPositive = t.growth >= 0;
              const GrowthIcon = growthPositive ? TrendingUp : TrendingDown;
              return (
                <li
                  key={t.keyword}
                  className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <Link
                      href={`/search?q=${encodeURIComponent(t.keyword)}`}
                      className="truncate text-sm font-medium hover:underline"
                    >
                      {t.keyword}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {volumeOk ? (
                      <span>{formatNumber(t.volume)} vol</span>
                    ) : (
                      <span className="italic">Volume unavailable</span>
                    )}
                    {volumeOk ? (
                      <Badge
                        variant={growthPositive ? "success" : "danger"}
                        className="gap-1"
                      >
                        <GrowthIcon className="h-3 w-3" />
                        {growthPositive ? "+" : ""}
                        {t.growth}%
                      </Badge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
