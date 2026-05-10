"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Bookmark, Check } from "lucide-react";
import { TopBar } from "@/components/layout/topbar";
import { SearchBar } from "@/components/search/search-bar";
import { SearchFilters } from "@/components/search/search-filters";
import { ResultsSummary } from "@/components/search/results-summary";
import { ResultsToolbar } from "@/components/search/results-toolbar";
import { ResultCard } from "@/components/search/result-card";
import { Pagination } from "@/components/search/pagination";
import { RecentSearches } from "@/components/search/recent-searches";
import { Button } from "@/components/ui/button";
import {
  SimilarImageSearch,
  type SimilarImageQuery,
} from "@/components/search/similar-image-search";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useFavorites } from "@/hooks/use-favorites";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBanner } from "@/components/layout/data-source-banner";
import { NoDataState } from "@/components/ui/no-data-state";
import { useActiveDataset } from "@/hooks/use-active-dataset";
import type { DatasetScope, DatasetScopeInfo } from "@/lib/dataset-scope";
import type {
  AiFilter,
  ContentType,
  SearchAsset,
  SearchResponse,
  SimilarAsset,
  SimilarSearchResponse,
  SortMode,
} from "@/types/search";
import type { ProviderCapabilities } from "@/lib/providers/types";

// The /api/search route now echoes back the resolved scope so we can render
// the banner + export payload without a second fetch. We widen SearchResponse
// locally with those optional fields.
interface SearchResponseWithScope extends SearchResponse {
  datasetScope?: DatasetScope;
  datasetName?: string | null;
  scopeReason?: DatasetScopeInfo["reason"];
  hasAnyDatasets?: boolean;
  capabilities?: ProviderCapabilities;
  notice?: string;
  /** PR #23: true when no real data source is configured and the response
   *  is an honest empty envelope rather than silently-substituted mock. */
  noDataConfigured?: boolean;
}

interface SimilarResponseWithScope extends SimilarSearchResponse {
  datasetScope?: DatasetScope;
  datasetName?: string | null;
  scopeReason?: DatasetScopeInfo["reason"];
  hasAnyDatasets?: boolean;
  capabilities?: ProviderCapabilities;
}

/**
 * Module-level guard for the initial-URL search effect.
 *
 * React 18 Strict Mode mounts this component, unmounts it, and mounts
 * it again — on purpose — the first time the user navigates to
 * `/search?q=<keyword>`. Component-level refs (`didMountRef`,
 * `lastSignatureRef`) are recreated by the second mount, so the
 * mount-only URL effect re-fires and the browser sends a second POST
 * to `/api/search`. The server's SearchHistory insert for the first
 * POST had already happened by the time the second one lands, so
 * client-side aborting doesn't help — we'd still see `Searches Today`
 * increment by +2 and two `SearchHistory` rows for one user action.
 *
 * This ref lives at module scope, so it survives the Strict-Mode
 * unmount/remount cycle and blocks the duplicate fetch client-side
 * before the request is even issued. The dedup signature includes
 * the full query + filter set so two genuinely different initial
 * URLs (`?q=a`, `?q=b`) both get a chance to run exactly once.
 *
 * The entry carries a timestamp so navigating away and coming back
 * (e.g. client-side navigation Home → Search → Home → Search) after
 * the window has elapsed still re-runs the search and the user sees
 * fresh data. The window matches the server-side dedup TTL so the
 * two layers stay in sync: within the window the server skips the
 * duplicate write, outside it the server counts a fresh search (and
 * the client happily issues one).
 *
 * Server-side there's a second layer of defense in
 * `src/lib/search-dedup.ts` keyed off the same tuple — the client
 * guard is the first line so we don't even send the duplicate
 * request, the server guard catches the edge cases (page refresh,
 * back-forward, new-tab-same-URL) that a module-level client ref
 * can't see.
 */
const INITIAL_URL_GUARD_TTL_MS = 30_000;
let LAST_INITIAL_URL_SEARCH: { sig: string; at: number } | null = null;

/**
 * Friendly rate-limit banner state shown when /api/search returns 429.
 * PR #20 QA fix: the previous build surfaced the raw HTTP error
 * ("Search failed (429)") with no context. The server already returns
 * a structured 429 body describing the plan + remaining counter; we now
 * render it as a dedicated banner with an upgrade CTA to /pricing
 * instead of tunneling it through the generic `error` string.
 */
interface RateLimitState {
  message: string;
  plan?: string | null;
  limit?: number | null;
  used?: number | null;
}

/**
 * Params describing one concrete search request. Extracted into its own
 * type so every trigger (mount, filter change, pagination, scope change,
 * recent-search pick) flows through a single `runSearch(params)` call.
 * Before PR #20 the search page had three separate `useEffect`s that each
 * independently called runSearch on state updates, and the API route +
 * URL push both triggered an extra run — one user search action produced
 * two `SearchHistory` rows and incremented Searches Today by +2.
 */
interface SearchParams {
  keyword: string;
  sort: SortMode;
  contentType: ContentType;
  aiFilter: AiFilter;
  page: number;
}

function SearchPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialQ = sp.get("q") ?? "";
  // Saved searches bring their filter set back via URL params — honor
  // whatever is there on first render so "Re-run" from /saved lands on
  // the exact same query the user pinned. Unknown values fall back to
  // defaults because the caller's list is constrained by Zod on POST.
  const initialSort = (sp.get("sort") as SortMode | null) ?? "relevance";
  const initialContentType =
    (sp.get("contentType") as ContentType | null) ?? "all";
  const initialAiFilter = (sp.get("aiFilter") as AiFilter | null) ?? "all";

  const [keyword, setKeyword] = useState(initialQ);
  const [sort, setSort] = useState<SortMode>(initialSort);
  const [contentType, setContentType] = useState<ContentType>(initialContentType);
  const [aiFilter, setAiFilter] = useState<AiFilter>(initialAiFilter);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponseWithScope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<RateLimitState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toolbarSort, setToolbarSort] = useState<"default" | "downloads" | "performance">("default");
  const [exporting, setExporting] = useState(false);
  // "Save this search" UI state. `saveStatus` toggles between idle, saving,
  // and a brief "saved" confirmation banner. We deliberately avoid a
  // modal — the button POSTs with the current filters and surfaces a
  // link to /saved inline so the user can keep searching.
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // Similar Image Search panel state — separate from keyword search so
  // the user can flip between the two flows without losing either's data.
  const [byImageOpen, setByImageOpen] = useState(false);
  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarError, setSimilarError] = useState<string | null>(null);
  const [similarData, setSimilarData] =
    useState<SimilarResponseWithScope | null>(null);
  const [similarSeedUrl, setSimilarSeedUrl] = useState<string | undefined>(
    undefined,
  );
  const [similarSelected, setSimilarSelected] = useState<Set<string>>(
    new Set(),
  );
  const [similarExporting, setSimilarExporting] = useState(false);

  // Mirror the global selector so the empty-state banner can describe the
  // user's scope even before they run a search.
  const active = useActiveDataset();

  const { items: recents, add: addRecent, remove: removeRecent, clear: clearRecents } = useRecentSearches();
  const { isFavorited, toggle: toggleFavorite } = useFavorites();

  /**
   * PR #20 dedupe guard. Holds the signature of the most recent
   * in-flight (or just-completed) search. We check it before issuing a
   * fetch so React's double-rendering, URL sync, and scope-change
   * effect cannot fire the same request twice. Each user-driven action
   * that should force a re-run (filter change, manual resubmit,
   * pagination) passes `force: true` to bypass the guard and still get
   * fresh results.
   */
  const lastSignatureRef = useRef<string | null>(null);
  /**
   * AbortController for the in-flight `/api/search` fetch. When a new
   * search is dispatched we abort the previous one so only one response
   * ever lands — this is both a correctness fix (prevents a slower
   * response from overwriting a newer one) and a second layer of
   * defense against the duplicate-counter bug: an aborted request
   * never records a server-side SearchHistory row.
   */
  const searchAbortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (params: SearchParams, opts?: { force?: boolean }) => {
      const { keyword: kw, sort: so, contentType: ct, aiFilter: ai, page: pg } =
        params;
      if (!kw || !kw.trim()) return;
      const signature = `${kw}\0${so}\0${ct}\0${ai}\0${pg}`;
      if (!opts?.force && lastSignatureRef.current === signature) {
        return;
      }
      lastSignatureRef.current = signature;
      // Abort any in-flight search before starting a new one.
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      setLoading(true);
      setError(null);
      setRateLimit(null);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            keyword: kw,
            sort: so,
            contentType: ct,
            aiFilter: ai,
            page: pg,
          }),
          signal: controller.signal,
        });
        if (res.status === 429) {
          // Plan-gated daily search cap. Server body shape:
          //   { error, message, plan, limit, used, remaining }
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
            plan?: string;
            limit?: number;
            used?: number;
          };
          setRateLimit({
            message:
              body.message ??
              "Daily search limit reached. Upgrade your plan to continue searching.",
            plan: body.plan ?? null,
            limit: body.limit ?? null,
            used: body.used ?? null,
          });
          setData(null);
          return;
        }
        if (!res.ok) {
          throw new Error(`Search failed (${res.status})`);
        }
        const json = (await res.json()) as SearchResponseWithScope;
        if (controller.signal.aborted) return;
        setData(json);
        setPage(pg);
        setSelected(new Set());
        addRecent(kw);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [addRecent],
  );

  /**
   * PR #20: single mount-once effect replaces the old `[initialQ]` effect
   * that fired every time the URL changed. `handleSubmit` now drives all
   * subsequent searches directly, so the URL effect can be a one-shot.
   *
   * PR #21: strengthened with a module-scope signature
   * (`LAST_INITIAL_URL_SEARCH_SIG`) so React Strict Mode's
   * unmount/remount cycle can't re-fire the same initial-URL search
   * and produce a duplicate `SearchHistory` row. The signature covers
   * keyword + sort + contentType + aiFilter + initial page so two
   * genuinely different initial URLs still each get one run.
   *
   * The call also drops `{ force: true }` — the signature guard
   * inside `runSearch` is sufficient here, and keeping force=true
   * was bypassing that guard on the second Strict-Mode mount.
   */
  const didMountRef = useRef(false);
  useEffect(() => {
    if (didMountRef.current) return;
    didMountRef.current = true;
    if (!initialQ) return;
    // `\x00` separator between fields + literal `1` for the initial page.
    // NOTE: written as `\0` + `1` would parse as the octal escape `\01`
    // which TypeScript's strict mode rejects — keep the explicit `\x00`
    // form so the scanner never mistakes it for an octal literal.
    const sig = `${initialQ}\x00${initialSort}\x00${initialContentType}\x00${initialAiFilter}\x001`;
    const now = Date.now();
    if (
      LAST_INITIAL_URL_SEARCH &&
      LAST_INITIAL_URL_SEARCH.sig === sig &&
      now - LAST_INITIAL_URL_SEARCH.at < INITIAL_URL_GUARD_TTL_MS
    ) {
      // Same initial URL as the last one we just ran within the TTL
      // window — must be a Strict-Mode remount or an instant
      // back-forward to the same URL. Skip the duplicate POST.
      return;
    }
    LAST_INITIAL_URL_SEARCH = { sig, at: now };
    void runSearch(
      {
        keyword: initialQ,
        sort: initialSort,
        contentType: initialContentType,
        aiFilter: initialAiFilter,
        page: 1,
      },
    );
    // We want this to run exactly once. initialQ/initialSort/... are
    // derived from the URL at mount and never re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Abort any in-flight request on unmount. Prevents the dedupe ref from
  // pinning a never-reconciled signature across client-side navigations.
  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
    };
  }, []);

  /**
   * Dataset-selector change re-runs the current keyword so the displayed
   * results always match the active data source. Skips the first render
   * (mount effect handles that) and skips when there's no keyword yet.
   *
   * Uses a ref to tell "real scope change" apart from "first reconcile
   * after mount" — without it the effect would fire once on mount after
   * the active-dataset hook finishes loading and re-emit a search that
   * was already performed, producing a duplicate SearchHistory row.
   */
  const scopeKey = useMemo(() => JSON.stringify(active.scope), [active.scope]);
  const lastScopeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (active.loading) return;
    if (lastScopeKeyRef.current === null) {
      lastScopeKeyRef.current = scopeKey;
      return;
    }
    if (lastScopeKeyRef.current === scopeKey) return;
    lastScopeKeyRef.current = scopeKey;
    if (keyword) {
      void runSearch(
        { keyword, sort, contentType, aiFilter, page: 1 },
        { force: true },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, active.loading]);

  const handleSubmit = useCallback(
    (kw: string) => {
      setKeyword(kw);
      const params = new URLSearchParams(sp.toString());
      params.set("q", kw);
      // router.replace (not push) so back-button doesn't collect one
      // history entry per keystroke-then-search. Also avoids kicking
      // off a duplicate render cycle.
      router.replace(`/search?${params.toString()}`);
      void runSearch(
        { keyword: kw, sort, contentType, aiFilter, page: 1 },
        { force: true },
      );
    },
    [router, runSearch, sort, contentType, aiFilter, sp],
  );

  const handleFiltersChange = useCallback(
    (next: Partial<{ sort: SortMode; contentType: ContentType; aiFilter: AiFilter }>) => {
      const nextSort = next.sort ?? sort;
      const nextContentType = next.contentType ?? contentType;
      const nextAiFilter = next.aiFilter ?? aiFilter;
      if (next.sort !== undefined) setSort(next.sort);
      if (next.contentType !== undefined) setContentType(next.contentType);
      if (next.aiFilter !== undefined) setAiFilter(next.aiFilter);
      if (!keyword) return;
      void runSearch(
        {
          keyword,
          sort: nextSort,
          contentType: nextContentType,
          aiFilter: nextAiFilter,
          page: 1,
        },
        { force: true },
      );
    },
    [sort, contentType, aiFilter, keyword, runSearch],
  );

  const sortedResults = useMemo(() => {
    if (!data) return [] as SearchAsset[];
    const out = [...data.results];
    if (toolbarSort === "downloads") out.sort((a, b) => b.downloads - a.downloads);
    if (toolbarSort === "performance") out.sort((a, b) => b.performanceScore - a.performanceScore);
    return out;
  }, [data, toolbarSort]);

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!data) return;
    if (selected.size === data.results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(data.results.map((r) => r.id)));
    }
  }, [data, selected.size]);

  const handleExport = useCallback(async () => {
    if (!data) return;
    const targets = selected.size > 0
      ? data.results.filter((r) => selected.has(r.id))
      : data.results;
    setExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "search",
          query: keyword,
          results: targets,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          // The export history table lives or dies on knowing which scope
          // produced each export; carry it through explicitly instead of
          // re-deriving server-side (which would miss the "demo fallback
          // after orphan" case).
          datasetScope: data.datasetScope,
          params: { keyword, sort, contentType, aiFilter },
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sn-search-${keyword.replace(/\s+/g, "-")}-${
        new Date().toISOString().slice(0, 10)
      }.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [data, keyword, selected, sort, contentType, aiFilter]);

  /**
   * Save the current keyword + filters as a pinned `SavedSearch`. The
   * server snapshots the active provider + data-quality + dataset scope
   * at this moment so the saved row stays honest even if the user later
   * switches provider or archives the underlying dataset.
   *
   * We use the resolved scope from the most recent search response
   * (`data.datasetScope`) rather than the selector's live state so the
   * saved row matches what's actually on screen — the two can diverge
   * briefly while the selector change is being applied.
   */
  const handleSaveSearch = useCallback(async () => {
    if (!keyword || !data) return;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch("/api/saved-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword,
          sort,
          contentType,
          aiFilter,
          resultCount: data.totalResults,
          dataQuality: data.dataQuality,
          providerName: data.providerName,
          providerId: data.providerId,
          datasetScope: data.datasetScope,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        // Signed-out users get a 401 — surface a helpful next step rather
        // than a generic error string.
        if (res.status === 401) {
          setSaveError("Sign in to save searches to your account.");
        } else {
          setSaveError(body.error ?? `Save failed (${res.status})`);
        }
        setSaveStatus("error");
        return;
      }
      setSaveStatus("saved");
      // Fade the "Saved" banner after a short delay so repeat saves
      // still feel responsive.
      setTimeout(() => {
        setSaveStatus((s) => (s === "saved" ? "idle" : s));
      }, 4000);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
      setSaveStatus("error");
    }
  }, [keyword, data, sort, contentType, aiFilter]);

  const runSimilar = useCallback(
    async (q: SimilarImageQuery) => {
      setSimilarLoading(true);
      setSimilarError(null);
      try {
        const res = await fetch("/api/search/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...q,
            contentType,
            aiFilter,
            datasetScope: active.scope,
          }),
        });
        const json = (await res.json()) as
          | SimilarResponseWithScope
          | { error: string; issues?: unknown };
        if (!res.ok) {
          const msg =
            "error" in json && typeof json.error === "string"
              ? json.error
              : `Similar search failed (${res.status})`;
          throw new Error(msg);
        }
        setSimilarData(json as SimilarResponseWithScope);
        setSimilarSelected(new Set());
      } catch (e) {
        setSimilarError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setSimilarLoading(false);
      }
    },
    [contentType, aiFilter, active.scope],
  );

  const clearSimilar = useCallback(() => {
    setSimilarData(null);
    setSimilarError(null);
    setSimilarSelected(new Set());
    setSimilarSeedUrl(undefined);
  }, []);

  const toggleSimilarSelected = useCallback((id: string) => {
    setSimilarSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllSimilar = useCallback(() => {
    if (!similarData) return;
    if (similarSelected.size === similarData.results.length) {
      setSimilarSelected(new Set());
    } else {
      setSimilarSelected(new Set(similarData.results.map((r) => r.id)));
    }
  }, [similarData, similarSelected.size]);

  const handleSimilarExport = useCallback(async () => {
    if (!similarData) return;
    const targets: SimilarAsset[] =
      similarSelected.size > 0
        ? similarData.results.filter((r) => similarSelected.has(r.id))
        : similarData.results;
    if (targets.length === 0) return;
    setSimilarExporting(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "similar",
          query:
            similarData.query.imageUrl ??
            similarData.query.imageFileName ??
            similarData.query.hint ??
            "similar",
          results: targets,
          dataQuality: similarData.dataQuality,
          providerName: similarData.providerName,
          datasetScope: similarData.datasetScope,
          params: {
            imageUrl: similarData.query.imageUrl,
            imageFileName: similarData.query.imageFileName,
            hint: similarData.query.hint,
            queryTokens: similarData.queryTokens,
            contentType,
            aiFilter,
          },
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (
        similarData.query.imageFileName ??
        similarData.query.imageUrl ??
        "similar"
      )
        .replace(/[^a-z0-9]+/gi, "-")
        .slice(0, 60) || "similar";
      a.download = `sn-similar-${safeName}-${
        new Date().toISOString().slice(0, 10)
      }.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setSimilarExporting(false);
    }
  }, [similarData, similarSelected, contentType, aiFilter]);

  const handleFindSimilarFromCard = useCallback(
    (asset: SearchAsset) => {
      setByImageOpen(true);
      const url =
        (asset.adobeStockUrl && asset.adobeStockUrl.startsWith("http")
          ? asset.adobeStockUrl
          : asset.thumbnailUrl) ?? "";
      setSimilarSeedUrl(url);
      void runSimilar({ imageUrl: url, hint: asset.title });
      // Surface the panel for the user.
      if (typeof window !== "undefined") {
        requestAnimationFrame(() => {
          document
            .getElementById("similar-image-search-panel")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    },
    [runSimilar],
  );

  return (
    <>
      <TopBar
        title="Search"
        subtitle="Find Adobe Stock keywords and analyze performance"
      />
      <div className="space-y-6 p-6">
        <div className="space-y-4 rounded-2xl border border-border/40 bg-card p-5 shadow-sm">
          <SearchBar
            defaultValue={keyword}
            loading={loading}
            onSubmit={handleSubmit}
            onToggleByImage={() => setByImageOpen((v) => !v)}
            byImageActive={byImageOpen}
          />
          <SearchFilters
            sort={sort}
            contentType={contentType}
            aiFilter={aiFilter}
            onChange={handleFiltersChange}
          />
          <RecentSearches
            items={recents}
            onPick={handleSubmit}
            onRemove={removeRecent}
            onClear={clearRecents}
          />
        </div>

        {byImageOpen && (
          <div id="similar-image-search-panel" className="space-y-4">
            <SimilarImageSearch
              seedImageUrl={similarSeedUrl}
              loading={similarLoading}
              hasResults={Boolean(similarData)}
              onFindSimilar={runSimilar}
              onClear={clearSimilar}
            />

            {similarError && (
              <div
                role="alert"
                className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {similarError}
              </div>
            )}

            {similarLoading && !similarData && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-[480px] w-full" />
                ))}
              </div>
            )}

            {similarData && (
              <>
                <DataSourceBanner
                  scope={similarData.datasetScope ?? active.scope}
                  datasetName={similarData.datasetName ?? active.datasetName}
                  hasAnyDatasets={
                    similarData.hasAnyDatasets ?? active.hasAnyDatasets
                  }
                  reason={similarData.scopeReason ?? active.reason}
                  dataQuality={similarData.dataQuality}
                  providerName={similarData.providerName}
                />

                {similarData.notice ? (
                  <div
                    role="status"
                    className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900"
                  >
                    <p className="font-semibold uppercase tracking-wide">
                      Heads up · {similarData.providerName}
                    </p>
                    <p className="mt-0.5 text-[12px] leading-snug">
                      {similarData.notice}
                    </p>
                    {similarData.queryTokens.length > 0 && (
                      <p className="mt-1 text-[11px] text-violet-800/80">
                        Matching against tokens:{" "}
                        <span className="font-mono">
                          {similarData.queryTokens.slice(0, 12).join(", ")}
                        </span>
                      </p>
                    )}
                  </div>
                ) : null}

                <ResultsToolbar
                  total={similarData.results.length}
                  selectedCount={similarSelected.size}
                  toolbarSort="default"
                  onSortChange={() => {}}
                  onSelectAll={selectAllSimilar}
                  onExport={handleSimilarExport}
                  exporting={similarExporting}
                />

                {similarData.results.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                    <p className="text-sm font-medium">
                      No similar results found
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {similarData.providerId === "official"
                        ? "This provider does not support similar-image search. Switch to demo or imported data, or pick a different image."
                        : "Try a different image, paste a URL with descriptive path segments, or add a hint."}
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {similarData.results.map((asset) => (
                      <ResultCard
                        key={asset.id}
                        asset={asset}
                        isFavorited={isFavorited(asset.id)}
                        onToggleFavorite={toggleFavorite}
                        selected={similarSelected.has(asset.id)}
                        onToggleSelected={toggleSimilarSelected}
                        dataQuality={similarData.dataQuality}
                        providerId={similarData.providerId}
                        similarityScore={asset.similarityScore}
                        similarityAvailable={asset.similarityAvailable}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Rate-limit banner. Replaces the old "Search failed (429)" raw
            error path. Renders a friendly copy + upgrade CTA to /pricing
            so a free-tier user who hits the 2/day cap has a clear next
            step. Owners / Pro / Annual never reach this branch because
            the server side reports `maxSearchesPerDay: "unlimited"` and
            returns a normal 200 response. */}
        {rateLimit && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
              <div className="min-w-0">
                <p className="font-semibold">
                  Daily search limit reached. Upgrade your plan to continue searching.
                </p>
                <p className="mt-0.5 text-[12px] text-amber-900/80">
                  {rateLimit.plan ? `Plan: ${rateLimit.plan}` : null}
                  {rateLimit.plan && rateLimit.limit != null ? " · " : null}
                  {rateLimit.limit != null
                    ? `${rateLimit.used ?? 0}/${rateLimit.limit} searches used today`
                    : null}
                </p>
              </div>
            </div>
            <Button asChild variant="accent" size="sm" className="flex-none">
              <Link href="/pricing">See plans &amp; upgrade</Link>
            </Button>
          </div>
        )}

        {error && !rateLimit && (
          <div className="rounded-md bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        )}

        {loading && !data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[480px] w-full" />
            ))}
          </div>
        )}

        {data && (
          <>
            <DataSourceBanner
              scope={data.datasetScope ?? active.scope}
              datasetName={data.datasetName ?? active.datasetName}
              hasAnyDatasets={data.hasAnyDatasets ?? active.hasAnyDatasets}
              reason={data.scopeReason ?? active.reason}
              dataQuality={data.dataQuality}
              providerName={data.providerName}
            />

            {data.notice ? (
              <div
                role="status"
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900"
              >
                <p className="font-semibold uppercase tracking-wide">
                  Heads up · {data.providerName}
                </p>
                <p className="mt-0.5 text-[12px] leading-snug">{data.notice}</p>
              </div>
            ) : null}

            <ResultsSummary
              totalResults={data.totalResults}
              keyword={keyword}
              competitionLevel={data.competitionLevel}
              aiSaturation={data.aiSaturation}
              contentBreakdown={data.contentBreakdown}
              dataQuality={data.dataQuality}
            />

            {/* Save-this-search affordance. Sits between the summary and
                the toolbar so it's adjacent to the results the user is
                about to decide are worth pinning. Uses plain HTML `<a>`
                rather than next/link for `/saved` navigation because
                there's nothing to prefetch — the success banner shows
                a link to /saved once the save completes. */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 text-sm">
              <div className="flex items-start gap-2 text-muted-foreground">
                <Bookmark className="mt-0.5 h-4 w-4 flex-none text-accent-blue" />
                <span>
                  Save this keyword + filter set for quick re-run later.
                  <span className="block text-[11px] text-muted-foreground/80">
                    Provider and data-quality are snapshotted at save time.
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {saveStatus === "saved" ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800">
                    <Check className="h-3 w-3" />
                    Saved.{" "}
                    <Link
                      href="/saved"
                      className="underline underline-offset-2"
                    >
                      View in Saved
                    </Link>
                  </span>
                ) : null}
                {saveStatus === "error" && saveError ? (
                  <span className="text-xs text-rose-700">{saveError}</span>
                ) : null}
                <Button
                  type="button"
                  variant={saveStatus === "saved" ? "outline" : "accent"}
                  size="sm"
                  onClick={handleSaveSearch}
                  disabled={saveStatus === "saving"}
                  aria-label="Save this search"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  {saveStatus === "saving"
                    ? "Saving…"
                    : saveStatus === "saved"
                      ? "Save again"
                      : "Save this search"}
                </Button>
              </div>
            </div>

            <ResultsToolbar
              total={data.results.length}
              selectedCount={selected.size}
              toolbarSort={toolbarSort}
              onSortChange={setToolbarSort}
              onSelectAll={selectAll}
              onExport={handleExport}
              exporting={exporting}
            />

            {data.noDataConfigured ? (
              <NoDataState page="search" showDemoOption />
            ) : data.results.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                <p className="text-sm font-medium">
                  No results for <span className="text-foreground">{keyword}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {data.datasetScope?.kind === "specific"
                    ? "This dataset has no assets matching that query. Switch to All datasets from the top-bar selector to search across your other imports."
                    : "Try a different keyword or broaden your filters."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {sortedResults.map((asset) => (
                  <ResultCard
                    key={asset.id}
                    asset={asset}
                    isFavorited={isFavorited(asset.id)}
                    onToggleFavorite={toggleFavorite}
                    selected={selected.has(asset.id)}
                    onToggleSelected={toggleSelected}
                    dataQuality={data.dataQuality}
                    providerId={data.providerId}
                    onFindSimilar={handleFindSimilarFromCard}
                  />
                ))}
              </div>
            )}

            <Pagination
              page={page}
              hasNext={data.results.length >= data.pageSize}
              onChange={(p) =>
                void runSearch(
                  { keyword, sort, contentType, aiFilter, page: p },
                  { force: true },
                )
              }
            />
          </>
        )}

        {!loading && !data && !error && !rateLimit && (
          <div className="space-y-4">
            <DataSourceBanner
              scope={active.scope}
              datasetName={active.datasetName}
              hasAnyDatasets={active.hasAnyDatasets}
              reason={active.reason}
              providerName={
                active.scope.kind === "demo"
                  ? "Mock data provider"
                  : "User imported data"
              }
              dataQuality={active.scope.kind === "demo" ? "demo" : "verified"}
            />
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
              <p className="text-sm">
                Try a demo keyword like{" "}
                <span className="font-medium text-foreground">business</span>,{" "}
                <span className="font-medium text-foreground">nature</span>, or{" "}
                <span className="font-medium text-foreground">ai illustration</span>.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageInner />
    </Suspense>
  );
}
