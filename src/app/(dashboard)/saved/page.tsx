"use client";

import Link from "next/link";
import { Heart } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { useFavorites } from "@/hooks/use-favorites";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DataQualityBadge,
  DataQualityBanner,
} from "@/components/ui/data-quality";
import { formatNumber, timeAgo } from "@/lib/utils";

export default function SavedPage() {
  const { favorites, toggle, loaded } = useFavorites();

  return (
    <>
      <TopBar
        title="Saved"
        subtitle="Assets you've favorited across searches"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Saved assets"
          description="Heart any asset on the search page to keep track of it here."
          actions={
            <Button asChild variant="accent">
              <Link href="/search">Find more</Link>
            </Button>
          }
        />

        <DataQualityBanner
          level="demo"
          providerName="Mock data provider"
          message="Saved-asset numbers were captured from the demo data shown on the search page. They are not real Adobe Stock metrics."
        />

        {!loaded ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : favorites.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
            <Heart className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No saved assets yet. Run a search and tap the heart icon on any result.
            </p>
            <Button asChild variant="accent" className="mt-4">
              <Link href="/search">Start searching</Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {favorites.map((f) => (
              <div
                key={f.assetId}
                className="overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
              >
                <div className="relative aspect-square overflow-hidden bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.thumbnailUrl}
                    alt={f.title}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      toggle({
                        id: f.assetId,
                        thumbnailUrl: f.thumbnailUrl,
                        title: f.title,
                        downloads: f.downloads,
                        performanceScore: f.performanceScore,
                        downloadsPerMonth: 0,
                        categories: [],
                        contentType: "photo",
                        uploadDate: new Date().toISOString(),
                        contributorName: f.contributorName ?? "",
                        contributorId: "",
                        isPremium: false,
                        isAiGenerated: false,
                        keywords: f.keywords,
                        adobeStockUrl: `https://stock.adobe.com/${f.assetId}`,
                      })
                    }
                    className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md border border-border bg-white text-rose-500 shadow-sm hover:text-rose-600"
                    aria-label="Unsave"
                  >
                    <Heart className="h-4 w-4 fill-current" />
                  </button>
                </div>
                <div className="space-y-2 p-3">
                  <p className="line-clamp-2 text-sm font-medium">{f.title}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="accent">{formatNumber(f.downloads)} dl</Badge>
                    <Badge variant="warning">{f.performanceScore}/100</Badge>
                    <DataQualityBadge level="demo" size="xs" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {f.contributorName ?? "Unknown"} · saved{" "}
                    {f.savedAt ? timeAgo(f.savedAt) : "recently"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
