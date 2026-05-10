"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataQuality, SearchAsset } from "@/types/search";

/**
 * Shape of a favorite row as returned by `/api/favorites`. Matches the
 * `serialize()` helper in that route. Fields may be `null` for rows that
 * predate a schema addition (e.g. `notes` / `collectionId` for rows
 * saved before PR #15).
 */
export interface FavoriteRecord {
  id?: string;
  assetId: string;
  thumbnailUrl: string;
  title: string;
  /** Saved-at snapshot of downloads. Never overwritten by re-saves. */
  downloads: number;
  /** Saved-at snapshot of performance. Never overwritten by re-saves. */
  performanceScore: number;
  contributorName?: string | null;
  keywords: string[];
  savedAt?: string;
  collectionId?: string | null;
  notes?: string | null;
  // Track-changes snapshot (populated by /api/saved/track). `null` means
  // "not yet checked" — the UI must render "Not yet checked" in that case.
  lastCheckedAt?: string | null;
  lastCheckedDownloads?: number | null;
  lastCheckedPerformanceScore?: number | null;
  lastCheckedDataQuality?: DataQuality | null;
  lastCheckedProviderId?: string | null;
}

const LOCAL_KEY = "sn-favorites-local";

function loadLocal(): FavoriteRecord[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw) as FavoriteRecord[];
  } catch {
    // ignore
  }
  return [];
}

function saveLocal(items: FavoriteRecord[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    // ignore
  }
}

/**
 * Client hook for the favorites store.
 *
 * Signed-in users are backed by `/api/favorites`. Guests fall back to
 * localStorage so the heart button still feels responsive — the saved
 * page nudges them to sign in to sync.
 *
 * Exposes `reload` so a consumer (e.g. the /saved page after a track
 * refresh or collection move) can re-pull the authoritative server
 * state without remounting.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.favorites)
        ? (data.favorites as FavoriteRecord[])
        : [];
    } catch {
      return null;
    }
  }, []);

  const reload = useCallback(async () => {
    const server = await fetchFromServer();
    if (server && server.length > 0) {
      setFavorites(server);
    } else if (server) {
      // Server responded with an empty list (signed-in user who cleared
      // their favorites). Respect it — don't fall through to local state.
      setFavorites([]);
    } else {
      setFavorites(loadLocal());
    }
    setLoaded(true);
  }, [fetchFromServer]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const isFavorited = useCallback(
    (assetId: string) => favorites.some((f) => f.assetId === assetId),
    [favorites],
  );

  const toggle = useCallback(
    async (asset: SearchAsset) => {
      const existing = favorites.find((f) => f.assetId === asset.id);
      if (existing) {
        const next = favorites.filter((f) => f.assetId !== asset.id);
        setFavorites(next);
        saveLocal(next);
        try {
          await fetch(`/api/favorites?assetId=${encodeURIComponent(asset.id)}`, {
            method: "DELETE",
          });
        } catch {
          // ignore
        }
      } else {
        const record: FavoriteRecord = {
          assetId: asset.id,
          thumbnailUrl: asset.thumbnailUrl,
          title: asset.title,
          downloads: asset.downloads,
          performanceScore: asset.performanceScore,
          contributorName: asset.contributorName,
          keywords: asset.keywords,
          savedAt: new Date().toISOString(),
        };
        const next = [record, ...favorites];
        setFavorites(next);
        saveLocal(next);
        try {
          await fetch("/api/favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assetId: asset.id,
              thumbnailUrl: asset.thumbnailUrl,
              title: asset.title,
              downloads: asset.downloads,
              performanceScore: asset.performanceScore,
              contributorName: asset.contributorName,
              keywords: asset.keywords,
            }),
          });
        } catch {
          // ignore
        }
      }
    },
    [favorites],
  );

  const assignToCollection = useCallback(
    async (assetId: string, collectionId: string | null) => {
      // Optimistic local update.
      setFavorites((prev) =>
        prev.map((f) =>
          f.assetId === assetId ? { ...f, collectionId } : f,
        ),
      );
      try {
        await fetch("/api/favorites", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, collectionId }),
        });
      } catch {
        // Surface nothing — reload() will correct any drift on next open.
      }
    },
    [],
  );

  const setNotes = useCallback(
    async (assetId: string, notes: string | null) => {
      setFavorites((prev) =>
        prev.map((f) => (f.assetId === assetId ? { ...f, notes } : f)),
      );
      try {
        await fetch("/api/favorites", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, notes }),
        });
      } catch {
        // ignore
      }
    },
    [],
  );

  return {
    favorites,
    isFavorited,
    toggle,
    loaded,
    reload,
    assignToCollection,
    setNotes,
  };
}
