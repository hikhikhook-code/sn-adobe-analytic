"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  AlertTriangle,
  CheckCircle2,
  FileDown,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { TopBar } from "@/components/layout/topbar";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DataQualityBadge, DataQualityBanner } from "@/components/ui/data-quality";
import { CsvUploader } from "@/components/import/csv-uploader";
import { formatNumber, timeAgo } from "@/lib/utils";

// NOTE: We import from "@/lib/import/fields" (papaparse-free) rather than
// "@/lib/import/csv", so this client bundle stays lean and doesn't pull any
// Node-only code paths into the browser. The server-only helpers
// (parseCsvForPreview, normalizeRows) still live in @/lib/import/csv and are
// re-exported for the API routes that need them.
import { IMPORT_FIELDS, type ImportField } from "@/lib/import/fields";

// Client-side soft limit to match the default `MAX_IMPORT_FILE_SIZE_MB=10`
// in `.env.example`. The server re-validates against `env.maxImportFileSizeBytes`
// (see src/lib/env.ts), so operators can raise the real ceiling without
// needing a frontend redeploy — the UI will still bounce oversized files
// early, just with the default limit in the error message.
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_MB = 10;
const SAMPLE_CSV_URL = "/samples/adobe-stock-sample.csv";

interface PreviewResponse {
  headers: string[];
  suggestedMapping: Record<string, ImportField | null>;
  previewRows: Record<string, string>[];
  totalRows: number;
}

interface DatasetRow {
  id: string;
  name: string;
  source: string;
  rowCount: number;
  createdAt: string;
  updatedAt: string;
}

const MAPPING_OPTIONS = [
  { value: "", label: "— Skip column —" },
  ...IMPORT_FIELDS.map((f) => ({ value: f, label: f })),
];

export default function ImportPage() {
  const router = useRouter();
  // Send guests to /auth/login with a callback that returns them here once
  // they sign in. This replaces the older UX that let the page render fully
  // and only surfaced a red "Sign in to import data" banner after the first
  // API call returned 401.
  const { status } = useSession();
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/auth/login?callbackUrl=%2Fimport");
    }
  }, [status, router]);

  const [datasetName, setDatasetName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, ImportField | null>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [datasets, setDatasets] = useState<DatasetRow[] | null>(null);
  const [datasetsError, setDatasetsError] = useState<string | null>(null);

  // Load existing datasets on mount — only if authenticated. Guests will be
  // redirected away by the useSession effect above, so firing the fetch
  // here would just cause a harmless 401 before the redirect lands.
  useEffect(() => {
    if (status !== "authenticated") return;
    void loadDatasets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function loadDatasets() {
    try {
      const res = await fetch("/api/import");
      if (res.status === 401) {
        // Session expired between mount and this fetch — send the user back
        // to login preserving their intent to return to /import.
        setDatasets([]);
        setDatasetsError("Your session expired. Redirecting to sign in…");
        router.replace("/auth/login?callbackUrl=%2Fimport");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { datasets: DatasetRow[] };
      setDatasets(j.datasets);
      setDatasetsError(null);
    } catch (e) {
      setDatasetsError(e instanceof Error ? e.message : "Failed to load");
      setDatasets([]);
    }
  }

  async function handleFile(file: File) {
    if (!file) return;
    setError(null);
    setSuccess(null);
    if (file.size === 0) {
      setError(
        "That file is empty. Export your analytics and try again.",
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB. ` +
          `Max accepted size is ${MAX_MB}MB — trim the file or split it into batches.`,
      );
      return;
    }
    // Browsers don't always set a `.csv` MIME type, so we rely on the
    // extension. Accept both ".csv" explicitly and a text/csv MIME as a
    // belt-and-braces fallback.
    const looksLikeCsv =
      file.name.toLowerCase().endsWith(".csv") ||
      file.type === "text/csv" ||
      file.type === "application/vnd.ms-excel";
    if (!looksLikeCsv) {
      setError(
        `Only .csv files are supported. You dropped "${file.name}" — ` +
          `export your data as CSV and try again.`,
      );
      return;
    }
    setFileName(file.name);
    setFileSizeBytes(file.size);
    if (!datasetName) {
      setDatasetName(file.name.replace(/\.csv$/i, "").slice(0, 120));
    }
    const text = await file.text();
    setCsvText(text);
    await runPreview(text);
  }

  async function runPreview(csv: string) {
    setPreviewing(true);
    setPreview(null);
    setMapping({});
    try {
      const res = await fetch("/api/import/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      if (res.status === 401) {
        setError("Sign in first to import data.");
        return;
      }
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Could not parse CSV.");
        return;
      }
      const p = j as PreviewResponse;
      setPreview(p);
      setMapping(p.suggestedMapping);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not parse CSV.");
    } finally {
      setPreviewing(false);
    }
  }

  async function confirmImport() {
    if (!preview || !csvText) return;
    if (!datasetName.trim()) {
      setError("Please give this dataset a name.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: datasetName.trim(),
          csv: csvText,
          mapping,
        }),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "Import failed.");
        return;
      }
      setSuccess(
        `Imported ${j.dataset?.rowCount ?? "all"} rows as "${j.dataset?.name}". They are now available across the app.`,
      );
      setDatasetName("");
      setCsvText("");
      setFileName(null);
      setFileSizeBytes(0);
      setPreview(null);
      setMapping({});
      await loadDatasets();
      // Nudge other pages to refetch by triggering router refresh.
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteDataset(id: string) {
    if (
      !confirm(
        "Archive this dataset? Its rows will stop appearing in search/dashboard. You can recreate it by importing again.",
      )
    )
      return;
    try {
      const res = await fetch(`/api/import/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        alert(j?.error ?? "Failed to archive dataset.");
        return;
      }
      await loadDatasets();
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to archive dataset.");
    }
  }

  const mappedFieldCount = useMemo(
    () => Object.values(mapping).filter(Boolean).length,
    [mapping],
  );

  return (
    <>
      <TopBar
        title="Import data"
        subtitle="Upload your own analytics CSV — your data, your numbers"
      />
      <div className="space-y-6 p-6">
        <PageHeader
          title="Import your CSV"
          description="Bring your own analytics export and the app will use it across Search, Dashboard, Portfolio, Heat Map, and Trending — replacing the demo data with your verified numbers."
        />

        <DataQualityBanner
          level="verified"
          providerName="User imported data"
          message="Anything you import is tagged Verified for the fields you supplied. Fields you leave blank stay blank — we never invent numbers for imported data."
        />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr,1fr]">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="h-5 w-5 text-accent-blue" />
                    Upload CSV
                  </CardTitle>
                  <CardDescription>
                    Headers can be anything reasonable — we&rsquo;ll auto-suggest
                    a column mapping. Max {MAX_MB}MB.
                  </CardDescription>
                </div>
                <Button asChild variant="outline" size="sm">
                  {/*
                    Link to a 12-row demo CSV in /public/samples. Served by
                    Next.js as a static file so there's no extra route to
                    maintain. The `download` attribute asks the browser to
                    save it rather than render in-place.
                  */}
                  <a
                    href={SAMPLE_CSV_URL}
                    download="adobe-stock-sample.csv"
                  >
                    <FileDown className="h-4 w-4" />
                    Download sample CSV
                  </a>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dataset-name">Dataset name</Label>
                <Input
                  id="dataset-name"
                  value={datasetName}
                  onChange={(e) => setDatasetName(e.target.value)}
                  placeholder="e.g. Q3 2025 Adobe export"
                  maxLength={120}
                />
              </div>
              <div className="space-y-2">
                <Label>CSV file</Label>
                <CsvUploader
                  fileName={fileName}
                  fileSizeBytes={fileSizeBytes}
                  busy={previewing}
                  disabled={submitting}
                  onFile={handleFile}
                />
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>{error}</span>
                </div>
              ) : null}

              {success ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-4 w-4" />
                  <span>{success}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recognized fields</CardTitle>
              <CardDescription>
                Map your CSV columns to any of these. Unmapped columns are
                ignored.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {IMPORT_FIELDS.map((f) => (
                  <code
                    key={f}
                    className="rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground"
                  >
                    {f}
                  </code>
                ))}
              </div>
              <p className="mt-3 leading-relaxed">
                Missing fields are kept as <em>unknown</em>. The app will only
                compute <code>performanceScore</code> /{" "}
                <code>downloadsPerMonth</code> when you provide both{" "}
                <code>downloads</code> and <code>uploadDate</code>. Computed
                values are tagged <DataQualityBadge level="estimated" size="xs" />
                .
              </p>
            </CardContent>
          </Card>
        </div>

        {preview ? (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>Preview &amp; column mapping</CardTitle>
                  <CardDescription>
                    Showing the first {preview.previewRows.length} of{" "}
                    {formatNumber(preview.totalRows)} rows. {mappedFieldCount}{" "}
                    column{mappedFieldCount === 1 ? "" : "s"} mapped.
                  </CardDescription>
                </div>
                <Button
                  variant="accent"
                  onClick={confirmImport}
                  disabled={submitting || mappedFieldCount === 0}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Importing&hellip;
                    </>
                  ) : (
                    <>Confirm import ({formatNumber(preview.totalRows)} rows)</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {mappedFieldCount === 0 ? (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  Map at least one column to a recognized field before
                  confirming.
                </div>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-xs">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="border-b border-border px-3 py-2">
                          <div className="space-y-1">
                            <div className="font-semibold">{h}</div>
                            <SimpleSelect
                              value={mapping[h] ?? ""}
                              options={MAPPING_OPTIONS}
                              onChange={(e) =>
                                setMapping((m) => ({
                                  ...m,
                                  [h]: (e.target.value ||
                                    null) as ImportField | null,
                                }))
                              }
                              className="w-44"
                            />
                          </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.previewRows.map((row, i) => (
                      <tr key={i} className="odd:bg-background even:bg-muted/20">
                        {preview.headers.map((h) => (
                          <td
                            key={h}
                            className="max-w-[220px] truncate border-b border-border/60 px-3 py-1.5 text-muted-foreground"
                            title={row[h] ?? ""}
                          >
                            {row[h] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle>Your imported datasets</CardTitle>
                <CardDescription>
                  Aggregated across Search, Dashboard, Portfolio, Heat Map, and
                  Trending.
                </CardDescription>
              </div>
              <Link
                href="/search"
                className="text-xs font-medium text-accent-blue hover:underline"
              >
                Try a search now →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {datasetsError ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                {datasetsError}
              </div>
            ) : datasets === null ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : datasets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No datasets yet. Upload a CSV above to get started.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Name</th>
                      <th className="px-3 py-2 font-semibold">Rows</th>
                      <th className="px-3 py-2 font-semibold">Source</th>
                      <th className="px-3 py-2 font-semibold">Imported</th>
                      <th className="px-3 py-2 text-right font-semibold">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {datasets.map((d) => (
                      <tr key={d.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{d.name}</span>
                            <DataQualityBadge level="verified" size="xs" />
                          </div>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatNumber(d.rowCount)}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {d.source.toUpperCase()}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {timeAgo(d.createdAt)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteDataset(d.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Archive
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
