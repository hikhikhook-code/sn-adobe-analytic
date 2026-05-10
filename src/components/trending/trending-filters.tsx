"use client";

import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";
import type {
  TrendingContentType,
  TrendingPeriod,
  TrendingSort,
} from "@/lib/providers/types";

export interface TrendingFilterState {
  period: TrendingPeriod;
  contentType: TrendingContentType;
  minVolume: number;
  sort: TrendingSort;
}

export const DEFAULT_TRENDING_FILTER_STATE: TrendingFilterState = {
  period: "30d",
  contentType: "all",
  minVolume: 0,
  sort: "growth",
};

interface TrendingFiltersProps {
  value: TrendingFilterState;
  onChange: (next: TrendingFilterState) => void;
  onReset: () => void;
  loading?: boolean;
}

const PERIOD_OPTIONS: { value: TrendingPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last 1 year" },
];

const CONTENT_TYPE_OPTIONS: { value: TrendingContentType; label: string }[] = [
  { value: "all", label: "All content types" },
  { value: "photo", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "vector", label: "Vector" },
  { value: "video", label: "Video" },
  { value: "template", label: "Template" },
  { value: "3d", label: "3D" },
  { value: "other", label: "Other" },
];

const MIN_VOLUME_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "No minimum" },
  { value: 1_000, label: "1,000+ volume" },
  { value: 10_000, label: "10,000+ volume" },
  { value: 50_000, label: "50,000+ volume" },
  { value: 100_000, label: "100,000+ volume" },
];

const SORT_OPTIONS: { value: TrendingSort; label: string }[] = [
  { value: "growth", label: "Sort: Growth" },
  { value: "volume", label: "Sort: Volume" },
];

/**
 * Trending filter bar. All values flow into the provider via the
 * `/api/search/trending` query string \u2014 this is not a UI-only filter.
 */
export function TrendingFilters({
  value,
  onChange,
  onReset,
  loading,
}: TrendingFiltersProps) {
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Time period
        </label>
        <SimpleSelect
          value={value.period}
          disabled={loading}
          onChange={(e) =>
            onChange({ ...value, period: e.target.value as TrendingPeriod })
          }
          options={PERIOD_OPTIONS}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Content type
        </label>
        <SimpleSelect
          value={value.contentType}
          disabled={loading}
          onChange={(e) =>
            onChange({
              ...value,
              contentType: e.target.value as TrendingContentType,
            })
          }
          options={CONTENT_TYPE_OPTIONS}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Minimum volume
        </label>
        <SimpleSelect
          value={String(value.minVolume)}
          disabled={loading}
          onChange={(e) =>
            onChange({ ...value, minVolume: Number(e.target.value) || 0 })
          }
          options={MIN_VOLUME_OPTIONS.map((o) => ({
            value: String(o.value),
            label: o.label,
          }))}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Sort
        </label>
        <SimpleSelect
          value={value.sort}
          disabled={loading}
          onChange={(e) =>
            onChange({ ...value, sort: e.target.value as TrendingSort })
          }
          options={SORT_OPTIONS}
        />
      </div>
      <div className="flex items-end">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onReset}
          disabled={loading}
        >
          Reset filters
        </Button>
      </div>
    </div>
  );
}
