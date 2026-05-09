import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPORT_FIELDS, normalizeRows, parseCsvForPreview } from "@/lib/import/csv";
import { env } from "@/lib/env";

// Driven by MAX_IMPORT_FILE_SIZE_MB (see src/lib/env.ts). Default 10MB,
// hard-capped at 100MB. Always re-validate server-side.
const MAX_CSV_BYTES = env.maxImportFileSizeBytes;
const MAX_CSV_MB = env.maxImportFileSizeMb;
const ImportSchema = z.object({
  name: z.string().min(1).max(120),
  // Optional original filename (UI sends file.name). Helps users
  // distinguish two datasets that ended up with the same display name.
  originalFileName: z.string().max(260).optional(),
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  mapping: z.record(z.string(), z.enum(IMPORT_FIELDS).nullable()),
});

/**
 * GET /api/import — list the current user's imported datasets.
 *
 * Returns one row per non-archived dataset. Rows include enough metadata
 * for the management table on /import (original filename, skipped row
 * count, active flag, archived flag). Callers that only need a lightweight
 * selector list (id+name+rowCount) should hit /api/user/active-dataset
 * instead.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  const [user, datasets] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { activeDatasetId: true },
    }),
    prisma.importedDataset.findMany({
      where: { userId: session.user.id, archived: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        originalFileName: true,
        source: true,
        rowCount: true,
        skippedRowCount: true,
        archived: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  const activeId = user?.activeDatasetId ?? null;
  return NextResponse.json({
    activeDatasetId: activeId,
    datasets: datasets.map((d) => ({
      ...d,
      // Denormalized flag so the UI doesn't have to cross-reference
      // activeDatasetId on every row.
      isActive: activeId === d.id,
      status: d.archived ? "archived" : "active",
    })),
  });
}

/**
 * POST /api/import — accept a CSV + column mapping and persist a new dataset.
 */
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in to import data." },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ImportSchema.safeParse(body);
  if (!parsed.success) {
    const sizeIssue = parsed.error.issues.find(
      (i) => i.code === "too_big" && i.path.join(".") === "csv",
    );
    if (sizeIssue) {
      return NextResponse.json(
        {
          error: `CSV exceeds the ${MAX_CSV_MB}MB limit. Trim the file or split it into batches before uploading.`,
          code: "csv_too_large",
          limitBytes: MAX_CSV_BYTES,
          limitMb: MAX_CSV_MB,
        },
        { status: 413 },
      );
    }
    const nameIssue = parsed.error.issues.find(
      (i) => i.path.join(".") === "name",
    );
    if (nameIssue) {
      return NextResponse.json(
        {
          error:
            "Please give this dataset a name between 1 and 120 characters.",
          code: "invalid_dataset_name",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, originalFileName, csv, mapping } = parsed.data;

  // Reject an empty mapping early so the user sees a clear message rather
  // than the generic "No usable rows" further down.
  const anyFieldMapped = Object.values(mapping).some((v) => v !== null);
  if (!anyFieldMapped) {
    return NextResponse.json(
      {
        error:
          "Map at least one CSV column to a recognized field before importing.",
        code: "empty_mapping",
      },
      { status: 400 },
    );
  }

  // Re-parse with the user-confirmed mapping. We pass an effectively
  // unlimited previewSize so `previewRows` here actually contains every row
  // in the CSV — this is the dataset we persist.
  const allRows = parseCsvForPreview(csv, Number.MAX_SAFE_INTEGER);
  const { validRows, errors } = normalizeRows(allRows.previewRows, mapping);
  if (validRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No usable rows found in that CSV. Check the column mapping, " +
          "confirm the file has data rows, and try again.",
        code: "no_usable_rows",
        issues: errors,
      },
      { status: 400 },
    );
  }
  // A "skipped" row is one the CSV contained but normalizeRows could not
  // turn into a usable asset (e.g. cell-level parse errors accumulated in
  // `errors`). `validRows.length` plus skipped should equal totalRows; we
  // record the skipped count on the dataset so the management table can
  // display "1,024 rows · 3 skipped" without re-parsing.
  const skippedRowCount = Math.max(
    0,
    allRows.totalRows - validRows.length,
  );
  const dataset = await prisma.importedDataset.create({
    data: {
      userId: session.user.id,
      name,
      originalFileName: originalFileName ?? null,
      source: "csv",
      rowCount: validRows.length,
      skippedRowCount,
      assets: {
        create: validRows.map((r) => ({ ...r })),
      },
    },
    select: {
      id: true,
      name: true,
      originalFileName: true,
      rowCount: true,
      skippedRowCount: true,
      createdAt: true,
    },
  });
  return NextResponse.json(
    {
      dataset,
      issues: errors,
    },
    { status: 201 },
  );
}
