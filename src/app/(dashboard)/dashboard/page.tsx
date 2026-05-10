"use client";

import Link from "next/link";
import {
  AlertTriangle,
  Database,
  Download,
  Heart,
  Image as ImageIcon,
  Layers,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { DataQualityBanner } from "@/components/ui/data-quality";
import { DataSourceBanner } from "@/components/layout/data-source-banner";
import { NoDataState } from "@/components/ui/no-data-state";
import { PerformanceAnalytics } from "@/components/dashboard/performance-analytics";
import { SavedAssetsPreview } from "@/components/dashboard/saved-assets-preview";
import { RecentSearchesWidget } from "@/components/dashboard/recent-searches-widget";
import { TrendingKeywordsWidget } from "@/components/dashboard/trending-keywords-widget";
import { PlanUsageCard } from "@/components/dashboard/plan-usage-card";
import { QuickActionsCard } from "@/components/dashboard/quick-actions-card";
import { formatNumber } from "@/lib/utils";
import { useDashboardData } from "@/hooks/use-dashboard-data";

/**
 * `/dashboard` — Adobe Stock analytics overview.
 *
 * Data comes entirely from `/api/dashboard` (PR #13). The page decomposes
 * the response into:
 *
 *   1. Data-source banner — reuses `DataSourceBanner` so the user always
 *      sees which dataset / provider is in play.
 *   2. Quick stats cards — counters + dataset scope + imported assets.
 *   3. Performance analytics — provider-derived rollup (totals, top
 *      performers, content breakdown, keyword highlights). Renders
 *      honest `Unavailable` states when `*Available: false`.
 *   4. Recent searches + Saved assets preview (DB-backed, always
 *      truthful).
 *   5. Trending keywords widget + Plan usage preview + Quick actions.
 *
 * The "Plan usage" card is deliberately labeled as a preview — plan
 * gating isn't wired up yet, and we don't want the UI to imply limits
 * are being enforced when they aren't.
 */
export default function DashboardPage() {
  const { data: stats, user, loading, error, refetch } = useDashboardData();

  if (loading && !stats) {
    return <DashboardSkeleton />;
  }

  if (error && !stats) {
    return (
      <>
        <TopBar
          title="Dashboard"
          subtitle="Your Adobe Stock analytics overview"
        />
        <div className="space-y-4 p-6">
          <Card>
            <CardContent className="flex flex-col gap-3 p-6 text-sm">
              <div className="flex items-center gap-2 font-medium text-rose-700">
                <AlertTriangle className="h-4 w-4" />
                Couldn&apos;t load dashboard analytics.
              </div>
              <p className="text-xs text-muted-foreground">
                {error}. Check your connection, or try again.
              </p>
              <div>
                <Button size="sm" onClick={refetch}>
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (!stats) {
    return <DashboardSkeleton />;
  }

  const { analytics, provider } = stats;
  const statQuality = stats.signedIn ? "verified" : "demo";
  const downloadsAvailable = provider.capabilities?.downloadsAvailable !== false;

  const datasetScopeLabel =
    stats.datasetScope.kind === "specific"
      ? stats.datasetName ?? "Selected dataset"
      : stats.datasetScope.kind === "all"
        ? stats.hasImportedData
          ? "All imported datasets"
          : "No imports yet"
        : "Demo data";

  return (
    <>
      <TopBar title="Dashboard" subtitle="Your Adobe Stock analytics overview" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Welcome back"
          description="Live analytics across your searches, imports, saved assets, and top performing keywords."
          actions={
            <Button asChild variant="accent">
              <Link href="/search">
                <Search className="h-4 w-4" />
                New search
              </Link>
            </Button>
          }
        />

        {stats.signedIn ? (
          <DataSourceBanner
            scope={stats.datasetScope}
            datasetName={stats.datasetName}
            hasAnyDatasets={stats.hasImportedData}
            reason={stats.scopeReason}
            providerName={provider.name}
            dataQuality={provider.dataQuality}
          />
        ) : (
          <DataQualityBanner
            level="demo"
            providerName={provider.name}
            message="Sign in and import a CSV to see your real activity counters and verified analytics on this page."
          />
        )}

        {/* Quick stats grid. Six tiles (searches today, saved, exports,
            tracked contributors, imported assets, dataset scope) — two
            rows of 3 on desktop, collapses gracefully on mobile. The
            dataset-scope tile uses the provider data-quality so it
            matches the banner. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
          <StatCard
            icon={ImageIcon}
            label="Imported assets"
            value={formatNumber(stats.importedAssets)}
            hint={
              stats.hasImportedData
                ? "In active dataset scope"
                : "Import a CSV to enable"
            }
            tone="purple"
            dataQuality={stats.importedAssets > 0 ? "verified" : "demo"}
          />
          <StatCard
            icon={
              stats.datasetScope.kind === "specific"
                ? Database
                : stats.datasetScope.kind === "all"
                  ? Layers
                  : Upload
            }
            label="Dataset scope"
            value={datasetScopeLabel}
            hint={provider.name}
            tone="rose"
            dataQuality={provider.dataQuality}
          />
        </div>

        {(analytics as { noDataConfigured?: boolean }).noDataConfigured ? (
          <NoDataState page="dashboard" showDemoOption={stats.signedIn} />
        ) : (
          <PerformanceAnalytics
            analytics={analytics}
            fallbackNotice={
              provider.id === "official" && !analytics.notice
                ? "Dashboard analytics are limited on public-metadata sources. Import a CSV for verified figures."
                : undefined
            }
          />
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <RecentSearchesWidget
              items={stats.recentSearches}
              signedIn={stats.signedIn}
              providerName={provider.name}
            />
            <SavedAssetsPreview
              items={stats.savedAssetsPreview}
              signedIn={stats.signedIn}
              downloadsAvailable={downloadsAvailable}
            />
          </div>
          <div className="space-y-4">
            <TrendingKeywordsWidget
              items={analytics.trendingKeywords}
              available={analytics.trendingKeywordsAvailable}
              dataQuality={analytics.dataQuality}
              providerName={analytics.providerName}
            />
            <PlanUsageCard
              plan={user?.plan ?? "FREE"}
              searchesUsedToday={
                // Prefer the provider-backed session counter; fall back
                // to the dashboard's derived count so non-signed-in
                // users still see a credible number.
                user?.searchesUsedToday ?? stats.searchesToday
              }
              dailyLimit={null}
              signedIn={stats.signedIn}
            />
            <QuickActionsCard />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Full-page loading skeleton. Matches the final layout so the visual
 * jump when data lands is minimal (banner, 6 stat tiles, 1 large
 * analytics card, and a 2/1 column grid).
 */
function DashboardSkeleton() {
  return (
    <>
      <TopBar title="Dashboard" subtitle="Your Adobe Stock analytics overview" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Welcome back"
          description="Loading your Adobe Stock analytics…"
        />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Performance analytics</CardTitle>
            <CardDescription>Loading…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-52 w-full rounded-xl" />
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 w-full rounded-xl lg:col-span-2" />
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      </div>
    </>
  );
}
