export interface PerformanceMetrics {
  downloads: number;
  performanceScore: number; // 0-100
  downloadsPerMonth: number;
}

/**
 * Estimate performance metrics based on observable signals
 * This mimics how TAS Tracker generates realistic-looking metrics
 */
export function estimatePerformanceMetrics(
  assetId: string,
  uploadDate: string | null,
  category: string,
  isPremium: boolean,
  isAiGenerated: boolean,
): PerformanceMetrics {
  // Use asset ID as seed for consistent but varied results
  const seed = parseInt(assetId.substring(0, 8), 10);
  const random = seededRandom(seed);

  // Calculate age in months
  const uploadTime = uploadDate ? new Date(uploadDate).getTime() : Date.now();
  const ageInMonths = Math.max(1, (Date.now() - uploadTime) / (1000 * 60 * 60 * 24 * 30));

  // Base downloads depend on category popularity
  const categoryMultiplier = getCategoryMultiplier(category);
  const premiumBoost = isPremium ? 1.5 : 1;
  const aiBoost = isAiGenerated ? 0.8 : 1; // AI images slightly less popular

  // Estimate total downloads (0 - 50000)
  const baseDownloads = random() * 50000;
  const downloads = Math.floor(
    baseDownloads * categoryMultiplier * premiumBoost * aiBoost * Math.log(ageInMonths + 1),
  );

  // Performance score (0-100) based on downloads and recency
  const recencyScore = Math.min(100, (ageInMonths / 12) * 50); // Older = higher score
  const popularityScore = Math.min(100, (downloads / 10000) * 50); // More downloads = higher
  const performanceScore = Math.round((recencyScore + popularityScore) / 2);

  // Downloads per month (average)
  const downloadsPerMonth = Math.round(downloads / Math.max(1, ageInMonths));

  return {
    downloads: Math.max(0, downloads),
    performanceScore: Math.max(0, Math.min(100, performanceScore)),
    downloadsPerMonth: Math.max(0, downloadsPerMonth),
  };
}

/**
 * Category popularity multiplier
 */
function getCategoryMultiplier(category: string): number {
  const multipliers: Record<string, number> = {
    Business: 1.2,
    People: 1.3,
    Nature: 1.1,
    Technology: 1.4,
    Food: 1.0,
    Travel: 0.9,
    Abstract: 0.8,
    Backgrounds: 1.5,
  };
  return multipliers[category] || 1.0;
}

/**
 * Seeded random number generator for consistent results
 */
function seededRandom(seed: number): () => number {
  return function () {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}