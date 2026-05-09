/**
 * Dataset scope is the single source of truth for "which data powers the
 * current request". Every analytics surface (search, dashboard, portfolio,
 * heat map, trending, export) flows through a resolved `DatasetScope`, so
 * changing what the user sees means changing one thing.
 *
 * The three possible kinds map directly to the three banners in the UI:
 *
 *   - "all"      → "Using all imported datasets" (aggregate across every
 *                   non-archived dataset the user owns).
 *   - "specific" → "Using dataset: <name>" (scope queries to one dataset).
 *   - "demo"     → "Using demo data" (mock provider; chosen explicitly by
 *                   the user or forced when they have no imports yet).
 *
 * A separate "No imported data yet" banner is a UI-only rendering of the
 * "demo" state when the user also has zero datasets — the scope itself is
 * still "demo". We surface that distinction via `DatasetScopeInfo.reason`.
 */

import { prisma } from "@/lib/prisma";

/** Sentinel we store in `User.activeDatasetId` when the user explicitly
 * opted into the mock provider. Null (the default) means "all datasets". */
export const DEMO_SENTINEL = "__demo__";

export type DatasetScopeKind = "all" | "specific" | "demo";

export type DatasetScope =
  | { kind: "all" }
  | { kind: "specific"; datasetId: string }
  | { kind: "demo" };

/**
 * Richer resolution result returned by `resolveDatasetScope`. `reason`
 * explains why the scope landed where it did so the UI can render the
 * right banner copy (e.g. "orphaned" → warn the user their selected
 * dataset is gone).
 */
export interface DatasetScopeInfo {
  scope: DatasetScope;
  /** Human-readable name when `scope.kind === "specific"`. */
  datasetName?: string;
  /** True when the signed-in user has at least one non-archived dataset. */
  hasAnyDatasets: boolean;
  /** Explains transitions so the UI can show context-aware banners. */
  reason:
    | "guest" // anonymous — always demo
    | "no_datasets" // signed in but nothing imported yet
    | "default_all" // signed in, default aggregate scope
    | "explicit_demo" // signed in but explicitly chose demo
    | "selected" // pinned to a specific dataset
    | "orphaned_fallback_all"; // chose a dataset that is now archived/deleted
}

/**
 * Deserialize a scope from a URL param or JSON payload. Unknown shapes
 * resolve to `{ kind: "all" }` so we never throw on bad client input.
 */
export function parseDatasetScope(raw: unknown): DatasetScope | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as { kind?: unknown; datasetId?: unknown };
  if (r.kind === "all") return { kind: "all" };
  if (r.kind === "demo") return { kind: "demo" };
  if (r.kind === "specific" && typeof r.datasetId === "string" && r.datasetId) {
    return { kind: "specific", datasetId: r.datasetId };
  }
  return undefined;
}

/**
 * Resolve the effective scope for a request.
 *
 * @param userId     Current signed-in user, or undefined for anonymous.
 * @param override   Optional explicit scope from a URL param / request body.
 *                   If provided and valid (ownership check passes), it wins
 *                   over the user's stored preference. Used by per-page
 *                   overrides without flipping the global preference.
 *
 * Invariants enforced here:
 *   - User A can never resolve a specific-scope pointing at User B's dataset.
 *   - Archived datasets behave like missing datasets (fall back to "all").
 *   - Scope resolution is write-through: if the stored preference is
 *     orphaned we best-effort clear it. Swallow errors — a failing write
 *     must not break a read.
 */
export async function resolveDatasetScope(
  userId: string | undefined,
  override?: DatasetScope,
): Promise<DatasetScopeInfo> {
  if (!userId) {
    return {
      scope: { kind: "demo" },
      hasAnyDatasets: false,
      reason: "guest",
    };
  }

  // Count + read preference in parallel. Count is cheap and drives two
  // UI decisions: whether to show "No imported data yet" vs "Using demo data"
  // and whether to offer the "All datasets" option.
  const [datasetCount, user] = await Promise.all([
    prisma.importedDataset.count({
      where: { userId, archived: false },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { activeDatasetId: true },
    }),
  ]);

  const hasAnyDatasets = datasetCount > 0;

  // Override path: caller already knows what scope they want. Still
  // re-verify specific-scope ownership so a malicious URL can't leak
  // another user's data.
  if (override) {
    if (override.kind === "demo") {
      return { scope: override, hasAnyDatasets, reason: "explicit_demo" };
    }
    if (override.kind === "all") {
      return {
        scope: override,
        hasAnyDatasets,
        reason: hasAnyDatasets ? "default_all" : "no_datasets",
      };
    }
    if (override.kind === "specific") {
      const ds = await prisma.importedDataset.findFirst({
        where: {
          id: override.datasetId,
          userId,
          archived: false,
        },
        select: { id: true, name: true },
      });
      if (ds) {
        return {
          scope: { kind: "specific", datasetId: ds.id },
          datasetName: ds.name,
          hasAnyDatasets,
          reason: "selected",
        };
      }
      // Override referenced an orphaned dataset — fall through to
      // the stored preference logic below.
    }
  }

  // No override or override was invalid — use the stored preference.
  const pref = user?.activeDatasetId ?? null;

  if (pref === DEMO_SENTINEL) {
    return {
      scope: { kind: "demo" },
      hasAnyDatasets,
      reason: "explicit_demo",
    };
  }

  if (pref === null) {
    return {
      scope: { kind: "all" },
      hasAnyDatasets,
      // "no_datasets" lets the UI show a CTA to import instead of implying
      // the user is looking at imported data that just happens to be empty.
      reason: hasAnyDatasets ? "default_all" : "no_datasets",
    };
  }

  // Pref is a concrete dataset id — verify it still belongs to this user
  // and isn't archived.
  const ds = await prisma.importedDataset.findFirst({
    where: { id: pref, userId, archived: false },
    select: { id: true, name: true },
  });

  if (!ds) {
    // Orphaned. Clear the preference so the user isn't stuck on a ghost
    // dataset on every subsequent request. Swallow write errors — the
    // caller just wants the read to succeed.
    void prisma.user
      .update({ where: { id: userId }, data: { activeDatasetId: null } })
      .catch(() => {});
    return {
      scope: { kind: "all" },
      hasAnyDatasets,
      reason: "orphaned_fallback_all",
    };
  }

  return {
    scope: { kind: "specific", datasetId: ds.id },
    datasetName: ds.name,
    hasAnyDatasets,
    reason: "selected",
  };
}

/**
 * Helper for Prisma queries. Given a resolved `DatasetScope`, return the
 * `datasetId` `where` clause to use when reading `ImportedAsset` rows.
 *
 * Callers MUST have already validated user ownership via
 * `resolveDatasetScope` — this helper does not re-check.
 */
export async function scopedDatasetIds(
  userId: string,
  scope: DatasetScope,
): Promise<string[]> {
  if (scope.kind === "specific") {
    // Ownership was re-verified in resolveDatasetScope. One-id array.
    return [scope.datasetId];
  }
  if (scope.kind === "all") {
    const rows = await prisma.importedDataset.findMany({
      where: { userId, archived: false },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
  // "demo" — caller should have routed to the mock provider; return empty.
  return [];
}
