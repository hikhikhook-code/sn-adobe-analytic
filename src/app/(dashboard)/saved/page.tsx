"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bookmark,
  Download,
  ExternalLink,
  Heart,
  Image as ImageIcon,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataQualityBadge,
  DataQualityBanner,
} from "@/components/ui/data-quality";
import { cn, formatNumber, timeAgo } from "@/lib/utils";
import { useFavorites, type FavoriteRecord } from "@/hooks/use-favorites";
import {
  useCollections,
  type CollectionRecord,
} from "@/hooks/use-collections";
import {
  useSavedSearches,
  type SavedSearchRecord,
} from "@/hooks/use-saved-searches";
import {
  CollectionSidebar,
  type CollectionFilter,
} from "@/components/saved/collection-sidebar";
import { DeltaChip } from "@/components/saved/delta-chip";

type SavedTab = "assets" | "searches";

/**
 * `/saved` — central "my saved library" page.
 *
 * Organization:
 *   - Left rail: collection sidebar with create / rename / delete.
 *     Filters the main pane.
 *   - Right pane: tab switcher between Saved Assets and Saved Searches.
 *   - Toolbar: refresh (track-changes), export, and an empty-state CTA
 *     to /search when the user has nothing saved.
 *
 * PRD alignment (§5.7): individual image favorites + saved searches +
 * collections/folders + track-changes deltas + quick re-search from a
 * saved keyword. The Pending row in PRD-ALIGNMENT.md for "Saved searches
 * + Folders/collections + Track delta since save" gets flipped here.
 */
export default function SavedPage() {
  const {
    favorites,
    loaded: favLoaded,
    toggle,
    reload: reloadFavs,
    assignToCollection: assignFavToCollection,
  } = useFavorites();
  const {
    savedSearches,
    loaded: searchesLoaded,
    remove: removeSavedSearch,
    assignToCollection: assignSearchToCollection,
    reload: reloadSavedSearches,
  } = useSavedSearches();
  const {
    collections,
    loaded: collectionsLoaded,
    create: createCollection,
    rename: renameCollection,
    remove: removeCollection,
    reload: reloadCollections,
  } = useCollections();

  const [tab, setTab] = useState<SavedTab>("assets");
  const [filter, setFilter] = useState<CollectionFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNotice, setRefreshNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const filteredFavorites = useMemo(() => {
    if (filter === "all") return favorites;
    if (filter === "uncategorized") {
      return favorites.filter((f) => !f.collectionId);
    }
    return favorites.filter((f) => f.collectionId === filter.id);
  }, [favorites, filter]);

  const filteredSearches = useMemo(() => {
    if (filter === "all") return savedSearches;
    if (filter === "uncategorized") {
      return savedSearches.filter((s) => !s.collectionId);
    }
    return savedSearches.filter((s) => s.collectionId === filter.id);
  }, [savedSearches, filter]);

  const totalUncategorized = useMemo(() => {
    const f = favorites.filter((x) => !x.collectionId).length;
    const s = savedSearches.filter((x) => !x.collectionId).length;
    return f + s;
  }, [favorites, savedSearches]);

  const totalAll = favorites.length + savedSearches.length;

  const runRefresh = useCallback(async () => {
    if (favorites.length === 0) return;
    setRefreshing(true);
    setRefreshNotice(null);
    try {
      const res = await fetch("/api/saved/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => ({}))) as {
        rows?: Array<{ available: boolean }>;
        providerName?: string | null;
      };
      if (!res.ok) {
        setRefreshNotice("Refresh failed. Please try again.");
        return;
      }
      const ok = j.rows?.filter((r) => r.available).length ?? 0;
      const total = j.rows?.length ?? 0;
      if (total === 0) {
        setRefreshNotice("No saved assets to refresh.");
      } else if (ok === 0) {
        setRefreshNotice(
          "The active data provider can't supply live download numbers for any of your saved assets. Import matching CSV rows to enable verified track-changes.",
        );
      } else if (ok < total) {
        setRefreshNotice(
          `Refreshed ${ok} of ${total} saved assets (${total - ok} unavailable from the active provider).`,
        );
      } else {
        setRefreshNotice(`Refreshed ${ok} saved assets.`);
      }
      await reloadFavs();
    } finally {
      setRefreshing(false);
    }
  }, [favorites.length, reloadFavs]);

  const runExport = useCallback(async () => {
    setExporting(true);
    try {
      const collectionParam =
        filter === "all"
          ? ""
          : filter === "uncategorized"
            ? "?collectionId=uncategorized"
            : `?collectionId=${encodeURIComponent(filter.id)}`;
      const res = await fetch(`/api/saved/export${collectionParam}`, {
        method: "POST",
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sn-saved-${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [filter]);

  const loading = !favLoaded || !searchesLoaded || !collectionsLoaded;
  const nothingSaved = favorites.length === 0 && savedSearches.length === 0;

  return (
    <>
      <TopBar
        title="Saved"
        subtitle="Your saved assets, saved searches, and folders"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Saved library"
          description="Pin assets and searches. Organize them in folders. Track how your saved items are performing over time."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={runRefresh}
                disabled={refreshing || favorites.length === 0}
                title="Refresh downloads/performance for saved assets that appear in your imported data"
              >
                <RefreshCw
                  className={cn(
                    "h-4 w-4",
                    refreshing && "animate-spin",
                  )}
                />
                {refreshing ? "Refreshing…" : "Check for updates"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={runExport}
                disabled={exporting || totalAll === 0}
              >
                <Download className="h-4 w-4" />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
              <Button asChild variant="accent">
                <Link href="/search">
                  <Search className="h-4 w-4" />
                  Find more
                </Link>
              </Button>
            </div>
          }
        />

        <DataQualityBanner
          level="estimated"
          providerName="Mixed source"
          message="Saved rows carry their saved-at snapshot from the provider that served them. Track-changes refreshes the current figure from your imported data when a matching row exists; otherwise the current column stays Unavailable — we never fabricate Adobe download changes."
        />

        {refreshNotice ? (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <span>{refreshNotice}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px,1fr]">
          <CollectionSidebar
            collections={collections}
            loaded={collectionsLoaded}
            filter={filter}
            totalAll={totalAll}
            totalUncategorized={totalUncategorized}
            onFilterChange={setFilter}
            onCreate={async (name) => {
              await createCollection(name);
            }}
            onRename={async (id, name) => {
              await renameCollection(id, name);
            }}
            onDelete={async (id) => {
              await removeCollection(id);
              // Contents fell back to Uncategorized via SetNull — refresh
              // both main-pane lists so assignment chips update too.
              await Promise.all([reloadFavs(), reloadSavedSearches()]);
            }}
          />

          <div className="space-y-4">
            <TabBar
              tab={tab}
              onChange={setTab}
              assetCount={filteredFavorites.length}
              searchCount={filteredSearches.length}
            />

            {loading ? (
              <SavedSkeleton />
            ) : nothingSaved ? (
              <EmptyLibrary />
            ) : tab === "assets" ? (
              <AssetsPane
                items={filteredFavorites}
                collections={collections}
                filter={filter}
                onUnsave={toggle}
                onAssignCollection={assignFavToCollection}
              />
            ) : (
              <SearchesPane
                items={filteredSearches}
                collections={collections}
                filter={filter}
                onRemove={removeSavedSearch}
                onAssignCollection={assignSearchToCollection}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function TabBar({
  tab,
  onChange,
  assetCount,
  searchCount,
}: {
  tab: SavedTab;
  onChange: (t: SavedTab) => void;
  assetCount: number;
  searchCount: number;
}) {
  const base =
    "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors";
  return (
    <div
      role="tablist"
      aria-label="Saved tabs"
      className="inline-flex gap-1 rounded-lg border border-border/60 bg-card p-1"
    >
      <button
        type="button"
        role="tab"
        aria-selected={tab === "assets"}
        onClick={() => onChange("assets")}
        className={cn(
          base,
          tab === "assets"
            ? "bg-accent-blue text-white"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Heart className="h-3.5 w-3.5" />
        Saved assets
        <Badge
          variant={tab === "assets" ? "secondary" : "outline"}
          className="h-4 px-1.5 text-[10px]"
        >
          {assetCount}
        </Badge>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "searches"}
        onClick={() => onChange("searches")}
        className={cn(
          base,
          tab === "searches"
            ? "bg-accent-blue text-white"
            : "text-muted-foreground hover:bg-muted",
        )}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Saved searches
        <Badge
          variant={tab === "searches" ? "secondary" : "outline"}
          className="h-4 px-1.5 text-[10px]"
        >
          {searchCount}
        </Badge>
      </button>
    </div>
  );
}

function AssetsPane({
  items,
  collections,
  filter,
  onUnsave,
  onAssignCollection,
}: {
  items: FavoriteRecord[];
  collections: CollectionRecord[];
  filter: CollectionFilter;
  onUnsave: (asset: import("@/types/search").SearchAsset) => void;
  onAssignCollection: (
    assetId: string,
    collectionId: string | null,
  ) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <EmptyPane
        title={
          filter === "all"
            ? "No saved assets yet"
            : "No assets in this collection"
        }
        description={
          filter === "all"
            ? "Tap the heart icon on any search result to bookmark it here."
            : "Move saved assets into this collection from the assignment dropdown."
        }
        ctaHref="/search"
        ctaLabel="Start searching"
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <AssetCard
          key={f.assetId}
          favorite={f}
          collections={collections}
          onUnsave={onUnsave}
          onAssignCollection={onAssignCollection}
        />
      ))}
    </div>
  );
}

function AssetCard({
  favorite,
  collections,
  onUnsave,
  onAssignCollection,
}: {
  favorite: FavoriteRecord;
  collections: CollectionRecord[];
  onUnsave: (asset: import("@/types/search").SearchAsset) => void;
  onAssignCollection: (
    assetId: string,
    collectionId: string | null,
  ) => Promise<void>;
}) {
  const quality = favorite.lastCheckedDataQuality ?? null;
  const checkedAt = favorite.lastCheckedAt ?? null;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm">
      <div className="relative aspect-square overflow-hidden bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={favorite.thumbnailUrl}
          alt={favorite.title}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        <button
          type="button"
          aria-label="Unsave"
          onClick={() =>
            onUnsave({
              id: favorite.assetId,
              thumbnailUrl: favorite.thumbnailUrl,
              title: favorite.title,
              downloads: favorite.downloads,
              performanceScore: favorite.performanceScore,
              downloadsPerMonth: 0,
              categories: [],
              contentType: "photo",
              uploadDate: new Date().toISOString(),
              contributorName: favorite.contributorName ?? "",
              contributorId: "",
              isPremium: false,
              isAiGenerated: false,
              keywords: favorite.keywords,
              adobeStockUrl: `https://stock.adobe.com/${favorite.assetId}`,
            })
          }
          className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-md border border-border bg-white text-rose-500 shadow-sm hover:text-rose-600"
        >
          <Heart className="h-4 w-4 fill-current" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-3">
        <div>
          <p className="line-clamp-2 text-sm font-medium" title={favorite.title}>
            {favorite.title}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {favorite.contributorName || "Unknown contributor"} · saved{" "}
            {favorite.savedAt ? timeAgo(favorite.savedAt) : "recently"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <DeltaChip
            label="Downloads"
            savedAt={favorite.downloads}
            current={favorite.lastCheckedDownloads ?? null}
            checkedAt={checkedAt}
            dataQuality={quality}
            suffix=" dl"
          />
          <DeltaChip
            label="Performance"
            savedAt={favorite.performanceScore}
            current={favorite.lastCheckedPerformanceScore ?? null}
            checkedAt={checkedAt}
            dataQuality={quality}
            suffix="/100"
          />
        </div>

        <CollectionPicker
          currentId={favorite.collectionId ?? null}
          collections={collections}
          onChange={(id) => onAssignCollection(favorite.assetId, id)}
        />

        <div className="mt-auto flex items-center justify-between text-xs">
          <a
            href={`https://stock.adobe.com/${favorite.assetId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 font-medium text-accent-blue hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View on Adobe Stock
          </a>
          <DataQualityBadge level={quality ?? "demo"} size="xs" />
        </div>
      </div>
    </div>
  );
}

function SearchesPane({
  items,
  collections,
  filter,
  onRemove,
  onAssignCollection,
}: {
  items: SavedSearchRecord[];
  collections: CollectionRecord[];
  filter: CollectionFilter;
  onRemove: (id: string) => void;
  onAssignCollection: (id: string, collectionId: string | null) => Promise<void>;
}) {
  if (items.length === 0) {
    return (
      <EmptyPane
        title={
          filter === "all"
            ? "No saved searches yet"
            : "No saved searches in this collection"
        }
        description={
          filter === "all"
            ? "Run a search and use the Save this search button on the results page to pin it here."
            : "Move saved searches into this collection from the assignment dropdown."
        }
        ctaHref="/search"
        ctaLabel="Go to search"
      />
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-card">
      <table className="min-w-full text-sm">
        <thead className="bg-muted/40 text-left">
          <tr>
            <th className="px-3 py-2 font-semibold">Keyword</th>
            <th className="px-3 py-2 font-semibold">Filters</th>
            <th className="px-3 py-2 font-semibold">Saved from</th>
            <th className="px-3 py-2 font-semibold">Collection</th>
            <th className="px-3 py-2 font-semibold">Saved</th>
            <th className="px-3 py-2 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((s) => (
            <tr key={s.id} className="border-t border-border align-top">
              <td className="px-3 py-2">
                <Link
                  href={buildSearchHref(s)}
                  className="font-medium text-accent-blue hover:underline"
                  title="Re-run this search"
                >
                  {s.name || s.keyword}
                </Link>
                {s.name ? (
                  <p className="text-[11px] text-muted-foreground">
                    keyword: {s.keyword}
                  </p>
                ) : null}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="capitalize">
                    {s.contentType}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {s.sort.replace(/_/g, " ")}
                  </Badge>
                  {s.aiFilter !== "all" ? (
                    <Badge variant="outline" className="uppercase">
                      {s.aiFilter === "ai_only" ? "AI only" : "No AI"}
                    </Badge>
                  ) : null}
                  {s.resultCount != null ? (
                    <span>· {formatNumber(s.resultCount)} results</span>
                  ) : null}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="flex flex-col gap-1">
                  <DataQualityBadge level={s.dataQuality} size="xs" />
                  <span className="text-[11px] text-muted-foreground">
                    {s.providerName}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {s.datasetScope === "selected_dataset"
                      ? "Dataset"
                      : s.datasetScope === "all_datasets"
                        ? "All datasets"
                        : "Demo data"}
                  </span>
                </div>
              </td>
              <td className="px-3 py-2">
                <CollectionPicker
                  currentId={s.collectionId ?? null}
                  collections={collections}
                  onChange={(id) => onAssignCollection(s.id, id)}
                />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                {timeAgo(s.createdAt)}
              </td>
              <td className="px-3 py-2 text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  <Button asChild variant="outline" size="sm">
                    <Link href={buildSearchHref(s)}>
                      <Search className="h-3 w-3" />
                      Re-run
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-600"
                    onClick={() => {
                      if (confirm(`Delete saved search "${s.name || s.keyword}"?`)) {
                        onRemove(s.id);
                      }
                    }}
                    aria-label="Delete saved search"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CollectionPicker({
  currentId,
  collections,
  onChange,
}: {
  currentId: string | null;
  collections: CollectionRecord[];
  onChange: (id: string | null) => void;
}) {
  return (
    <select
      className="w-full max-w-[180px] rounded-md border border-border bg-card px-2 py-1 text-xs"
      value={currentId ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : v);
      }}
      aria-label="Assign to collection"
    >
      <option value="">Uncategorized</option>
      {collections.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

function buildSearchHref(s: SavedSearchRecord): string {
  const params = new URLSearchParams();
  params.set("q", s.keyword);
  if (s.sort !== "relevance") params.set("sort", s.sort);
  if (s.contentType !== "all") params.set("contentType", s.contentType);
  if (s.aiFilter !== "all") params.set("aiFilter", s.aiFilter);
  return `/search?${params.toString()}`;
}

function EmptyPane({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description: string;
  ctaHref: string;
  ctaLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
      <ImageIcon className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <Button asChild variant="accent" size="sm" className="mt-3">
        <Link href={ctaHref}>{ctaLabel}</Link>
      </Button>
    </div>
  );
}

function EmptyLibrary() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Heart className="h-4 w-4 text-rose-500" />
          Your library is empty
        </CardTitle>
        <CardDescription>
          Heart an asset or save a search to get started.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="accent">
            <Link href="/search">
              <Search className="h-4 w-4" />
              Go to search
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/import">Import CSV</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SavedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-72 w-full rounded-xl" />
      ))}
    </div>
  );
}
