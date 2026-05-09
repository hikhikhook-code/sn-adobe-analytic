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
  History,
  Upload,
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
import { formatNumber, timeAgo } from "@/lib/utils";
import type { ProviderTrendingResult } from "@/lib/providers/types";

interface DashboardStats {
  signedIn: boolean;
  hasImportedData: boolean;
  searchesToday: number;
  savedAssets: number;
  exportsMade: number;
  trackedContributors: number;
  recentSearches: {
    id: string;
    keyword: string;
    sort: string;
    contentType: string;
    aiFilter: string;
    resultCount: number | null;
    createdAt: string;
  }[];
}

export default function DashboardPage() {
  const [trending, setTrending] = useState<ProviderTrendingResult | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/search/trending")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ProviderTrendingResult | null) => {
        if (!cancelled && j) setTrending(j);
      })
      .catch(() => {});
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DashboardStats | null) => {
        if (!cancelled && j) setStats(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items = trending?.trending.slice(0, 6) ?? [];
  // Stat counters reflect the user's own activity — once they're signed in
  // and we're pulling from the DB, those numbers are authoritative.
  const statQuality = stats?.signedIn ? "verified" : "demo";

  return (
    <>
      <TopBar title="Dashboard" subtitle="Your Adobe Stock analytics overview" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Welcome back"
          description="Quick stats across your searches, saved items, exports, and tracked contributors."
          actions={
            <Button asChild variant="accent">
              <Link href="/search">
                <Search className="h-4 w-4" />
                New search
              </Link>
            </Button>
          }
        />

        {stats?.signedIn ? (
          <DataQualityBanner
            level="verified"
            providerName={
              stats.hasImportedData
                ? "Your account · User imported data"
                : "Your account"
            }
            message={
              stats.hasImportedData
                ? "Activity counters reflect your account; trending uses your imported data."
                : "Activity counters reflect your account. Trending data is still demo until you import a CSV."
            }
          />
        ) : (
          <DataQualityBanner
            level="demo"
            providerName="Mock data provider"
            message="Sign in and import a CSV to see your real activity counters and verified analytics on this page."
          />
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {!stats ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </>
          ) : (
            <>
              <StatCard
                icon={Search}
                label="Searches today"
                value={formatNumber(stats.searchesToday)}
                hint={stats.signedIn ? "From your history" : "Sign in to track"}
                tone="orange"
                dataQuality={statQuality}
              />
              <StatCard
                icon={Heart}
                label="Saved assets"
                value={formatNumber(stats.savedAssets)}
                hint="Across all searches"
                tone="teal"
                dataQuality={statQuality}
              />
              <StatCard
                icon={Download}
                label="Exports made"
                value={formatNumber(stats.exportsMade)}
                hint="CSV downloads"
                tone="blue"
                dataQuality={statQuality}
              />
              <StatCard
                icon={Users}
                label="Tracked contributors"
                value={formatNumber(stats.trackedContributors)}
                hint="Unique among saved"
                tone="navy"
                dataQuality={statQuality}
              />
            </>
          )}
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
                  <CardDescription>
                    {trending?.providerName ?? "Top-rising searches"}
                  </CardDescription>
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
              <Button asChild variant="accent" className="justify-start">
                <Link href="/import">
                  <Upload className="h-4 w-4" />
                  Import your CSV
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Recent searches
                </CardTitle>
                <CardDescription>
                  Your last 8 searches, persisted to your account.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {!stats ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-md" />
                ))}
              </div>
            ) : !stats.signedIn ? (
              <p className="text-sm text-muted-foreground">
                Sign in to persist your search history across devices.
              </p>
            ) : stats.recentSearches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No searches yet. Try one from{" "}
                <Link
                  href="/search"
                  className="font-medium text-accent-blue hover:underline"
                >
                  the search page
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {stats.recentSearches.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
                  >
                    <Link
                      href={`/search?q=${encodeURIComponent(s.keyword)}`}
                      className="font-medium hover:underline"
                    >
                      {s.keyword}
                    </Link>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{s.sort}</span>
                      <span>·</span>
                      <span>{s.contentType}</span>
                      {s.resultCount != null ? (
                        <>
                          <span>·</span>
                          <span>{formatNumber(s.resultCount)} results</span>
                        </>
                      ) : null}
                      <span>·</span>
                      <span>{timeAgo(s.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
