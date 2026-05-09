import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseCsvForPreview } from "@/lib/import/csv";

// 10MB ceiling on raw CSV text. Note: enforce on the API too, never trust the
// UI alone.
const MAX_CSV_BYTES = 10 * 1024 * 1024;
const PreviewSchema = z.object({
  csv: z.string().min(1).max(MAX_CSV_BYTES),
});

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
  const parsed = PreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = parseCsvForPreview(parsed.data.csv);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Could not parse CSV.",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
