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
  csv: z.string().min(1).max(MAX_CSV_BYTES),
  mapping: z.record(z.string(), z.enum(IMPORT_FIELDS).nullable()),
});

/**
 * GET /api/import — list the current user's imported datasets.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "You must be signed in." },
      { status: 401 },
    );
  }
  const datasets = await prisma.importedDataset.findMany({
    where: { userId: session.user.id, archived: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      source: true,
      rowCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return NextResponse.json({ datasets });
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
  const { name, csv, mapping } = parsed.data;

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
  const dataset = await prisma.importedDataset.create({
    data: {
      userId: session.user.id,
      name,
      source: "csv",
      rowCount: validRows.length,
      assets: {
        create: validRows.map((r) => ({ ...r })),
      },
    },
    select: {
      id: true,
      name: true,
      rowCount: true,
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
