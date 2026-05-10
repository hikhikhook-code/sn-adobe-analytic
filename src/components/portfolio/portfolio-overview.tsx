"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { formatDate, formatNumber } from "@/lib/utils";
import type { ProviderContributorResult } from "@/lib/providers/types";
import type { DataQuality } from "@/types/search";

interface PortfolioOverviewProps {
  data: ProviderContributorResult;
}

function portfolioAge(joinDate: string): string | null {
  const t = new Date(joinDate).getTime();
  if (!Number.isFinite(t) || t <= 0) return null;
  const yrs = (Date.now() - t) / (365.25 * 24 * 60 * 60 * 1000);
  if (yrs < 0.1) return "<1 month";
  if (yrs < 1) return `${Math.round(yrs * 12)} months`;
  return `${yrs.toFixed(1)} years`;
}

/**
 * Top-level contributor stats: assets, downloads, average per-asset, best
 * asset, portfolio age. Renders `—` + "Unavailable" when the provider can't
 * supply verified download counts (e.g. Public Metadata / not configured).
 */
export function PortfolioOverview({ data }: PortfolioOverviewProps) {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;
  const downloadQuality: DataQuality = downloadsAvailable
    ? data.dataQuality
    : "public_metadata";
  const age = portfolioAge(data.joinDate);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4 sm:flex">
        <div>
          <CardTitle className="text-xl">{data.name}</CardTitle>
          <CardDescription>
            {age ? <>Active for {age} · </> : null}
            Joined {formatDate(data.joinDate)} · {formatNumber(data.totalAssets)} assets
          </CardDescription>
        </div>
        <DataQualityBadge level={data.dataQuality} size="md" />
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Total assets"
          value={formatNumber(data.totalAssets)}
          quality={data.dataQuality}
        />
        <Stat
          label="Total downloads"
          value={
            downloadsAvailable
              ? formatNumber(data.totalDownloads)
              : "—"
          }
          quality={downloadQuality}
          unavailable={!downloadsAvailable}
        />
        <Stat
          label="Avg per asset"
          value={
            downloadsAvailable
              ? formatNumber(data.avgDownloads)
              : "—"
          }
          quality="estimated"
          unavailable={!downloadsAvailable}
        />
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Best asset
            </p>
            <DataQualityBadge level={downloadQuality} size="xs" />
          </div>
          <p
            className="mt-1 truncate text-sm font-semibold"
            title={data.bestAsset.title}
          >
            {data.bestAsset.title || "—"}
          </p>
          <p className="text-xs text-muted-foreground">
            {downloadsAvailable && data.bestAsset.downloads > 0
              ? `${formatNumber(data.bestAsset.downloads)} downloads`
              : "Downloads unavailable"}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  quality,
  unavailable,
}: {
  label: string;
  value: string;
  quality: DataQuality;
  unavailable?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <DataQualityBadge level={quality} size="xs" />
      </div>
      <p className="mt-1 text-xl font-semibold">{value}</p>
      {unavailable ? (
        <p
          className="text-[10px] uppercase tracking-wide text-muted-foreground"
          title="Verified download counts are not provided by the active data source."
        >
          Unavailable
        </p>
      ) : null}
    </div>
  );
}
