"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrendingUp, ArrowRight } from "lucide-react";
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
import { formatNumber } from "@/lib/utils";
import type {
  ProviderHeatmapResult,
  ProviderTrendingResult,
} from "@/lib/providers/types";

export default function TrendingPage() {
  const [trending, setTrending] = useState<ProviderTrendingResult | null>(null);
  const [heatmap, setHeatmap] = useState<ProviderHeatmapResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [t, h] = await Promise.all([
          fetch("/api/search/trending").then((r) => {
            if (!r.ok) throw new Error(`Trending failed (${r.status})`);
            return r.json() as Promise<ProviderTrendingResult>;
          }),
          fetch("/api/heatmap").then((r) => {
            if (!r.ok) throw new Error(`Heat map failed (${r.status})`);
            return r.json() as Promise<ProviderHeatmapResult>;
          }),
        ]);
        if (!cancelled) {
          setTrending(t);
          setHeatmap(h);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const items = trending?.trending ?? [];
  const niches = (heatmap?.niches ?? []).filter((n) => n.trend === "up");

  return (
    <>
      <TopBar
        title="Trending"
        subtitle="Keyword & niche trends across Adobe Stock"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Trending right now"
          description="Watch which keywords and niches are gaining momentum."
        />

        <DataQualityBanner
          level={trending?.dataQuality ?? "demo"}
          providerName={trending?.providerName ?? "Mock data provider"}
          message="Search-volume and growth percentages are synthetic demo signals. They do not reflect real Adobe Stock search trends."
        />

        {error && (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
              <div>
                <CardTitle>Trending keywords</CardTitle>
                <CardDescription>Highest search-volume growth</CardDescription>
              </div>
              <DataQualityBadge level={trending?.dataQuality ?? "demo"} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {!trending && !error
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))
                : null}
              {trending && items.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                  No trending keywords right now.
                </p>
              ) : null}
              {items.map((t, i) => (
                <div
                  key={t.keyword}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(t.volume)} monthly searches
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="gap-1">
                      <TrendingUp className="h-3 w-3" />+{t.growth}%
                    </Badge>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/search?q=${encodeURIComponent(t.keyword)}`}>
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
                <CardDescription>Niches gaining demand week over week</CardDescription>
              </div>
              <DataQualityBadge level={heatmap?.dataQuality ?? "demo"} size="sm" />
            </CardHeader>
            <CardContent className="space-y-2">
              {!heatmap && !error
                ? Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))
                : null}
              {heatmap && niches.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-6 text-center text-xs text-muted-foreground">
                  No rising niches right now.
                </p>
              ) : null}
              {niches
                .sort((a, b) => b.downloads - a.downloads)
                .map((n, i) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{n.keyword}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(n.downloads)} downloads · comp {n.competition}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
