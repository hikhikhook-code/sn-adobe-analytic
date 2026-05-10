"use client";

import { useState } from "react";
import { Heart, Copy, Image as ImageIcon, ExternalLink, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { DataQuality, SearchAsset } from "@/types/search";
import { cn, formatNumber, formatDate, timeAgo } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataQualityBadge } from "@/components/ui/data-quality";
import {
  resolveAssetLink,
  resolveContributorLink,
} from "@/lib/adobe-stock-link";

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
  /**
   * Provider id ("mock" | "manual" | "official"). Plumbed alongside
   * `dataQuality` so the Adobe-Stock link resolver can tell real
   * (verified / public_metadata) rows apart from mock rows that
   * happen to carry a stock.adobe.com-shaped URL. See
   * `src/lib/adobe-stock-link.ts`.
   */
  providerId?: string;
  /** Quality tier of the performance score, which is always estimated. */
  scoreQuality?: DataQuality;
  /**
   * Optional 0–100 metadata-similarity score. When provided, the card
   * renders a third metric tile labeled "Similarity" with a source-aware
   * data-quality badge. Pair with `similarityAvailable: false` (or pass
   * `similarityScore = -1`) to render "Unavailable".
   */
  similarityScore?: number;
  similarityAvailable?: boolean;
  /**
   * When set, swaps the disabled "Find similar — Coming Soon" hint for
   * an active button that calls back into the parent (used by the
   * /search Similar Image Search panel to seed the URL field from a
   * card the user is already looking at).
   */
  onFindSimilar?: (asset: SearchAsset) => void;
}

export function ResultCard({
  asset,
  isFavorited,
  onToggleFavorite,
  selected,
  onToggleSelected,
  dataQuality = "demo",
  providerId,
  scoreQuality,
  similarityScore,
  similarityAvailable,
  onFindSimilar,
}: ResultCardProps) {
  const scoreLevel: DataQuality =
    scoreQuality ?? (dataQuality === "verified" ? "estimated" : dataQuality);
  const [showAllKeywords, setShowAllKeywords] = useState(false);
  const [showAllTitle, setShowAllTitle] = useState(false);

  // Per-asset gate. The provider sets `metricsAvailable: false` when its
  // source can't supply verified download counts (e.g. public-metadata).
  // Render `—` + "Unavailable" instead of `0` so we never imply we have a
  // real Adobe download number.
  const hasMetrics = asset.metricsAvailable !== false;

  // Safe link resolution. Mock / demo / estimated rows route to a
  // keyword-search fallback (or a disabled state) so we never link
  // to a fake stock.adobe.com/<id> detail page that 404s. See
  // src/lib/adobe-stock-link.ts for the full policy.
  const assetLink = resolveAssetLink(asset, {
    dataQuality,
    providerId,
  });
  // resolveContributorLink intentionally doesn't take a context bag:
  // per src/lib/adobe-stock-link.ts we ALWAYS route contributor links
  // through a UK keyword search, so the dataQuality / providerId bag
  // that resolveAssetLink uses has nothing to decide on here.
  const contributorLink = resolveContributorLink(asset);

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

        {typeof similarityScore === "number" ? (
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 p-3 text-white">
            <div className="flex items-center justify-between gap-1">
              <p className="text-[10px] uppercase tracking-wide opacity-80">
                Similarity
              </p>
              <DataQualityBadge
                level={
                  dataQuality === "verified" ? "estimated" : dataQuality
                }
                size="xs"
                showLabel={false}
                className="!border-white/40 !bg-white/15 !text-white"
              />
            </div>
            {similarityAvailable === false ? (
              <>
                <p className="mt-0.5 text-lg font-bold leading-tight">—</p>
                <p
                  className="text-[10px] opacity-80"
                  title="No metadata overlap could be computed against this asset."
                >
                  Unavailable
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-bold leading-tight">
                  {similarityScore}
                  <span className="text-xs font-normal opacity-80">/100</span>
                </p>
                <p className="text-[10px] opacity-80">
                  Metadata-similarity proxy
                </p>
              </>
            )}
          </div>
        ) : null}

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
            {hasMetrics ? (
              <p className="mt-0.5 text-lg font-bold leading-tight">
                {formatNumber(asset.downloads)}
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-bold leading-tight">—</p>
                <p
                  className="text-[10px] opacity-80"
                  title="The current data provider does not expose verified download counts."
                >
                  Unavailable
                </p>
              </>
            )}
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
            {hasMetrics ? (
              <>
                <p className="mt-0.5 text-lg font-bold leading-tight">
                  {asset.performanceScore}
                  <span className="text-xs font-normal opacity-80">/100</span>
                </p>
                <p className="text-[10px] opacity-80">
                  ~{asset.downloadsPerMonth}/mo
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-bold leading-tight">—</p>
                <p
                  className="text-[10px] opacity-80"
                  title="Performance score is derived from downloads, which are unavailable for this source."
                >
                  Unavailable
                </p>
              </>
            )}
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
          {contributorLink.href ? (
            <a
              href={contributorLink.href}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-accent-blue hover:underline"
              title={contributorLink.reason}
            >
              {asset.contributorName}
            </a>
          ) : (
            <span
              className="font-medium text-muted-foreground"
              title={contributorLink.reason}
            >
              {asset.contributorName || contributorLink.label}
            </span>
          )}
          {onFindSimilar ? (
            <button
              type="button"
              onClick={() => onFindSimilar(asset)}
              className="inline-flex items-center gap-1 text-accent-blue hover:underline"
              title="Use this asset's image URL to find metadata-similar results."
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Find similar
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-muted-foreground/70"
              disabled
              title="Similar Image Search is available from the Search by image panel above."
            >
              <ImageIcon className="h-3.5 w-3.5" />
              Find similar
            </button>
          )}
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

        {assetLink.href ? (
          <Button
            variant="outline"
            size="sm"
            asChild
            className="justify-center"
          >
            <a
              href={assetLink.href}
              target="_blank"
              rel="noreferrer noopener"
              title={assetLink.reason}
            >
              {assetLink.label} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled
            className="justify-center"
            title={assetLink.reason}
          >
            {assetLink.label}
          </Button>
        )}
      </div>
    </Card>
  );
}
