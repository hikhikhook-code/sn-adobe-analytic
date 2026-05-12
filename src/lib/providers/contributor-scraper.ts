import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ContributorProfile {
  id: string;
  name: string;
  url: string;
  totalAssets: number;
  followers: number;
  verified: boolean;
  description: string;
  joinDate: string | null;
  topCategories: string[];
  averageRating: number | null;
}

const ADOBE_STOCK_BASE_URL = 'https://stock.adobe.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * Scrape contributor profile from Adobe Stock
 */
export async function scrapeContributorProfile(
  contributorId: string,
): Promise<ContributorProfile | null> {
  try {
    const url = `${ADOBE_STOCK_BASE_URL}/contributor/${contributorId}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Extract contributor info
    const name = $('[data-testid="contributor-name"], .contributor-name, h1').text().trim();
    const totalAssets = parseInt(
      $('[data-testid="asset-count"], .asset-count').text().match(/\d+/)?.[0] || '0',
      10,
    );
    const followers = parseInt(
      $('[data-testid="followers"], .followers').text().match(/\d+/)?.[0] || '0',
      10,
    );
    const verified = $('[data-testid="verified-badge"], .verified-badge').length > 0;
    const description = $('[data-testid="bio"], .bio, .description').text().trim();
    const joinDate = $('[data-testid="join-date"], .join-date').text().trim() || null;

    // Extract top categories
    const topCategories: string[] = [];
    $('[data-testid="category"], .category-tag').each((_, el) => {
      const text = $(el).text().trim();
      if (text && topCategories.length < 5) {
        topCategories.push(text);
      }
    });

    // Extract rating
    const ratingText = $('[data-testid="rating"], .rating').text();
    const averageRating = ratingText ? parseFloat(ratingText.match(/\d+\.?\d*/)?.[0] || '0') : null;

    if (!name) return null;

    return {
      id: contributorId,
      name,
      url,
      totalAssets,
      followers,
      verified,
      description,
      joinDate,
      topCategories,
      averageRating,
    };
  } catch (error) {
    console.error('Error scraping contributor profile:', error);
    return null;
  }
}

/**
 * Scrape contributor portfolio assets
 */
export async function scrapeContributorAssets(
  contributorId: string,
  page: number = 1,
) {
  try {
    const url = `${ADOBE_STOCK_BASE_URL}/contributor/${contributorId}?page=${page}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const assets: any[] = [];

    $('[data-testid="asset-item"], .asset-item').each((_, element) => {
      const $item = $(element);
      const assetId = $item.attr('data-asset-id') || '';
      const title = $item.find('[data-testid="asset-title"], .title').text().trim();
      const thumbnail = $item.find('img').attr('src') || '';
      const contentType = $item.find('[data-testid="content-type"], .type').text().trim();

      if (assetId && title) {
        assets.push({
          id: assetId,
          title,
          thumbnail,
          contentType,
        });
      }
    });

    return assets;
  } catch (error) {
    console.error('Error scraping contributor assets:', error);
    return [];
  }
}