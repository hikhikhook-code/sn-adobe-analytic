"use client";

import { useState } from "react";
import { Heart, Copy, Image as ImageIcon, ExternalLink, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { DataQuality, SearchAsset } from "@/types/search";
import { cn, formatNumber, formatDate, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";

interface ResultCardProps {
  asset: SearchAsset;
  isFavorited?: boolean;
  onToggleFavorite?: (asset: SearchAsset) => void;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
  /**
   * Quality tier of the data shown in this card. Defaults to `demo` so any
   * caller that hasn’t opted in still gets a clear label.
   */
  dataQuality?: DataQuality;
  /** Quality tier of the performance score, which is always estimated. */
  scoreQuality?: DataQuality;
}

export function ResultCard({
  asset,
  isFavorited,
  onToggleFavorite,
  selected,
  onToggleSelected,
  dataQuality = "demo",
  scoreQuality,
}: ResultCardProps) {
  const scoreLevel: DataQuality =
    scoreQuality ?? (dataQuality === "verified" ? "estimated" : dataQuality);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [showAllTitle, setShowAllTitle] = useState(false);

  const keywordsShown = showAllKeywords ? asset.keywords : asset.keywords.slice(0, 6);

  function copyTitle() {
    navigator.clipboard?.writeText(asset.title).catch(() => {});
  }
  function copyKeywords() {
    navigator.clipboard?.writeText(asset.keywords.join(", ")).catch(() => {});
  }

  return (
    <Card
      className={cn(
        "group flex flex-col overflow-hidden",
        selected && "ring-2 ring-accent-blue",
      )}
    >
      <div className="relative aspect-square overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.thumbnailUrl}
          alt={asset.title}
          className="h-full w-full object-cover transition-transform group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {asset.isPremium && <Badge variant="premium">PREMIUM</Badge>}
          {asset.isAiGenerated && (
            <Badge variant="accent" className="gap-1">
              <Sparkles className="h-3 w-3" />
              AI
            </Badge>
          )}
        </div>
        <div className="absolute right-2 top-2 flex gap-1">
          {onToggleSelected && (
            <button
              type="button"
              aria-label="Select"
              onClick={() => onToggleSelected(asset.id)}
              className={cn(
                "grid h-8 w-8 place-items-center rounded-md border bg-white/90 text-xs font-semibold shadow-sm",
                selected
                  ? "border-accent-blue bg-accent-blue text-white"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {selected ? "✓" : ""}
            </button>
          )}
          <button
            type="button"
            aria-label={isFavorited ? "Unsave" : "Save"}
            onClick={() => onToggleFavorite?.(asset)}
            className="grid h-8 w-8 place-items-center rounded-md border border-border bg-white/90 text-rose-500 shadow-sm hover:text-rose-600"
          >
            <Heart
              className={cn(
                "h-4 w-4",
                isFavorited && "fill-current",
              )}
            />
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm font-medium leading-snug",
              !showAllTitle && "line-clamp-2",
            )}
            title={asset.title}
          >
            {asset.title}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setShowAllTitle((s) => !s)}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label="Toggle full title"
            >
              {showAllTitle ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={copyTitle}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Copy title"
            >
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 p-3 text-white">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] uppercase tracking-wide opacity-80">
                Downloads
              </p>
              <DataQualityBadge
                level={dataQuality}
                size="xs"
                showLabel={false}
                className="!border-white/40 !bg-white/15 !text-white"
              />
            </div>
            <p className="mt-0.5 text-lg font-bold leading-tight">
              {formatNumber(asset.downloads)}
            </p>
          </div>
          <div className="rounded-lg bg-gradient-to-br from-orange-500 to-rose-500 p-3 text-white">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] uppercase tracking-wide opacity-80">
                Performance
              </p>
              <DataQualityBadge
                level={scoreLevel}
                size="xs"
                showLabel={false}
                className="!border-white/40 !bg-white/15 !text-white"
              />
            </div>
            <p className="mt-0.5 text-lg font-bold leading-tight">
              {asset.performanceScore}
              <span className="text-xs font-normal opacity-80">/100</span>
            </p>
            <p className="text-[10px] opacity-80">
              ~{asset.downloadsPerMonth}/mo
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-1">
          {asset.categories.map((c) => (
            <Badge key={c} variant="secondary" className="font-normal">
              {c}
            </Badge>
          ))}
          <Badge variant="outline" className="font-normal capitalize">
            {asset.contentType}
          </Badge>
        </div>

        <div className="text-xs text-muted-foreground">
          <span>Uploaded {formatDate(asset.uploadDate)} ({timeAgo(asset.uploadDate)})</span>
        </div>

        <div className="flex items-center justify-between text-xs">
          <a
            href={`https://stock.adobe.com/contributor/${asset.contributorId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-accent-blue hover:underline"
          >
            {asset.contributorName}
          </a>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            disabled
            title="Phase 2"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            Find similar
          </button>
        </div>

        <div className="mt-auto rounded-lg bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Keywords ({asset.keywords.length})
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={copyKeywords}
                className="text-xs text-accent-blue hover:underline"
              >
                Copy all
              </button>
              {asset.keywords.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllKeywords((s) => !s)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAllKeywords ? "Less" : "More"}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {keywordsShown.map((k) => (
              <span
                key={k}
                className="rounded bg-card px-1.5 py-0.5 text-[10px] text-foreground"
              >
                {k}
              </span>
            ))}
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          asChild
          className="justify-center"
        >
          <a href={asset.adobeStockUrl} target="_blank" rel="noreferrer noopener">
            View on Adobe Stock <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </Card>
  );
}
