import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseJsonArray } from "@/lib/utils";
import { requireEntitlement } from "@/lib/entitlement-gate";
import { csvWithBom, CSV_CRLF } from "@/lib/csv";
import { ADOBE_STOCK_BASE_URL } from "@/lib/adobe-stock-link";

/**
 * Multi-section CSV export of the user's Saved library.
 *
 * Produces a single CSV with three labeled sections, separated by blank
 * rows so spreadsheets render them as distinct tables:
 *
 *   1. Meta — provider-neutral header describing the export.
 *   2. Saved assets — one row per Favorite, including saved-at snapshot
 *      AND the most recent tracked delta. Unavailable cells render as
 *      the string "Unavailable" rather than fake zeros.
 *   3. Saved searches — one row per SavedSearch with the stored filter
 *      set, provider + quality at save time, and dataset scope.
 *
 * Records an `ExportHistory` row with `type = "saved"` and the user's
 * active dataset scope at export time (or "demo_data" for all-saved
 * exports that aren't tied to a specific dataset).
 *
 * Scope filter: optional `?collectionId=<id>` or `?collectionId=uncategorized`
 * narrows both sections to a single folder.
 */

const escape = (value: unknown): string => {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const QuerySchema = z.object({
  collectionId: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // PRD §7: CSV export is Starter+ only. Owners bypass.
  const gate = await requireEntitlement("canExportCsv", {
    requireSignedIn: true,
  });
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    collectionId: searchParams.get("collectionId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }
  const collectionId = parsed.data.collectionId;

  const favWhere: { userId: string; collectionId?: string | null } = { userId };
  const searchWhere: { userId: string; collectionId?: string | null } = {
    userId,
  };
  if (collectionId === "uncategorized") {
    favWhere.collectionId = null;
    searchWhere.collectionId = null;
  } else if (collectionId) {
    // Verify ownership so a rogue id can't be probed.
    const owned = await prisma.collection.findFirst({
      where: { id: collectionId, userId },
      select: { id: true, name: true },
    });
    if (!owned) {
      return NextResponse.json(
        { error: "Collection not found" },
        { status: 404 },
      );
    }
    favWhere.collectionId = owned.id;
    searchWhere.collectionId = owned.id;
  }

  const [favorites, savedSearches, collections] = await Promise.all([
    prisma.favorite.findMany({ where: favWhere, orderBy: { savedAt: "desc" } }),
    prisma.savedSearch.findMany({
      where: searchWhere,
      orderBy: { createdAt: "desc" },
    }),
    prisma.collection.findMany({
      where: { userId },
      select: { id: true, name: true },
    }),
  ]);
  const collectionNames = new Map(collections.map((c) => [c.id, c.name]));

  const out: string[] = [];

  // Section 1 — meta
  out.push(
    ["Section", "Generated", "Scope", "Favorites", "Saved searches"]
      .map(escape)
      .join(","),
  );
  const scopeLabel =
    collectionId === "uncategorized"
      ? "Uncategorized"
      : collectionId
        ? `Collection: ${collectionNames.get(collectionId) ?? collectionId}`
        : "All saved";
  out.push(
    [
      "meta",
      new Date().toISOString(),
      scopeLabel,
      favorites.length,
      savedSearches.length,
    ]
      .map(escape)
      .join(","),
  );

  // Section 2 — saved assets
  out.push("");
  out.push(
    [
      "Section",
      "Asset ID",
      "Title",
      "Contributor",
      "Saved Downloads",
      "Saved Performance",
      "Current Downloads",
      "Current Performance",
      "Delta Downloads",
      "Delta Performance",
      "Current Data Quality",
      "Current Provider",
      "Last Checked",
      "Collection",
      "Keywords",
      "Notes",
      "Adobe Stock URL",
      "Saved At",
    ]
      .map(escape)
      .join(","),
  );
  for (const f of favorites) {
    const hasTrack = f.lastCheckedAt != null;
    const trackOk = hasTrack && f.lastCheckedDownloads != null;
    const currentDl = trackOk ? String(f.lastCheckedDownloads) : "Unavailable";
    const currentPerf =
      trackOk && f.lastCheckedPerformanceScore != null
        ? String(f.lastCheckedPerformanceScore)
        : "Unavailable";
    const deltaDl = trackOk
      ? String((f.lastCheckedDownloads ?? 0) - f.downloads)
      : "Unavailable";
    const deltaPerf =
      trackOk && f.lastCheckedPerformanceScore != null
        ? String(f.lastCheckedPerformanceScore - f.performanceScore)
        : "Unavailable";
    out.push(
      [
        "saved_asset",
        f.assetId,
        f.title,
        f.contributorName ?? "",
        f.downloads,
        f.performanceScore,
        currentDl,
        currentPerf,
        deltaDl,
        deltaPerf,
        f.lastCheckedDataQuality ?? (hasTrack ? "Unavailable" : "Not yet checked"),
        f.lastCheckedProviderId ?? (hasTrack ? "Unavailable" : ""),
        f.lastCheckedAt ? f.lastCheckedAt.toISOString() : "Never",
        f.collectionId ? (collectionNames.get(f.collectionId) ?? "") : "",
        parseJsonArray<string>(f.keywordsJson).join("; "),
        f.notes ?? "",
        // PR #19: Favorite rows don't persist the original Adobe Stock
        // URL, and reconstructing `stock.adobe.com/<assetId>` would
        // produce a fake detail URL that 404s for demo rows. Export a
        // safe UK keyword-search fallback on the saved title instead —
        // the search page always exists and lets the user rediscover
        // the asset without pretending we have a real URL.
        f.title
          ? `${ADOBE_STOCK_BASE_URL}/search?k=${encodeURIComponent(f.title)}`
          : "",
        f.savedAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    );
  }

  // Section 3 — saved searches
  out.push("");
  out.push(
    [
      "Section",
      "Name",
      "Keyword",
      "Sort",
      "Content Type",
      "AI Filter",
      "Result Count",
      "Data Quality (at save)",
      "Provider (at save)",
      "Dataset Scope (at save)",
      "Collection",
      "Notes",
      "Saved At",
    ]
      .map(escape)
      .join(","),
  );
  for (const s of savedSearches) {
    out.push(
      [
        "saved_search",
        s.name ?? s.keyword,
        s.keyword,
        s.sort,
        s.contentType,
        s.aiFilter,
        s.resultCount ?? "",
        s.dataQuality,
        s.providerName,
        s.datasetScope,
        s.collectionId ? (collectionNames.get(s.collectionId) ?? "") : "",
        s.notes ?? "",
        s.createdAt.toISOString(),
      ]
        .map(escape)
        .join(","),
    );
  }

  const csv = csvWithBom(out.join(CSV_CRLF));

  // Export history row. We don't carry a dataset scope through here —
  // saved items aren't tied to a specific dataset at save time (they
  // could have been saved under any scope over time). Use "demo_data"
  // as a neutral fallback; the UI labels it as "All saved" via the
  // Query column instead.
  prisma.exportHistory
    .create({
      data: {
        userId,
        type: "saved",
        query: scopeLabel,
        rowCount: favorites.length + savedSearches.length,
        dataQuality: "estimated",
        providerName: "Saved library",
        datasetScope: "demo_data",
        paramsJson: JSON.stringify({ collectionId }).slice(0, 2_048),
      },
    })
    .catch(() => {});

  const filename = `sn-saved-${new Date()
    .toISOString()
    .slice(0, 10)}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
