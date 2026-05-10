"use client";

import Link from "next/link";
import { ArrowRight, Heart } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { formatNumber, timeAgo } from "@/lib/utils";
import type { DashboardSavedAsset } from "@/hooks/use-dashboard-data";

interface SavedAssetsPreviewProps {
  items: DashboardSavedAsset[];
  /** Whether the caller is signed in — drives the empty-state copy. */
  signedIn: boolean;
  /** Whether the provider can serve verified downloads. Controls whether
   *  we show the downloads counter or `—`. */
  downloadsAvailable: boolean;
}

/**
 * Dashboard preview of the user's most recently saved assets. Empty
 * states are distinct: guest vs signed-in-with-nothing-saved so the CTA
 * copy matches the user's state.
 */
export function SavedAssetsPreview({
  items,
  signedIn,
  downloadsAvailable,
}: SavedAssetsPreviewProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Heart className="h-4 w-4 text-rose-500" />
              Saved assets
            </CardTitle>
            <CardDescription>
              Your most recently saved assets across searches.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/saved">
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!signedIn ? (
          <EmptyState
            title="Sign in to see your saved assets"
            description="Saved assets are stored against your account. Sign in to sync them across devices."
            ctaHref="/auth/login"
            ctaLabel="Sign in"
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No saved assets yet"
            description="Tap the heart icon on any search result to bookmark it here."
            ctaHref="/search"
            ctaLabel="Start searching"
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.slice(0, 6).map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/10 p-2"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 flex-none rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium">
                      {item.title || "Untitled asset"}
                    </p>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {item.contributorName || "Unknown contributor"} ·{" "}
                    {timeAgo(item.savedAt)}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <DataQualityBadge
                      level={item.dataQuality}
                      size="xs"
                      showLabel
                    />
                    {downloadsAvailable ? (
                      <span>{formatNumber(item.downloads)} dl</span>
                    ) : (
                      <span className="italic">Downloads unavailable</span>
                    )}
                  </div>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="flex-none"
                >
                  <Link href="/saved">Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      <Button asChild variant="accent" size="sm" className="mt-1">
        <Link href={ctaHref}>{ctaLabel}</Link>
      </Button>
    </div>
  );
}
