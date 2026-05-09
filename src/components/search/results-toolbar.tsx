"use client";

import { Download, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimpleSelect } from "@/components/ui/select";

interface ResultsToolbarProps {
  total: number;
  selectedCount: number;
  toolbarSort: "default" | "downloads" | "performance";
  onSortChange: (s: "default" | "downloads" | "performance") => void;
  onSelectAll: () => void;
  onExport: () => void;
  exporting?: boolean;
}

export function ResultsToolbar({
  total,
  selectedCount,
  toolbarSort,
  onSortChange,
  onSelectAll,
  onExport,
  exporting,
}: ResultsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <p className="text-sm font-medium">
        {total} results
        {selectedCount > 0 && (
          <span className="ml-2 text-xs text-muted-foreground">
            · {selectedCount} selected
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <SimpleSelect
          value={toolbarSort}
          onChange={(e) =>
            onSortChange(e.target.value as "default" | "downloads" | "performance")
          }
          className="w-44"
          options={[
            { value: "default", label: "Default" },
            { value: "downloads", label: "By Downloads" },
            { value: "performance", label: "By Performance" },
          ]}
        />
        <Button variant="outline" size="sm" onClick={onSelectAll}>
          <ListChecks className="h-4 w-4" />
          Select all
        </Button>
        <Button
          variant="accent"
          size="sm"
          onClick={onExport}
          disabled={exporting || total === 0}
        >
          <Download className="h-4 w-4" />
          {exporting ? "Exporting..." : `Export ${selectedCount > 0 ? selectedCount : total}`}
        </Button>
      </div>
    </div>
  );
}
