"use client";

import { useMemo, useState } from "react";
import { Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SimpleSelect } from "@/components/ui/select";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { ResultCard } from "@/components/search/result-card";
import type { ProviderContributorResult } from "@/lib/providers/types";

interface PortfolioAssetGridProps {
  data: ProviderContributorResult;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onExport: (kind: "selected" | "all") => void;
  exporting?: boolean;
}

type SortKey = "downloads" | "performance" | "newest" | "oldest";

/**
 * Full asset grid for the contributor. Supports per-asset selection so the
 * user can export a subset, and a sort-by control covering the four PRD
 * signals. Falls back to performance-only sort when downloads aren't
 * available from the active provider.
 */
export function PortfolioAssetGrid({
  data,
  selected,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onExport,
  exporting,
}: PortfolioAssetGridProps) {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;
  const [sort, setSort] = useState<SortKey>(
    downloadsAvailable ? "downloads" : "performance",
  );

  const sorted = useMemo(() => {
    const arr = [...data.assets];
    switch (sort) {
      case "downloads":
        return arr.sort((a, b) => b.downloads - a.downloads);
      case "performance":
        return arr.sort((a, b) => b.performanceScore - a.performanceScore);
      case "newest":
        return arr.sort(
          (a, b) =>
            new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime(),
        );
      case "oldest":
        return arr.sort(
          (a, b) =>
            new Date(a.uploadDate).getTime() - new Date(b.uploadDate).getTime(),
        );
    }
  }, [data.assets, sort]);

  const total = sorted.length;
  const selectedCount = selected.size;

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle>Asset grid</CardTitle>
          <CardDescription>
            {total} asset{total === 1 ? "" : "s"}
            {selectedCount > 0 ? ` · ${selectedCount} selected` : ""}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SimpleSelect
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="w-40"
            options={[
              {
                value: "downloads",
                label: "By downloads",
                disabled: !downloadsAvailable,
              },
              { value: "performance", label: "By performance" },
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
            ]}
          />
          <Button variant="outline" size="sm" onClick={onSelectAll}>
            <ListChecks className="h-4 w-4" />
            {selectedCount === total && total > 0 ? "Clear all" : "Select all"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onExport("selected")}
            disabled={exporting || selectedCount === 0}
          >
            <Download className="h-4 w-4" />
            Export selected
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => onExport("all")}
            disabled={exporting || total === 0}
          >
            <Download className="h-4 w-4" />
            Export all
          </Button>
          <DataQualityBadge level={data.dataQuality} size="sm" />
        </div>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            No assets to display.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((asset) => (
              <ResultCard
                key={asset.id}
                asset={asset}
                dataQuality={data.dataQuality}
                providerId={data.providerId}
                selected={selected.has(asset.id)}
                onToggleSelected={onToggleSelect}
              />
            ))}
          </div>
        )}
        {selectedCount > 0 ? (
          <button
            type="button"
            className="mt-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={onClearSelection}
          >
            Clear selection
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
