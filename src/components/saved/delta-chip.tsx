"use client";

import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn, formatNumber, timeAgo } from "@/lib/utils";
import { DataQualityBadge } from "@/components/ui/data-quality";
import type { DataQuality } from "@/types/search";

interface DeltaChipProps {
  label: string;
  /** Saved-at baseline. Never overwritten after initial save. */
  savedAt: number;
  /** Current figure from the last `/api/saved/track` refresh, or null
   *  when the refresh hasn't run yet OR the active provider couldn't
   *  supply one. Distinguish via `checkedAt`. */
  current: number | null;
  /** ISO timestamp of the last `/api/saved/track` call, or null if never. */
  checkedAt: string | null;
  /** Data quality of the current figure. Null when `current` is null. */
  dataQuality: DataQuality | null;
  /** Suffix rendered next to the numbers (e.g. "dl", "/100"). */
  suffix?: string;
  className?: string;
}

/**
 * Track-changes delta widget. Distinguishes three states so users always
 * know whether a number is verified, estimated, or simply unavailable:
 *
 *   1. **Not yet checked** — `checkedAt` is null. We render the saved-at
 *      baseline and nudge the user to hit "Check for updates".
 *
 *   2. **Checked but unavailable** — `checkedAt` is set but `current` is
 *      null. The active provider couldn't supply a verified figure (e.g.
 *      mock / official). Render "Unavailable" rather than faking zero.
 *
 *   3. **Checked with a number** — render saved-at + delta + quality
 *      badge so the user sees exactly where the number came from.
 */
export function DeltaChip({
  label,
  savedAt,
  current,
  checkedAt,
  dataQuality,
  suffix,
  className,
}: DeltaChipProps) {
  const hasCurrent = current != null;
  const delta = hasCurrent ? current - savedAt : 0;
  const DeltaIcon =
    !hasCurrent
      ? Minus
      : delta > 0
        ? TrendingUp
        : delta < 0
          ? TrendingDown
          : Minus;
  const deltaTone =
    !hasCurrent
      ? "bg-muted text-muted-foreground"
      : delta > 0
        ? "bg-emerald-100 text-emerald-800"
        : delta < 0
          ? "bg-rose-100 text-rose-800"
          : "bg-muted text-muted-foreground";

  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {dataQuality ? (
          <DataQualityBadge level={dataQuality} size="xs" />
        ) : null}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-base font-semibold text-navy">
          {formatNumber(savedAt)}
          {suffix ? (
            <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </span>
        {!checkedAt ? (
          <span className="text-[10px] italic text-muted-foreground">
            saved baseline · not yet checked
          </span>
        ) : !hasCurrent ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            <AlertTriangle className="h-2.5 w-2.5" />
            Unavailable
          </span>
        ) : (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold uppercase tracking-wide",
              deltaTone,
            )}
          >
            <DeltaIcon className="h-2.5 w-2.5" />
            {delta > 0 ? "+" : ""}
            {formatNumber(Math.abs(delta))}
            {suffix}
          </span>
        )}
      </div>
      {checkedAt ? (
        <p className="mt-0.5 text-[10px] text-muted-foreground">
          Last checked {timeAgo(checkedAt)}
        </p>
      ) : null}
    </div>
  );
}
