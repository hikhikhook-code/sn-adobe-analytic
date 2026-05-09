"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
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
import { formatNumber, cn } from "@/lib/utils";
import type { ProviderHeatmapResult } from "@/lib/providers/types";

function competitionColorBg(level: number): string {
  if (level <= 33) return "from-emerald-500 to-emerald-600";
  if (level <= 66) return "from-amber-500 to-orange-500";
  return "from-rose-500 to-rose-600";
}

function trendIcon(t: "up" | "down" | "stable") {
  if (t === "up") return <TrendingUp className="h-3 w-3" />;
  if (t === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

export default function HeatmapPage() {
  const [data, setData] = useState<ProviderHeatmapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/heatmap");
        if (!res.ok) throw new Error(`Heat map failed (${res.status})`);
        const json: ProviderHeatmapResult = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const niches = data?.niches ?? [];
  const max = niches.length ? Math.max(...niches.map((n) => n.downloads)) : 1;

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

        <DataQualityBanner
          level={data?.dataQuality ?? "demo"}
          providerName={data?.providerName ?? "Mock data provider"}
          message="Demand and competition scores are derived from synthetic demo data. They are not real Adobe Stock niche metrics."
        />

        {error && (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-full w-full rounded-xl" />
            ))}
          </div>
        )}

        {data && niches.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            No niches available yet.
          </div>
        )}

        {niches.length > 0 && (
          <div className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {niches.map((n) => {
              const sizeRatio = n.downloads / max;
              const span =
                sizeRatio > 0.7
                  ? "row-span-2"
                  : sizeRatio > 0.45
                    ? "row-span-2 sm:row-span-1"
                    : "";
              return (
                <Link
                  key={n.keyword}
                  href={`/search?q=${encodeURIComponent(n.keyword)}`}
                  className={cn(
                    "group relative flex flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white transition-transform hover:scale-[1.02]",
                    competitionColorBg(n.competition),
                    span,
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight line-clamp-2">
                      {n.keyword}
                    </p>
                    <div className="flex items-center gap-1">
                      <Badge variant="default" className="bg-white/20 text-white">
                        {trendIcon(n.trend)}
                      </Badge>
                      <DataQualityBadge
                        level={data?.dataQuality ?? "demo"}
                        size="xs"
                        showLabel={false}
                        className="!border-white/40 !bg-white/15 !text-white"
                      />
                    </div>
                  </div>
                  <div className="text-xs opacity-90">
                    <p className="text-base font-bold">{formatNumber(n.downloads)} dl</p>
                    <p>
                      {formatNumber(n.assets)} assets · comp {n.competition}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Opportunity finder</CardTitle>
                <CardDescription>High demand, low competition</CardDescription>
              </div>
              <DataQualityBadge level={data?.dataQuality ?? "demo"} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {niches
                .filter((n) => n.competition <= 40)
                .sort((a, b) => b.downloads - a.downloads)
                .slice(0, 5)
                .map((n) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{n.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(n.downloads)} downloads · comp {n.competition}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        Explore <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              {niches.length === 0 && !data ? (
                <Skeleton className="h-16 w-full" />
              ) : null}
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
              <DataQualityBadge level={data?.dataQuality ?? "demo"} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {niches
                .filter((n) => n.competition >= 70)
                .sort((a, b) => b.competition - a.competition)
                .slice(0, 5)
                .map((n) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{n.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(n.assets)} assets · comp {n.competition}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        View <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
              {niches.length === 0 && !data ? (
                <Skeleton className="h-16 w-full" />
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
