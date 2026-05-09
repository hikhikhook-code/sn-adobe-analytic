"use client";

import { useCallback, useEffect, useState } from "react";
import type { SearchAsset } from "@/types/search";

interface FavoriteRecord {
  id?: string;
  assetId: string;
  thumbnailUrl: string;
  title: string;
  downloads: number;
  performanceScore: number;
  contributorName?: string | null;
  keywords: string[];
  savedAt?: string;
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

export function useFavorites() {
  const [favorites, setFavorites] = useState<FavoriteRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const fetchFromServer = useCallback(async () => {
    try {
      const res = await fetch("/api/favorites");
      if (!res.ok) return null;
      const data = await res.json();
      return Array.isArray(data.favorites) ? (data.favorites as FavoriteRecord[]) : [];
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const server = await fetchFromServer();
      if (!active) return;
      if (server && server.length > 0) {
        setFavorites(server);
      } else {
        setFavorites(loadLocal());
      }
      setLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, [fetchFromServer]);

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
            body: JSON.stringify(record),
          });
        } catch {
          // ignore
        }
      }
    },
    [favorites],
  );

  return { favorites, isFavorited, toggle, loaded };
}
