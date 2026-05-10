"use client";

import { useCallback, useEffect, useState } from "react";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";
import type {
  DataQuality,
  ProviderCapabilities,
  ProviderDashboardResult,
} from "@/lib/providers/types";
import { ACTIVE_DATASET_CHANGED_EVENT } from "@/hooks/use-active-dataset";

/**
 * Shape of the saved-asset preview rows served by `GET /api/dashboard`.
 * The API tags each row with the active provider's data quality so the
 * UI can show a single consistent badge per row.
 */
export interface DashboardSavedAsset {
  id: string;
  assetId: string;
  thumbnailUrl: string;
  title: string;
  contributorName: string | null;
  downloads: number;
  performanceScore: number;
  keywords: string[];
  savedAt: string;
  dataQuality: DataQuality;
  providerName: string;
}

export interface DashboardRecentSearch {
  id: string;
  keyword: string;
  sort: string;
  contentType: string;
  aiFilter: string;
  resultCount: number | null;
  createdAt: string;
}

/**
 * Full response shape returned by `GET /api/dashboard`. Keep this
 * hand-written (rather than inferred) so we catch accidental backend
 * changes at the type layer rather than at runtime.
 */
export interface DashboardResponse {
  signedIn: boolean;
  hasImportedData: boolean;
  searchesToday: number;
  savedAssets: number;
  exportsMade: number;
  trackedContributors: number;
  importedAssets: number;
  datasetScope: DatasetScope;
  datasetName: string | null;
  scopeReason: DatasetScopeInfo["reason"];
  recentSearches: DashboardRecentSearch[];
  savedAssetsPreview: DashboardSavedAsset[];
  analytics: ProviderDashboardResult;
  provider: {
    id: string;
    name: string;
    dataQuality: DataQuality;
    capabilities?: ProviderCapabilities;
    notice?: string;
  };
}

interface UseDashboardDataResult {
  data: DashboardResponse | null;
  user: DashboardUser | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Minimal user info surfaced by `/api/user/me`. Kept narrow on purpose —
 * the dashboard only needs the plan label + today's search counter to
 * render the Plan Usage preview card.
 */
export interface DashboardUser {
  id: string;
  name: string | null;
  email: string;
  plan: string;
  searchesUsedToday: number;
}

/**
 * Client hook that fetches `/api/dashboard` and transparently refetches
 * whenever the user changes the active dataset via the top-bar selector
 * (which broadcasts `ACTIVE_DATASET_CHANGED_EVENT`). Kept independent of
 * `useActiveDataset` so the dashboard page can consume the rollup without
 * pulling the selector state into every widget prop.
 */
export function useDashboardData(): UseDashboardDataResult {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [user, setUser] = useState<DashboardUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIt = useCallback(async () => {
    setError(null);
    try {
      const [dashRes, meRes] = await Promise.all([
        fetch("/api/dashboard", { cache: "no-store" }),
        // `/api/user/me` is cheap and already supports guests (returns
        // `{ user: null }`). Failing here must not block the dashboard,
        // so we best-effort it and treat a non-200 as "no user info".
        fetch("/api/user/me", { cache: "no-store" }).catch(() => null),
      ]);
      if (!dashRes.ok) throw new Error(`HTTP ${dashRes.status}`);
      const j = (await dashRes.json()) as DashboardResponse;
      setData(j);
      if (meRes && meRes.ok) {
        const me = (await meRes.json()) as { user: DashboardUser | null };
        setUser(me.user);
      } else {
        setUser(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchIt();
    if (typeof window === "undefined") return;
    const onChange = () => {
      setLoading(true);
      void fetchIt();
    };
    window.addEventListener(ACTIVE_DATASET_CHANGED_EVENT, onChange);
    return () =>
      window.removeEventListener(ACTIVE_DATASET_CHANGED_EVENT, onChange);
  }, [fetchIt]);

  return { data, user, loading, error, refetch: fetchIt };
}
