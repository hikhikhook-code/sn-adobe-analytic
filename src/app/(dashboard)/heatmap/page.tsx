import Link from "next/link";
import { TrendingUp, TrendingDown, Minus, ArrowRight } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HEATMAP_NICHES } from "@/lib/mock-data";
import { formatNumber, cn } from "@/lib/utils";

function competitionColorBg(level: number): string {
  if (level <= 33) return "from-emerald-500 to-emerald-600";
  if (level <= 66) return "from-amber-500 to-orange-500";
  return "from-rose-500 to-rose-600";
}

function trendIcon(t: "up" | "down" | "stable") {
  if (t === "up") return <TrendingUp className="h-3 w-3" />;
  if (t === "down") return <TrendingDown className="h-3 w-3" />;
  return <Minus className="h-3 w-3" />;
}

export default function HeatmapPage() {
  const max = Math.max(...HEATMAP_NICHES.map((n) => n.downloads));

  return (
    <>
      <TopBar
        title="Heat Map"
        subtitle="Visualize niches by demand vs. competition"
      />
      <div className="p-6">
        <PageHeader
          title="Niche heat map"
          description="Bigger tile = more demand. Greener = lower competition. Hunt for small green tiles in busy areas."
        />

        <div className="grid auto-rows-[140px] grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {HEATMAP_NICHES.map((n) => {
            const sizeRatio = n.downloads / max;
            const span = sizeRatio > 0.7 ? "row-span-2" : sizeRatio > 0.45 ? "row-span-2 sm:row-span-1" : "";
            return (
              <Link
                key={n.keyword}
                href={`/search?q=${encodeURIComponent(n.keyword)}`}
                className={cn(
                  "group relative flex flex-col justify-between overflow-hidden rounded-xl bg-gradient-to-br p-4 text-white transition-transform hover:scale-[1.02]",
                  competitionColorBg(n.competition),
                  span,
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold leading-tight line-clamp-2">{n.keyword}</p>
                  <Badge variant="default" className="bg-white/20 text-white">
                    {trendIcon(n.trend)}
                  </Badge>
                </div>
                <div className="text-xs opacity-90">
                  <p className="text-base font-bold">{formatNumber(n.downloads)} dl</p>
                  <p>{formatNumber(n.assets)} assets · comp {n.competition}</p>
                </div>
              </Link>
            );
          })}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Opportunity finder</CardTitle>
              <CardDescription>High demand, low competition</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {HEATMAP_NICHES.filter((n) => n.competition <= 40)
                .sort((a, b) => b.downloads - a.downloads)
                .slice(0, 5)
                .map((n) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{n.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(n.downloads)} downloads · comp {n.competition}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        Explore <ArrowRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Crowded niches</CardTitle>
              <CardDescription>High competition — only enter with a strong angle</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {HEATMAP_NICHES.filter((n) => n.competition >= 70)
                .sort((a, b) => b.competition - a.competition)
                .slice(0, 5)
                .map((n) => (
                  <div
                    key={n.keyword}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border/40 bg-card p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{n.keyword}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatNumber(n.assets)} assets · comp {n.competition}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/search?q=${encodeURIComponent(n.keyword)}`}>
                        View <ArrowRight className="h-4 w-4" />
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
