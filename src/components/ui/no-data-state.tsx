"use client";

import Link from "next/link";
import {
  Database,
  FileSpreadsheet,
  FlaskConical,
  Globe,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * "No real data configured" empty state (PR #23).
 *
 * Shown to signed-in production users when:
 *   - They have no imported CSV datasets, AND
 *   - The public-metadata provider is not configured / returns empty, AND
 *   - They have NOT explicitly opted into demo mode.
 *
 * Offers three CTAs so the user knows exactly what they can do:
 *   1. Import a CSV of their own analytics
 *   2. Configure the public metadata provider
 *   3. Try demo mode (switch dataset selector to "Demo data")
 *
 * This component replaces the old behavior of silently showing synthetic
 * mock data to production users without any indication it wasn't real.
 */

export interface NoDataStateProps {
  /** Page context for tailored messaging. */
  page?: "search" | "dashboard" | "portfolio" | "heatmap" | "trending" | "similar";
  /** Callback to switch to demo mode (flips the dataset selector). */
  onTryDemo?: () => void;
  /** Whether to show the "Try demo mode" option (hidden for guests). */
  showDemoOption?: boolean;
  className?: string;
}

const PAGE_TITLES: Record<string, string> = {
  search: "No search data available",
  dashboard: "No analytics data available",
  portfolio: "No portfolio data available",
  heatmap: "No heat map data available",
  trending: "No trending data available",
  similar: "No similar image data available",
};

const PAGE_DESCRIPTIONS: Record<string, string> = {
  search:
    "Search results require a data source. Import your own Adobe Stock analytics CSV, configure the public metadata provider, or try demo mode to explore the interface.",
  dashboard:
    "Dashboard analytics require a data source. Import your own data or configure the public metadata provider to see real metrics here.",
  portfolio:
    "Portfolio tracking requires a data source. Import a CSV with contributor data or configure the public metadata provider.",
  heatmap:
    "The niche heat map requires download and keyword data. Import a CSV to populate the heat map with your verified analytics.",
  trending:
    "Trending insights require historical data. Import a CSV with upload dates and downloads to see real trends.",
  similar:
    "Similar image search requires asset metadata. Import a CSV or configure the public metadata provider.",
};

export function NoDataState({
  page = "search",
  onTryDemo,
  showDemoOption = true,
  className,
}: NoDataStateProps) {
  const title = PAGE_TITLES[page] ?? "No data available";
  const description = PAGE_DESCRIPTIONS[page] ?? PAGE_DESCRIPTIONS.search;

  return (
    <Card className={cn("border-dashed", className)}>
      <CardContent className="flex flex-col items-center gap-6 p-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-muted/50">
          <Database className="h-8 w-8 text-muted-foreground/60" />
        </div>

        <div className="max-w-md space-y-2">
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild variant="accent" size="sm">
            <Link href="/import">
              <Upload className="h-4 w-4" />
              Import your CSV
            </Link>
          </Button>

          <Button asChild variant="outline" size="sm">
            <Link href="/settings">
              <Globe className="h-4 w-4" />
              Configure public metadata
            </Link>
          </Button>

          {showDemoOption && (
            <Button
              variant="outline"
              size="sm"
              onClick={onTryDemo}
              disabled={!onTryDemo}
              title={
                onTryDemo
                  ? "Switch to demo mode to explore synthetic data"
                  : "Select 'Demo data' from the dataset picker in the top bar"
              }
            >
              <FlaskConical className="h-4 w-4" />
              Try demo mode
            </Button>
          )}
        </div>

        <div className="flex flex-wrap justify-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <FileSpreadsheet className="h-3 w-3" />
            CSV import gives you Verified data
          </span>
          <span className="flex items-center gap-1">
            <Globe className="h-3 w-3" />
            Public metadata gives real Adobe Stock titles &amp; thumbnails
          </span>
          <span className="flex items-center gap-1">
            <FlaskConical className="h-3 w-3" />
            Demo mode shows synthetic numbers (clearly labeled)
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
