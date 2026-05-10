"use client";

import Link from "next/link";
import { History, Search as SearchIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatNumber, timeAgo } from "@/lib/utils";
import type { DashboardRecentSearch } from "@/hooks/use-dashboard-data";

interface RecentSearchesWidgetProps {
  items: DashboardRecentSearch[];
  signedIn: boolean;
  /** Data-source label surfaced next to each search ("Mock data provider",
   *  "User imported data"). The active provider is what actually powers a
   *  re-run, so showing its name on the persisted history keeps the UI
   *  honest. */
  providerName: string;
}

/**
 * Dashboard "Recent searches" widget.
 *
 * Each row surfaces the keyword, content-type / sort filters, result
 * count, and a re-search shortcut to `/search?q=<keyword>`. The provider
 * name is displayed once (in the header) rather than per-row — searches
 * are logged against the user, not against the provider that served them
 * at the time.
 */
export function RecentSearchesWidget({
  items,
  signedIn,
  providerName,
}: RecentSearchesWidgetProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Recent searches
            </CardTitle>
            <CardDescription>
              Your last 8 searches. Re-running uses{" "}
              <span className="font-medium">{providerName}</span>.
            </CardDescription>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/search">New search</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!signedIn ? (
          <p className="text-sm text-muted-foreground">
            Sign in to persist your search history across devices.
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No searches yet. Try one from{" "}
            <Link
              href="/search"
              className="font-medium text-accent-blue hover:underline"
            >
              the search page
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <Link
                    href={`/search?q=${encodeURIComponent(s.keyword)}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {s.keyword}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span className="capitalize">
                      {s.sort.replace(/_/g, " ")}
                    </span>
                    <span>·</span>
                    <span className="capitalize">{s.contentType}</span>
                    {s.resultCount != null ? (
                      <>
                        <span>·</span>
                        <span>{formatNumber(s.resultCount)} results</span>
                      </>
                    ) : null}
                    <span>·</span>
                    <span>{timeAgo(s.createdAt)}</span>
                  </div>
                </div>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="flex-none"
                >
                  <Link href={`/search?q=${encodeURIComponent(s.keyword)}`}>
                    <SearchIcon className="h-3.5 w-3.5" />
                    Re-run
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
