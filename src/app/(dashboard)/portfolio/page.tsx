"use client";

import { useState } from "react";
import { Users, Search } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ResultCard } from "@/components/search/result-card";
import { formatNumber, formatDate } from "@/lib/utils";
import type { MockContributor } from "@/lib/mock-data";

export default function PortfolioPage() {
  const [query, setQuery] = useState("");
  const [data, setData] = useState<MockContributor | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error("Lookup failed");
      const json: MockContributor = await res.json();
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <TopBar
        title="Portfolio Tracker"
        subtitle="Analyze any Adobe Stock contributor's portfolio"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Track a contributor"
          description="Search by contributor name or paste a stock.adobe.com/contributor URL."
        />

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-2 rounded-2xl border border-border/40 bg-card p-4 shadow-sm sm:flex-row"
        >
          <div className="relative flex-1">
            <Users className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Contributor name or URL (e.g. Studio Lumen)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button type="submit" variant="accent" disabled={loading || !query.trim()}>
            <Search className="h-4 w-4" />
            {loading ? "Analyzing..." : "Analyze"}
          </Button>
        </form>

        {!data && !loading && (
          <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">
            Enter a contributor to see their stats, top assets, content breakdown,
            and most-used keywords.
          </div>
        )}

        {data && (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-4 sm:flex">
                <div>
                  <CardTitle className="text-xl">{data.name}</CardTitle>
                  <CardDescription>
                    Joined {formatDate(data.joinDate)} · {formatNumber(data.totalAssets)} assets
                  </CardDescription>
                </div>
                <Badge variant="accent">Demo data</Badge>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total downloads</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(data.totalDownloads)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Avg per asset</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(data.avgDownloads)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total assets</p>
                  <p className="mt-1 text-xl font-semibold">{formatNumber(data.totalAssets)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Best asset</p>
                  <p className="mt-1 truncate text-sm font-semibold" title={data.bestAsset.title}>
                    {data.bestAsset.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatNumber(data.bestAsset.downloads)} downloads
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Content breakdown</CardTitle>
                  <CardDescription>Asset mix by type</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.contentBreakdown.map((b) => (
                    <div key={b.type} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize">{b.type}</span>
                        <span className="text-muted-foreground">
                          {b.count} · {b.pct}%
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-accent-blue"
                          style={{ width: `${b.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Top keywords</CardTitle>
                  <CardDescription>Most-used keywords across portfolio</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-1.5">
                    {data.topKeywords.map((k) => (
                      <Badge key={k.keyword} variant="secondary" className="font-normal">
                        {k.keyword} <span className="ml-1 text-muted-foreground">×{k.count}</span>
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Best sellers
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.assets.slice(0, 9).map((a) => (
                  <ResultCard key={a.id} asset={a} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
