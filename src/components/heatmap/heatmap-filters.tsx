"use client";

import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";
import type {
  HeatmapContentType,
  HeatmapPeriod,
  HeatmapSort,
} from "@/lib/providers/types";

export interface HeatmapFilterState {
  contentType: HeatmapContentType;
  period: HeatmapPeriod;
  minDownloads: number;
  sort: HeatmapSort;
}

export const DEFAULT_HEATMAP_FILTER_STATE: HeatmapFilterState = {
  contentType: "all",
  period: "all",
  minDownloads: 0,
  sort: "opportunity",
};

interface HeatmapFiltersProps {
  value: HeatmapFilterState;
  onChange: (next: HeatmapFilterState) => void;
  onReset: () => void;
  loading?: boolean;
}

const CONTENT_TYPE_OPTIONS: { value: HeatmapContentType; label: string }[] = [
  { value: "all", label: "All content types" },
  { value: "photo", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "vector", label: "Vector" },
  { value: "video", label: "Video" },
  { value: "template", label: "Template" },
  { value: "3d", label: "3D" },
  { value: "other", label: "Other" },
];

const PERIOD_OPTIONS: { value: HeatmapPeriod; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "1y", label: "Last 1 year" },
  { value: "all", label: "All time" },
];

const MIN_DOWNLOADS_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: "No minimum" },
  { value: 100, label: "100+ downloads" },
  { value: 500, label: "500+ downloads" },
  { value: 1_000, label: "1,000+ downloads" },
  { value: 10_000, label: "10,000+ downloads" },
  { value: 100_000, label: "100,000+ downloads" },
];

const SORT_OPTIONS: { value: HeatmapSort; label: string }[] = [
  { value: "opportunity", label: "Sort: Opportunity" },
  { value: "demand", label: "Sort: Demand" },
  { value: "competition", label: "Sort: Competition (low first)" },
  { value: "trend", label: "Sort: Trend" },
];

/**
 * Heat-map filter bar. All values flow into the provider via the
 * `/api/heatmap` query string \u2014 this is not a UI-only filter.
 */
export function HeatmapFilters({
  value,
  onChange,
  onReset,
  loading,
}: HeatmapFiltersProps) {
  return (
    <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-card p-4 sm:grid-cols-2 lg:grid-cols-5">
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
              contentType: e.target.value as HeatmapContentType,
            })
          }
          options={CONTENT_TYPE_OPTIONS}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Time period
        </label>
        <SimpleSelect
          value={value.period}
          disabled={loading}
          onChange={(e) =>
            onChange({ ...value, period: e.target.value as HeatmapPeriod })
          }
          options={PERIOD_OPTIONS}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">
          Minimum downloads
        </label>
        <SimpleSelect
          value={String(value.minDownloads)}
          disabled={loading}
          onChange={(e) =>
            onChange({ ...value, minDownloads: Number(e.target.value) || 0 })
          }
          options={MIN_DOWNLOADS_OPTIONS.map((o) => ({
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
            onChange({ ...value, sort: e.target.value as HeatmapSort })
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
