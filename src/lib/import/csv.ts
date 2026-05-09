// CSV parsing + column-mapping helpers for the manual import flow.
//
// Parsing happens server-side via papaparse. The route receives the raw CSV
// text (small enough to inline in JSON for the MVP — the UI enforces a size
// cap before posting).

import Papa from "papaparse";

/**
 * Canonical fields we recognize. The order is preserved when we render the
 * column-mapping table, so put the most "important" fields first.
 */
export const IMPORT_FIELDS = [
  "id",
  "title",
  "downloads",
  "performanceScore",
  "downloadsPerMonth",
  "contentType",
  "categories",
  "uploadDate",
  "contributorName",
  "contributorId",
  "keywords",
  "adobeStockUrl",
  "thumbnailUrl",
  "isPremium",
  "isAiGenerated",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/**
 * Aliases the auto-mapper considers when matching CSV headers → canonical
 * fields. All comparisons are case-insensitive, whitespace-trimmed, and
 * non-alphanumeric characters are stripped. Order matters: earlier aliases
 * win over later ones if a header matches multiple.
 */
const FIELD_ALIASES: Record<ImportField, string[]> = {
  id: ["id", "assetid", "adobeid", "adobestockid", "stockid"],
  title: ["title", "name", "assetname", "filename"],
  downloads: ["downloads", "downloadcount", "totaldownloads", "sales"],
  performanceScore: [
    "performancescore",
    "score",
    "perfscore",
    "performance",
  ],
  downloadsPerMonth: [
    "downloadspermonth",
    "dpm",
    "monthlydownloads",
    "downloadsmonthly",
  ],
  contentType: ["contenttype", "type", "category", "assettype", "mediatype"],
  categories: ["categories", "category", "tags"],
  uploadDate: [
    "uploaddate",
    "uploadedat",
    "publisheddate",
    "createdat",
    "date",
  ],
  contributorName: [
    "contributorname",
    "contributor",
    "author",
    "artist",
    "creator",
  ],
  contributorId: [
    "contributorid",
    "authorid",
    "creatorid",
    "userid",
  ],
  keywords: ["keywords", "tags", "tag"],
  adobeStockUrl: ["adobestockurl", "url", "link", "permalink"],
  thumbnailUrl: ["thumbnailurl", "thumb", "image", "preview", "thumbnail"],
  isPremium: ["ispremium", "premium"],
  isAiGenerated: [
    "isaigenerated",
    "ai",
    "aigenerated",
    "isai",
    "generated",
  ],
};

const normalize = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ParsedCsv {
  /** Original headers from the file, in order. */
  headers: string[];
  /** Auto-suggested mapping: header → field (or null if unmatched). */
  suggestedMapping: Record<string, ImportField | null>;
  /** First N rows as raw objects keyed by header. Used for preview. */
  previewRows: Record<string, string>[];
  /** Total row count (excluding header). */
  totalRows: number;
}

export function parseCsvForPreview(csv: string, previewSize = 25): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  const rows = (result.data ?? []).filter(
    (r) => r && Object.keys(r).length > 0,
  );
  const suggestedMapping: Record<string, ImportField | null> = {};
  for (const header of headers) {
    suggestedMapping[header] = autoMapHeader(header);
  }
  return {
    headers,
    suggestedMapping,
    previewRows: rows.slice(0, previewSize),
    totalRows: rows.length,
  };
}

export function autoMapHeader(header: string): ImportField | null {
  const norm = normalize(header);
  for (const field of IMPORT_FIELDS) {
    if (FIELD_ALIASES[field].some((alias) => alias === norm)) return field;
  }
  return null;
}

/**
 * Given a per-header → field mapping, parse the full CSV into normalized
 * objects suitable for `prisma.importedAsset.createMany`. Returns
 * `validRows`, `invalidRows`, and `fieldQuality` describing which fields
 * came directly from the user's CSV vs were left blank/derived.
 */
export interface NormalizedRow {
  externalId: string | null;
  title: string | null;
  thumbnailUrl: string | null;
  downloads: number | null;
  performanceScore: number | null;
  downloadsPerMonth: number | null;
  contentType: string | null;
  categoriesJson: string;
  uploadDate: Date | null;
  contributorName: string | null;
  contributorId: string | null;
  isPremium: boolean;
  isAiGenerated: boolean;
  keywordsJson: string;
  adobeStockUrl: string | null;
  fieldQualityJson: string;
}

export interface RowError {
  rowIndex: number;
  header: string;
  message: string;
}

export interface NormalizedCsv {
  validRows: NormalizedRow[];
  errors: RowError[];
  /** Set of fields that appeared in the mapping (used to label data quality). */
  mappedFields: ImportField[];
}

function parseInteger(raw: string, header: string, rowIndex: number): {
  value: number | null;
  error?: RowError;
} {
  const t = raw.trim();
  if (t === "") return { value: null };
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) {
    return {
      value: null,
      error: { rowIndex, header, message: `Not a number: "${raw}"` },
    };
  }
  return { value: Math.trunc(n) };
}

function parseFloat_(raw: string, header: string, rowIndex: number): {
  value: number | null;
  error?: RowError;
} {
  const t = raw.trim();
  if (t === "") return { value: null };
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) {
    return {
      value: null,
      error: { rowIndex, header, message: `Not a number: "${raw}"` },
    };
  }
  return { value: n };
}

function parseDate(raw: string, header: string, rowIndex: number): {
  value: Date | null;
  error?: RowError;
} {
  const t = raw.trim();
  if (t === "") return { value: null };
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) {
    return {
      value: null,
      error: { rowIndex, header, message: `Not a date: "${raw}"` },
    };
  }
  return { value: d };
}

function parseBool(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return ["true", "1", "yes", "y"].includes(t);
}

function parseList(raw: string): string[] {
  if (!raw) return [];
  // Accept JSON arrays, semicolon-separated, comma-separated, or pipe.
  const t = raw.trim();
  if (t.startsWith("[")) {
    try {
      const v = JSON.parse(t);
      if (Array.isArray(v))
        return v.filter((x) => typeof x === "string").map((s) => s.trim());
    } catch {
      // fall through
    }
  }
  return t
    .split(/[;,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeRows(
  rows: Record<string, string>[],
  mapping: Record<string, ImportField | null>,
): NormalizedCsv {
  const fieldByHeader = mapping;
  const headerByField = new Map<ImportField, string>();
  for (const [header, field] of Object.entries(fieldByHeader)) {
    if (field && !headerByField.has(field)) headerByField.set(field, header);
  }
  const mappedFields = Array.from(headerByField.keys());
  const validRows: NormalizedRow[] = [];
  const errors: RowError[] = [];

  rows.forEach((row, rowIndex) => {
    const get = (f: ImportField): string => {
      const h = headerByField.get(f);
      return h ? (row[h] ?? "").toString() : "";
    };

    const downloads = parseInteger(get("downloads"), "downloads", rowIndex);
    const perfScore = parseInteger(
      get("performanceScore"),
      "performanceScore",
      rowIndex,
    );
    const dpm = parseFloat_(
      get("downloadsPerMonth"),
      "downloadsPerMonth",
      rowIndex,
    );
    const uploadDate = parseDate(get("uploadDate"), "uploadDate", rowIndex);

    if (downloads.error) errors.push(downloads.error);
    if (perfScore.error) errors.push(perfScore.error);
    if (dpm.error) errors.push(dpm.error);
    if (uploadDate.error) errors.push(uploadDate.error);

    // We never reject rows wholesale on per-cell errors; the user can
    // retry the import with cleaner data, but partial data is still useful.

    const fieldQuality: Record<string, "verified" | "estimated"> = {};
    for (const f of mappedFields) fieldQuality[f] = "verified";
    if (!headerByField.has("performanceScore"))
      fieldQuality["performanceScore"] = "estimated";
    if (!headerByField.has("downloadsPerMonth"))
      fieldQuality["downloadsPerMonth"] = "estimated";

    validRows.push({
      externalId: get("id") || null,
      title: get("title") || null,
      thumbnailUrl: get("thumbnailUrl") || null,
      downloads: downloads.value,
      performanceScore: perfScore.value,
      downloadsPerMonth: dpm.value,
      contentType: get("contentType") || null,
      categoriesJson: JSON.stringify(parseList(get("categories"))),
      uploadDate: uploadDate.value,
      contributorName: get("contributorName") || null,
      contributorId: get("contributorId") || null,
      isPremium: headerByField.has("isPremium")
        ? parseBool(get("isPremium"))
        : false,
      isAiGenerated: headerByField.has("isAiGenerated")
        ? parseBool(get("isAiGenerated"))
        : false,
      keywordsJson: JSON.stringify(parseList(get("keywords"))),
      adobeStockUrl: get("adobeStockUrl") || null,
      fieldQualityJson: JSON.stringify(fieldQuality),
    });
  });

  return { validRows, errors, mappedFields };
}
