"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Collection record as served by `/api/collections`. `favoriteCount` and
 * `searchCount` are included on every GET so the sidebar can render
 * "Travel (12)" without a follow-up query per folder.
 */
export interface CollectionRecord {
  id: string;
  name: string;
  description: string | null;
  favoriteCount: number;
  searchCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Client hook for the user's Collections. Returns the list plus CRUD
 * helpers that optimistically update local state, then let the next
 * `reload()` reconcile with the server.
 *
 * A single surface ({create, rename, remove}) keeps the /saved page from
 * owning the fetch boilerplate.
 */
export function useCollections() {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/collections", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { collections: CollectionRecord[] };
      setCollections(j.collections ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load collections");
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string, description?: string) => {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await reload();
    },
    [reload],
  );

  const rename = useCallback(
    async (id: string, name: string, description?: string | null) => {
      const res = await fetch(`/api/collections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await reload();
    },
    [reload],
  );

  const remove = useCallback(
    async (id: string) => {
      // Optimistic hide. On error we reload from server which puts it
      // back if the delete actually failed.
      setCollections((prev) => prev.filter((c) => c.id !== id));
      const res = await fetch(`/api/collections/${id}`, { method: "DELETE" });
      if (!res.ok) {
        await reload();
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
    },
    [reload],
  );

  return { collections, loaded, error, reload, create, rename, remove };
}
