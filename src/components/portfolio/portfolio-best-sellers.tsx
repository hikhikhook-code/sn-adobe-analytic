"use client";

import Image from "next/image";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils";
import { resolveAssetLink } from "@/lib/adobe-stock-link";
import type { ProviderContributorResult } from "@/lib/providers/types";

interface PortfolioBestSellersProps {
  data: ProviderContributorResult;
  /** Max rows to render. Defaults to 10 per PRD. */
  limit?: number;
}

/**
 * Top assets by downloads. Falls back to performance score when verified
 * downloads aren't available; renders an honest "Unavailable from this
 * provider" notice when neither signal exists.
 */
export function PortfolioBestSellers({ data, limit = 10 }: PortfolioBestSellersProps) {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;

  const sorted = [...data.assets].sort((a, b) => {
    if (downloadsAvailable) return b.downloads - a.downloads;
    return b.performanceScore - a.performanceScore;
  });
  const top = sorted.slice(0, limit);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Best sellers</CardTitle>
          <CardDescription>
            {downloadsAvailable
              ? `Top ${Math.min(limit, top.length)} by downloads`
              : "Sorted by performance score (downloads unavailable)"}
          </CardDescription>
        </div>
        <DataQualityBadge level={data.dataQuality} size="sm" />
      </CardHeader>
      <CardContent className="space-y-2">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assets to rank.
          </p>
        ) : (
          <ol className="space-y-2">
            {top.map((asset, idx) => {
              const hasMetrics = asset.metricsAvailable !== false;
              return (
                <li
                  key={asset.id}
                  className="flex items-center gap-3 rounded-lg border border-border/40 bg-card px-3 py-2"
                >
                  <span className="w-5 flex-none text-center text-xs font-semibold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <div className="relative h-10 w-14 flex-none overflow-hidden rounded-md bg-muted">
                    {asset.thumbnailUrl ? (
                      <Image
                        src={asset.thumbnailUrl}
                        alt=""
                        fill
                        sizes="56px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={asset.title}
                    >
                      {asset.title || "(untitled)"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="mr-1 capitalize">
                        {asset.contentType}
                      </Badge>
                      {asset.contributorName}
                    </p>
                  </div>
                  <div className="flex flex-none flex-col items-end text-right text-xs">
                    {hasMetrics && downloadsAvailable ? (
                      <>
                        <span className="font-semibold">
                          {formatNumber(asset.downloads)}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          downloads
                        </span>
                      </>
                    ) : (
                      <span
                        className="text-[10px] uppercase tracking-wide text-muted-foreground"
                        title="The current data provider does not expose verified download counts."
                      >
                        Unavailable
                      </span>
                    )}
                  </div>
                  {(() => {
                    // Safe link routing: demo rows fall back to an
                    // Adobe Stock keyword search, never a fake
                    // /<id> detail page. See src/lib/adobe-stock-link.ts.
                    const link = resolveAssetLink(asset, {
                      dataQuality: data.dataQuality,
                      providerId: data.providerId,
                    });
                    if (!link.href) return null;
                    return (
                      <Link
                        href={link.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex-none text-muted-foreground hover:text-accent-blue"
                        aria-label={link.label}
                        title={link.reason}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    );
                  })()}
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
