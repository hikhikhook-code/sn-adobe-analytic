"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileDown, History } from "lucide-react";

import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DataQualityBadge, DataQualityBanner } from "@/components/ui/data-quality";
import { formatNumber, timeAgo } from "@/lib/utils";
import type { DataQuality } from "@/types/search";

interface ExportRow {
  id: string;
  type: string;
  query: string;
  rowCount: number;
  dataQuality: DataQuality;
  providerName: string;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  search: "Search results",
  portfolio: "Portfolio",
  saved: "Saved assets",
  imported: "Imported dataset",
};

export default function ExportPage() {
  const [exports, setExports] = useState<ExportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/export/history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as { exports: ExportRow[] };
        if (!cancelled) {
          setExports(j.exports);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setExports([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopBar
        title="Export"
        subtitle="CSV exports of your search results, portfolio, and imported data"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Export history"
          description="Every CSV you generate from anywhere in the app gets logged here, tagged with the data-quality level it was generated from."
        />

        <DataQualityBanner
          level="estimated"
          message="Each row in the history below carries the data-quality tag of its source. Imported data exports as Verified; search/portfolio exports off mock data are tagged Demo."
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr,1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-accent-blue" />
                Recent exports
              </CardTitle>
              <CardDescription>
                Last 100 exports across this account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {error ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  {error}
                </div>
              ) : exports === null ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              ) : exports.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <FileDown className="mx-auto mb-2 h-6 w-6" />
                  No exports yet. Run a search and use the Export button on the
                  results page, or export your imported datasets.
                  <div className="mt-3">
                    <Button asChild variant="accent" size="sm">
                      <Link href="/search">Go to search</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Type</th>
                        <th className="px-3 py-2 font-semibold">Query / dataset</th>
                        <th className="px-3 py-2 font-semibold">Rows</th>
                        <th className="px-3 py-2 font-semibold">Quality</th>
                        <th className="px-3 py-2 font-semibold">Generated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {exports.map((e) => (
                        <tr key={e.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            {TYPE_LABELS[e.type] ?? e.type}
                          </td>
                          <td className="px-3 py-2 max-w-[260px] truncate">
                            <span title={e.query}>{e.query || "(unnamed)"}</span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatNumber(e.rowCount)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <DataQualityBadge
                                level={e.dataQuality}
                                size="xs"
                              />
                              <span className="text-[11px] text-muted-foreground">
                                {e.providerName}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {timeAgo(e.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How exports work</CardTitle>
              <CardDescription>One CSV per click, tagged at source</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="leading-relaxed">
                CSV columns include ID, Title, Downloads, Performance Score,
                Downloads/Month, Content Type, Categories, Upload Date,
                Contributor, Keywords, Adobe Stock URL, Is Premium, Is AI.
              </p>
              <p className="leading-relaxed">
                A history row is created for every export. Mock-data exports
                inherit a <DataQualityBadge level="demo" size="xs" /> label;
                exports of your imported data inherit{" "}
                <DataQualityBadge level="verified" size="xs" />.
              </p>
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-xs">
                Want your own numbers in there?{" "}
                <Link
                  href="/import"
                  className="font-medium text-accent-blue hover:underline"
                >
                  Import a CSV
                </Link>{" "}
                — once a dataset exists for you, all subsequent exports come
                from your verified data.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}


