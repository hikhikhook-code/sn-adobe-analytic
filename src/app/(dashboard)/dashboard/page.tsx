"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Search,
  Heart,
  Download,
  Users,
  TrendingUp,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataQualityBadge,
  DataQualityBanner,
} from "@/components/ui/data-quality";
import { formatNumber } from "@/lib/utils";
import type { ProviderTrendingResult } from "@/lib/providers/types";

export default function DashboardPage() {
  const [trending, setTrending] = useState<ProviderTrendingResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/search/trending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ProviderTrendingResult | null) => {
        if (!cancelled && j) setTrending(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = trending?.trending.slice(0, 6) ?? [];

  return (
    <>
      <TopBar title="Dashboard" subtitle="Your Adobe Stock analytics overview" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Welcome back"
          description="Quick stats across your searches, saved items, and tracked contributors."
          actions={
            <Button asChild variant="accent">
              <Link href="/search">
                <Search className="h-4 w-4" />
                New search
              </Link>
            </Button>
          }
        />

        <DataQualityBanner
          level="demo"
          providerName="Mock data provider"
          message="The dashboard counters and trending list are placeholders for the demo build. Real activity stats will populate once history is recorded for your account."
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Search}
            label="Searches today"
            value="0"
            hint="Resets daily"
            tone="orange"
            dataQuality="demo"
          />
          <StatCard
            icon={Heart}
            label="Saved assets"
            value="0"
            hint="Across all searches"
            tone="teal"
            dataQuality="demo"
          />
          <StatCard
            icon={Download}
            label="Exports made"
            value="0"
            hint="CSV downloads"
            tone="blue"
            dataQuality="demo"
          />
          <StatCard
            icon={Users}
            label="Tracked contributors"
            value="0"
            hint="Portfolio Tracker"
            tone="navy"
            dataQuality="demo"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>Trending keywords</CardTitle>
                    <DataQualityBadge
                      level={trending?.dataQuality ?? "demo"}
                      size="sm"
                    />
                  </div>
                  <CardDescription>Top-rising searches across Adobe Stock</CardDescription>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/trending">
                    View all <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {!trending ? (
                <div className="space-y-2 px-5 pb-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <p className="px-5 py-6 text-center text-xs text-muted-foreground">
                  No trending keywords right now.
                </p>
              ) : (
                <ul>
                  {items.map((t, i) => (
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
                        <span>{formatNumber(t.volume)} vol</span>
                        <Badge variant="success" className="gap-1">
                          <TrendingUp className="h-3 w-3" />+{t.growth}%
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Get started fast</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button asChild variant="outline" className="justify-start">
                <Link href="/search">
                  <Search className="h-4 w-4" />
                  New search
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/portfolio">
                  <Users className="h-4 w-4" />
                  Track contributor
                </Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/heatmap">
                  <Sparkles className="h-4 w-4" />
                  Explore heat map
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
