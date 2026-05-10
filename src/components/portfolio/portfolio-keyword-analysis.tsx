"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DataQualityBadge } from "@/components/ui/data-quality";
import { formatNumber } from "@/lib/utils";
import type { ProviderContributorResult } from "@/lib/providers/types";

interface PortfolioKeywordAnalysisProps {
  data: ProviderContributorResult;
  /** Max rows to render in the table. */
  limit?: number;
}

/**
 * Keyword frequency table. Computes per-keyword frequency and average
 * downloads across the contributor's assets. Falls back to "—" for the
 * average column when downloads aren't verified.
 */
export function PortfolioKeywordAnalysis({
  data,
  limit = 25,
}: PortfolioKeywordAnalysisProps) {
  const downloadsAvailable = data.capabilities?.downloadsAvailable !== false;

  const stats = new Map<string, { count: number; downloadSum: number }>();
  for (const asset of data.assets) {
    for (const k of asset.keywords) {
      const key = k.toLowerCase();
      const cur = stats.get(key) ?? { count: 0, downloadSum: 0 };
      cur.count += 1;
      if (downloadsAvailable && asset.metricsAvailable !== false) {
        cur.downloadSum += asset.downloads;
      }
      stats.set(key, cur);
    }
  }
  const rows = Array.from(stats.entries())
    .map(([keyword, v]) => ({
      keyword,
      count: v.count,
      avgDownloads: v.count > 0 ? Math.round(v.downloadSum / v.count) : 0,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);

  function copyKeywords() {
    const text = rows.map((r) => r.keyword).join(", ");
    void navigator.clipboard?.writeText(text);
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>Keyword analysis</CardTitle>
          <CardDescription>
            Most-used keywords across the portfolio
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={copyKeywords}
            disabled={rows.length === 0}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <DataQualityBadge level={data.dataQuality} size="sm" />
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-muted-foreground">
            No keywords on this contributor&apos;s assets.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-2 font-medium">Keyword</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Frequency
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Avg downloads
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.keyword}
                    className="border-b border-border/20 last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-6 py-2 font-medium">{row.keyword}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.count}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {downloadsAvailable
                        ? formatNumber(row.avgDownloads)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
