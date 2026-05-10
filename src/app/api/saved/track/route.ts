import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveDatasetScope, scopedDatasetIds } from "@/lib/dataset-scope";
import { calculatePerformanceScore } from "@/lib/scoring";
import type { DataQuality } from "@/types/search";

/**
 * POST /api/saved/track — refresh the "current" download / performance
 * figures for a batch of saved favorites so the UI can render a delta
 * since-save.
 *
 * Provider rules (hard-coded here to stay honest under every config):
 *
 *   - Manual (imported CSV): we look up each saved asset's `externalId`
 *     in the user's active dataset scope. If we find it, we use the
 *     verified `downloads` / `performanceScore` from the row. Quality =
 *     `verified`.
 *
 *   - Mock: download numbers are synthesized per-query and are not
 *     stable across calls, so a "current" number would be meaningless.
 *     We return `available: false` with a notice. Quality stays at
 *     whatever was stored at save time — we never upgrade a demo row
 *     to a higher tier.
 *
 *   - Official (public metadata): public pages do not expose verified
 *     download counts. We return `available: false` with the provider's
 *     standard notice. PRD hard rule: never fabricate Adobe download
 *     changes.
 *
 * On a successful refresh we persist the result on the Favorite row
 * (`lastChecked*` columns) so the delta card renders the same number
 * the next time the page loads without a re-fetch.
 */

const RequestSchema = z.object({
  /**
   * Which saved assets to refresh. Omit to refresh every favorite the
   * user owns (capped at 200 to keep the endpoint O(1) for a UI button).
   */
  assetIds: z.array(z.string()).max(200).optional(),
});

export interface TrackRow {
  assetId: string;
  available: boolean;
  currentDownloads: number | null;
  currentPerformanceScore: number | null;
  deltaDownloads: number | null;
  deltaPerformanceScore: number | null;
  dataQuality: DataQuality | null;
  providerId: string | null;
  providerName: string | null;
  checkedAt: string;
  notice?: string;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // Empty body is allowed — means "refresh everything".
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const where: { userId: string; assetId?: { in: string[] } } = { userId };
  if (parsed.data.assetIds && parsed.data.assetIds.length > 0) {
    where.assetId = { in: parsed.data.assetIds };
  }
  const favorites = await prisma.favorite.findMany({
    where,
    take: 200,
    orderBy: { savedAt: "desc" },
  });
  if (favorites.length === 0) {
    return NextResponse.json({ rows: [], providerId: null, providerName: null });
  }

  // Resolve scope once. The manual provider reads scoped datasets; mock
  // / official tracking doesn't care about scope (both return Unavailable
  // uniformly).
  const scopeInfo = await resolveDatasetScope(userId);
  const datasetIds =
    scopeInfo.scope.kind === "demo"
      ? []
      : await scopedDatasetIds(userId, scopeInfo.scope);

  // Prefetch the matching ImportedAsset rows in a single query. We match
  // on `externalId` because that's the user-supplied ID we stored as
  // `Favorite.assetId` when the asset originated from an imported CSV.
  // (Favorites originating from the mock / official providers have
  // assetIds that won't match any imported row, which is the correct
  // behavior — they simply won't be upgradable to `verified`.)
  const assetIds = favorites.map((f) => f.assetId);
  const imported =
    datasetIds.length > 0
      ? await prisma.importedAsset.findMany({
          where: {
            datasetId: { in: datasetIds },
            externalId: { in: assetIds },
          },
          select: {
            externalId: true,
            downloads: true,
            performanceScore: true,
            uploadDate: true,
          },
        })
      : [];
  const importedByExt = new Map<
    string,
    { downloads: number | null; performanceScore: number | null; uploadDate: Date | null }
  >();
  for (const row of imported) {
    if (!row.externalId) continue;
    importedByExt.set(row.externalId, {
      downloads: row.downloads,
      performanceScore: row.performanceScore,
      uploadDate: row.uploadDate,
    });
  }

  const now = new Date();
  const manualProviderName = "User imported data";
  const rows: TrackRow[] = [];
  const writes: Promise<unknown>[] = [];

  for (const fav of favorites) {
    const match = importedByExt.get(fav.assetId);
    if (match && match.downloads != null) {
      // Manual provider can supply a verified current figure.
      const currentDownloads = match.downloads;
      // If the import didn't ship a performance score, derive one the
      // same way the manual provider does elsewhere in the codebase so
      // the delta is comparable to the saved-at value.
      const currentPerf =
        match.performanceScore ??
        (match.uploadDate
          ? calculatePerformanceScore(currentDownloads, match.uploadDate)
          : null);
      const deltaDownloads = currentDownloads - fav.downloads;
      const deltaPerf =
        currentPerf != null ? currentPerf - fav.performanceScore : null;
      rows.push({
        assetId: fav.assetId,
        available: true,
        currentDownloads,
        currentPerformanceScore: currentPerf,
        deltaDownloads,
        deltaPerformanceScore: deltaPerf,
        dataQuality: "verified",
        providerId: "manual",
        providerName: manualProviderName,
        checkedAt: now.toISOString(),
      });
      writes.push(
        prisma.favorite
          .update({
            where: { id: fav.id },
            data: {
              lastCheckedAt: now,
              lastCheckedDownloads: currentDownloads,
              lastCheckedPerformanceScore: currentPerf,
              lastCheckedDataQuality: "verified",
              lastCheckedProviderId: "manual",
            },
          })
          .catch(() => null),
      );
      continue;
    }

    // No manual match. Emit an honest Unavailable row and still persist
    // the checkedAt so the UI can say "last checked: 5m ago — Unavailable"
    // instead of flipping between "not yet checked" and a brief success.
    const notice =
      datasetIds.length > 0
        ? "This saved asset isn't in your imported data, and the current provider doesn't expose verified live downloads."
        : "No imported data is in scope. Import a CSV to enable track-changes for imported assets.";
    rows.push({
      assetId: fav.assetId,
      available: false,
      currentDownloads: null,
      currentPerformanceScore: null,
      deltaDownloads: null,
      deltaPerformanceScore: null,
      dataQuality: null,
      providerId: null,
      providerName: null,
      checkedAt: now.toISOString(),
      notice,
    });
    writes.push(
      prisma.favorite
        .update({
          where: { id: fav.id },
          data: {
            lastCheckedAt: now,
            // Explicitly clear the stored snapshot — a prior successful
            // refresh must not linger after the asset leaves scope.
            lastCheckedDownloads: null,
            lastCheckedPerformanceScore: null,
            lastCheckedDataQuality: null,
            lastCheckedProviderId: null,
          },
        })
        .catch(() => null),
    );
  }

  await Promise.all(writes);

  return NextResponse.json({
    rows,
    providerId:
      rows.some((r) => r.available && r.providerId === "manual")
        ? "manual"
        : null,
    providerName:
      rows.some((r) => r.available && r.providerId === "manual")
        ? manualProviderName
        : null,
    datasetScope: scopeInfo.scope,
  });
}
