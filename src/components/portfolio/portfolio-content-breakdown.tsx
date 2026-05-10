"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataQualityBadge } from "@/components/ui/data-quality";
import type { ProviderContributorResult } from "@/lib/providers/types";

interface PortfolioContentBreakdownProps {
  data: ProviderContributorResult;
}

/**
 * Maps every Adobe Stock content_type to one of the five PRD-listed
 * buckets (photo, illustration, vector, video, other). Anything we don't
 * recognize falls into "other" so the user always sees a full breakdown.
 */
const PRD_BUCKETS = ["photo", "illustration", "vector", "video", "other"] as const;
type PrdBucket = (typeof PRD_BUCKETS)[number];

function bucketFor(raw: string): PrdBucket {
  const t = raw.toLowerCase();
  if (t.includes("photo") || t === "image") return "photo";
  if (t.includes("illustration")) return "illustration";
  if (t.includes("vector")) return "vector";
  if (t.includes("video") || t.includes("motion")) return "video";
  return "other";
}

const LABELS: Record<PrdBucket, string> = {
  photo: "Photo",
  illustration: "Illustration",
  vector: "Vector",
  video: "Video",
  other: "Other",
};

const ACCENT: Record<PrdBucket, string> = {
  photo: "bg-sky-500",
  illustration: "bg-indigo-500",
  vector: "bg-fuchsia-500",
  video: "bg-amber-500",
  other: "bg-slate-400",
};

export function PortfolioContentBreakdown({ data }: PortfolioContentBreakdownProps) {
  const counts: Record<PrdBucket, number> = {
    photo: 0,
    illustration: 0,
    vector: 0,
    video: 0,
    other: 0,
  };

  // Prefer the breakdown the provider already computed; fall back to deriving
  // it from the asset list if the provider didn't include one.
  if (data.contentBreakdown.length > 0) {
    for (const b of data.contentBreakdown) {
      counts[bucketFor(b.type)] += b.count;
    }
  } else {
    for (const a of data.assets) {
      counts[bucketFor(a.contentType)] += 1;
    }
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Content breakdown</CardTitle>
          <CardDescription>Asset mix by media type</CardDescription>
        </div>
        <DataQualityBadge level={data.dataQuality} size="sm" />
      </CardHeader>
      <CardContent className="space-y-3">
        {PRD_BUCKETS.map((bucket) => {
          const count = counts[bucket];
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <div key={bucket} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span>{LABELS[bucket]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {count} · {pct}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full ${ACCENT[bucket]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
