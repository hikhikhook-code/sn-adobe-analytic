import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { IMPORT_FIELDS, normalizeRows, parseCsvForPreview } from "@/lib/import/csv";

const MAX_CSV_BYTES = 10 * 1024 * 1024;
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
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { name, csv, mapping } = parsed.data;
  // Re-parse with the user-confirmed mapping. We pass an effectively
  // unlimited previewSize so `previewRows` here actually contains every row
  // in the CSV — this is the dataset we persist.
  const allRows = parseCsvForPreview(csv, Number.MAX_SAFE_INTEGER);
  const { validRows, errors } = normalizeRows(allRows.previewRows, mapping);
  if (validRows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No usable rows found. Check the CSV file or column mapping and try again.",
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
