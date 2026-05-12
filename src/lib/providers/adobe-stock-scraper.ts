import axios from 'axios';
import * as cheerio from 'cheerio';

export interface AdobeStockAsset {
  id: string;
  thumbnailUrl: string;
  title: string;
  downloads: number | null;
  contentType: string;
  categories: string[];
  uploadDate: string | null;
  contributorName: string;
  contributorId: string;
  isPremium: boolean;
  isAiGenerated: boolean;
  keywords: string[];
  adobeStockUrl: string;
}

export interface AdobeStockSearchResult {
  totalResults: number;
  results: AdobeStockAsset[];
}

const ADOBE_STOCK_BASE_URL = 'https://stock.adobe.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/**
 * Scrape Adobe Stock search results from public pages
 */
export async function scrapeAdobeStockSearch(
  keyword: string,
  contentType?: string,
  sort?: string,
  page: number = 1,
): Promise<AdobeStockSearchResult> {
  try {
    // Build search URL
    const params = new URLSearchParams();
    params.append('k', keyword);
    if (contentType && contentType !== 'all') {
      params.append('asset_type', contentType);
    }
    if (sort) {
      params.append('sort', sort);
    }
    params.append('page', page.toString());

    const url = `${ADOBE_STOCK_BASE_URL}/search?${params.toString()}`;

    // Fetch page with user agent
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);
    const results: AdobeStockAsset[] = [];

    // Parse search results grid
    $('[data-testid="search-result-item"], .search-result-item, [class*="result"]').each(
      (index, element) => {
        try {
          const $item = $(element);

          // Extract asset ID from URL or data attribute
          const link = $item.find('a[href*="/stock/details"]').attr('href') || '';
          const idMatch = link.match(/\/(\d+)/);
          const id = idMatch ? idMatch[1] : `asset-${index}`;

          // Extract thumbnail
          const thumbnailUrl =
            $item.find('img').attr('src') ||
            $item.find('img').attr('data-src') ||
            '';

          // Extract title
          const title =
            $item.find('[data-testid="search-result-title"]').text() ||
            $item.find('h3, .title').text() ||
            'Untitled';

          // Extract contributor
          const contributorName =
            $item.find('[data-testid="search-result-contributor"]').text() ||
            $item.find('.contributor, [class*="contributor"]').text() ||
            'Unknown';

          // Extract content type from badge or class
          const contentTypeText =
            $item.find('[data-testid="asset-type-badge"]').text() ||
            $item.find('[class*="badge"]').text() ||
            'photo';
          const contentType = contentTypeText.toLowerCase().includes('video')
            ? 'video'
            : contentTypeText.toLowerCase().includes('template')
              ? 'template'
              : 'photo';

          // Check for premium badge
          const isPremium = $item.find('[class*="premium"]').length > 0;

          // Check for AI-generated badge
          const isAiGenerated =
            $item.find('[class*="ai"], [data-testid*="ai"]').length > 0 ||
            title.toLowerCase().includes('ai');

          // Extract categories from tags/keywords
          const categories: string[] = [];
          $item.find('[class*="tag"], [class*="category"]').each((_, tag) => {
            const text = $(tag).text().trim();
            if (text && categories.length < 5) {
              categories.push(text);
            }
          });

          const asset: AdobeStockAsset = {
            id,
            thumbnailUrl,
            title: title.trim(),
            downloads: null, // Not available in public scrape
            contentType,
            categories,
            uploadDate: null, // Not easily available
            contributorName: contributorName.trim(),
            contributorId: `contributor-${id}`,
            isPremium,
            isAiGenerated,
            keywords: [keyword, ...categories],
            adobeStockUrl: link || `${ADOBE_STOCK_BASE_URL}/stock/details/${id}`,
          };

          if (asset.title && asset.title !== 'Untitled') {
            results.push(asset);
          }
        } catch (error) {
          console.error('Error parsing asset:', error);
        }
      },
    );

    // Extract total results count
    const totalResultsText =
      $('[data-testid="search-results-count"]').text() ||
      $('[class*="result-count"]').text() ||
      '';
    const totalMatch = totalResultsText.match(/(\d+(?:,\d+)*)/);
    const totalResults = totalMatch
      ? parseInt(totalMatch[1].replace(/,/g, ''), 10)
      : results.length * 10; // Estimate

    return {
      totalResults,
      results,
    };
  } catch (error) {
    console.error('Error scraping Adobe Stock:', error);
    throw new Error(`Failed to scrape Adobe Stock: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get single asset details from Adobe Stock
 */
export async function getAdobeStockAssetDetails(assetId: string): Promise<AdobeStockAsset | null> {
  try {
    const url = `${ADOBE_STOCK_BASE_URL}/stock/details/${assetId}`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
      },
      timeout: 10000,
    });

    const $ = cheerio.load(response.data);

    // Parse asset details page
    const title = $('[data-testid="asset-title"], h1').text().trim();
    const thumbnailUrl = $('img[data-testid="asset-preview"]').attr('src') || '';
    const contributorName = $('[data-testid="contributor-name"]').text().trim();

    if (!title) return null;

    return {
      id: assetId,
      thumbnailUrl,
      title,
      downloads: null,
      contentType: 'photo',
      categories: [],
      uploadDate: null,
      contributorName,
      contributorId: `contributor-${assetId}`,
      isPremium: false,
      isAiGenerated: false,
      keywords: [title],
      adobeStockUrl: url,
    };
  } catch (error) {
    console.error('Error fetching asset details:', error);
    return null;
  }
}