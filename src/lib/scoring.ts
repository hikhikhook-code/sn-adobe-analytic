// Performance score & competition level calculations per PRD section 10.3 / 10.4

export function monthsSince(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const ms = Date.now() - d.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.4375);
}

export function calculatePerformanceScore(
  downloads: number,
  uploadDate: Date | string,
): number {
  const months = monthsSince(uploadDate);
  const dpm = months > 0 ? downloads / months : downloads;
  let score: number;
  if (dpm >= 100) score = 100;
  else if (dpm >= 50) score = 80 + (dpm - 50) * 0.4;
  else if (dpm >= 20) score = 60 + (dpm - 20) * 0.67;
  else if (dpm >= 5) score = 30 + (dpm - 5) * 2;
  else if (dpm >= 1) score = 10 + (dpm - 1) * 5;
  else score = dpm * 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function calculateDownloadsPerMonth(
  downloads: number,
  uploadDate: Date | string,
): number {
  const months = monthsSince(uploadDate);
  return months > 0 ? Math.round((downloads / months) * 10) / 10 : downloads;
}

export function calculateCompetitionLevel(
  totalResults: number,
): "low" | "medium" | "high" {
  if (totalResults < 10_000) return "low";
  if (totalResults < 100_000) return "medium";
  return "high";
}

export function competitionLabel(level: "low" | "medium" | "high"): string {
  return { low: "Low Competition", medium: "Medium Competition", high: "High Competition" }[level];
}

export function competitionColor(level: "low" | "medium" | "high"): string {
  return { low: "text-emerald-600", medium: "text-amber-600", high: "text-rose-600" }[level];
}
