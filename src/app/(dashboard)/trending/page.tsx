import Link from "next/link";
import { TrendingUp, ArrowRight } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HEATMAP_NICHES, TRENDING_KEYWORDS } from "@/lib/mock-data";
import { formatNumber } from "@/lib/utils";

export default function TrendingPage() {
  return (
    <>
      <TopBar title="Trending" subtitle="Keyword & niche trends across Adobe Stock" />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Trending right now"
          description="Watch which keywords and niches are gaining momentum."
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Trending keywords</CardTitle>
              <CardDescription>Highest search-volume growth</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {TRENDING_KEYWORDS.map((t, i) => (
                <div
                  key={t.keyword}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{t.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(t.volume)} monthly searches
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="success" className="gap-1">
                      <TrendingUp className="h-3 w-3" />+{t.growth}%
                    </Badge>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/search?q=${encodeURIComponent(t.keyword)}`}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Rising niches</CardTitle>
              <CardDescription>Niches gaining demand week over week</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {HEATMAP_NICHES.filter((n) => n.trend === "up")
                .sort((a, b) => b.downloads - a.downloads)
                .map((n, i) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{n.keyword}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatNumber(n.downloads)} downloads · comp {n.competition}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" asChild>
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
