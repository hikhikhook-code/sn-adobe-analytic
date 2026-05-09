"use client";

import { useCallback, useEffect, useState } from "react";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";

/**
 * Lightweight client-side mirror of `DatasetScopeInfo`. Kept in its own
 * file rather than re-exported from `@/lib/dataset-scope` so the server
 * module's Prisma import doesn't leak into the client bundle.
 */
export interface ActiveDatasetState {
  signedIn: boolean;
  scope: DatasetScope;
  reason: DatasetScopeInfo["reason"];
  datasetName: string | null;
  hasAnyDatasets: boolean;
  datasets: { id: string; name: string; rowCount: number }[];
}

const DEFAULT: ActiveDatasetState = {
  signedIn: false,
  scope: { kind: "demo" },
  reason: "guest",
  datasetName: null,
  hasAnyDatasets: false,
  datasets: [],
};

/**
 * Event we dispatch on `window` after a successful PUT to
 * /api/user/active-dataset, so every component using `useActiveDataset`
 * refetches. Avoids a full `router.refresh()` for what is logically a
 * client-side filter change.
 *
 * Exported so pages that mutate datasets (rename / archive / delete on
 * /import) can fire it and keep the selector in sync without a reload.
 */
export const ACTIVE_DATASET_CHANGED_EVENT = "sn:active-dataset-changed";

export function dispatchActiveDatasetChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(ACTIVE_DATASET_CHANGED_EVENT));
  }
}

/**
 * React hook — fetches the user's dataset scope + dataset list and exposes
 * an `update` function that persists a new choice.
 *
 * Designed to be safe to call from any client component: multiple callers
 * independently fetch (no shared cache yet — the payload is tiny). When one
 * caller updates, everyone refetches via the window event.
 */
export function useActiveDataset() {
  const [state, setState] = useState<ActiveDatasetState>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/user/active-dataset", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as ActiveDatasetState;
      setState(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
    if (typeof window === "undefined") return;
    const onChange = () => void refetch();
    window.addEventListener(ACTIVE_DATASET_CHANGED_EVENT, onChange);
    return () =>
      window.removeEventListener(ACTIVE_DATASET_CHANGED_EVENT, onChange);
  }, [refetch]);

  const update = useCallback(
    async (
      choice: { kind: "all" } | { kind: "demo" } | { kind: "specific"; datasetId: string },
    ) => {
      const res = await fetch("/api/user/active-dataset", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      dispatchActiveDatasetChanged();
    },
    [],
  );

  return { ...state, loading, error, refetch, update };
}
