"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataQuality } from "@/types/search";

/**
 * Saved-search record returned by `/api/saved-searches`. Fields mirror
 * the Prisma model 1:1 with strings for dates so JSON stays stable across
 * the serialize boundary.
 */
export interface SavedSearchRecord {
  id: string;
  name: string | null;
  keyword: string;
  sort: string;
  contentType: string;
  aiFilter: string;
  resultCount: number | null;
  dataQuality: DataQuality;
  providerName: string;
  providerId: string | null;
  datasetScope: "all_datasets" | "selected_dataset" | "demo_data";
  datasetId: string | null;
  collectionId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Client hook for saved searches.
 *
 * Sticks to the same optimistic-then-reload pattern as `useCollections`
 * so the /saved page doesn't grow a second refetch dialect.
 */
export function useSavedSearches() {
  const [savedSearches, setSavedSearches] = useState<SavedSearchRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/saved-searches", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { savedSearches: SavedSearchRecord[] };
      setSavedSearches(j.savedSearches ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load saved searches");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = useCallback(
    async (id: string) => {
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      try {
        await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
      } catch {
        await reload();
      }
    },
    [reload],
  );

  const assignToCollection = useCallback(
    async (id: string, collectionId: string | null) => {
      setSavedSearches((prev) =>
        prev.map((s) => (s.id === id ? { ...s, collectionId } : s)),
      );
      try {
        await fetch(`/api/saved-searches/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collectionId }),
        });
      } catch {
        await reload();
      }
    },
    [reload],
  );

  return { savedSearches, loaded, error, reload, remove, assignToCollection };
}
