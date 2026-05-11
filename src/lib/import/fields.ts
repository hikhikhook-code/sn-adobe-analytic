// Canonical set of fields we recognize in a user-imported CSV.
//
// This file is intentionally free of server-only dependencies (papaparse,
// prisma, etc.) so it can be safely imported by client components without
// bloating the client bundle or pulling in Node-only code paths.

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
  "contributorUrl",
  "keywords",
  "adobeStockUrl",
  "thumbnailUrl",
  "isPremium",
  "isAiGenerated",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];
