import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseCsvForPreview } from "@/lib/import/csv";
import { env } from "@/lib/env";

// Upper bound on raw CSV text. Driven by MAX_IMPORT_FILE_SIZE_MB (default
// 10MB, hard-capped at 100MB in src/lib/env.ts). We always re-validate on
// the server; never trust the UI alone.
const MAX_CSV_BYTES = env.maxImportFileSizeBytes;
const MAX_CSV_MB = env.maxImportFileSizeMb;
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
    // zod's default `too_big` message is inscrutable to end-users; surface a
    // clear size hint so they don't spend time hunting for what went wrong.
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
    return NextResponse.json(
      { error: "Invalid input", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  try {
    const result = parseCsvForPreview(parsed.data.csv);
    if (result.headers.length === 0) {
      return NextResponse.json(
        {
          error:
            "That file doesn't look like a CSV — no header row was found. " +
            "Make sure the first line of the file contains the column names.",
          code: "csv_no_headers",
        },
        { status: 400 },
      );
    }
    if (result.totalRows === 0) {
      return NextResponse.json(
        {
          error:
            "That CSV only has a header row — there are no data rows to import.",
          code: "csv_empty",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          "Could not parse that CSV. Check that values with commas or line " +
          "breaks are wrapped in double quotes, then try again.",
        detail: err instanceof Error ? err.message : String(err),
        code: "csv_parse_failed",
      },
      { status: 400 },
    );
  }
}
