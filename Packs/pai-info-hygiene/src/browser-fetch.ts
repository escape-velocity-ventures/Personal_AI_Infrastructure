/**
 * Browser-based RSS Fetcher
 *
 * Uses Playwright to fetch RSS feeds protected by Cloudflare or other
 * bot protection. Falls back to this when standard HTTP requests fail.
 */

import { chromium, type Browser, type BrowserContext } from 'playwright';
import Parser from 'rss-parser';

let browser: Browser | null = null;
let context: BrowserContext | null = null;

const parser = new Parser();

/**
 * Initialize browser instance (lazy, reused across fetches)
 */
async function getBrowser(): Promise<BrowserContext> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }
  if (!context) {
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  }
  return context;
}

/**
 * Fetch RSS feed using browser automation
 * Bypasses Cloudflare and other JS-based bot protection
 */
export async function fetchRssWithBrowser(url: string): Promise<{
  items: Array<{
    title?: string;
    link?: string;
    pubDate?: string;
    isoDate?: string;
    content?: string;
    contentSnippet?: string;
  }>;
  error?: string;
}> {
  try {
    const ctx = await getBrowser();
    const page = await ctx.newPage();

    // Intercept response to get raw XML before browser renders it
    let rawXml: string | null = null;

    page.on('response', async (response) => {
      if (response.url() === url || response.request().redirectedFrom()?.url() === url) {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('xml') || contentType.includes('rss')) {
          try {
            rawXml = await response.text();
          } catch { /* ignore */ }
        }
      }
    });

    // Navigate to RSS URL
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Try to get XML from response directly if we intercepted it
    if (!rawXml && response) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('xml') || contentType.includes('rss') || contentType.includes('text')) {
          rawXml = await response.text();
        }
      } catch { /* ignore */ }
    }

    // Fallback: get page content and extract XML
    if (!rawXml) {
      const content = await page.content();

      // Try to extract XML from rendered page
      // Chrome displays XML in a special viewer, extract from that
      const xmlViewerMatch = content.match(/<div[^>]*id="webkit-xml-viewer-source-xml"[^>]*>([\s\S]*?)<\/div>/i);
      if (xmlViewerMatch) {
        rawXml = xmlViewerMatch[1]
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
      } else {
        // Try innerText extraction via evaluate
        rawXml = await page.evaluate(() => {
          // Check for XML viewer
          const xmlSource = document.querySelector('#webkit-xml-viewer-source-xml');
          if (xmlSource) return xmlSource.textContent;

          // Check for pre tag
          const pre = document.querySelector('pre');
          if (pre) return pre.textContent;

          // Last resort: body text
          return document.body?.innerText || document.body?.textContent || '';
        });
      }
    }

    await page.close();

    if (!rawXml || rawXml.trim().length === 0) {
      return { items: [], error: 'No XML content found' };
    }

    // Clean up the XML if needed
    rawXml = rawXml.trim();
    if (!rawXml.startsWith('<?xml') && !rawXml.startsWith('<rss') && !rawXml.startsWith('<feed')) {
      // Try to find the start of XML
      const xmlStart = rawXml.indexOf('<?xml');
      const rssStart = rawXml.indexOf('<rss');
      const feedStart = rawXml.indexOf('<feed');
      const start = Math.min(
        xmlStart >= 0 ? xmlStart : Infinity,
        rssStart >= 0 ? rssStart : Infinity,
        feedStart >= 0 ? feedStart : Infinity
      );
      if (start !== Infinity) {
        rawXml = rawXml.substring(start);
      }
    }

    // Parse the RSS
    const feed = await parser.parseString(rawXml);

    return {
      items: feed.items || []
    };
  } catch (error: any) {
    return {
      items: [],
      error: error.message || 'Browser fetch failed'
    };
  }
}

/**
 * Close browser instance (call on shutdown)
 */
export async function closeBrowser(): Promise<void> {
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/**
 * Check if Playwright is available
 */
export async function isBrowserAvailable(): Promise<boolean> {
  try {
    const { chromium } = await import('playwright');
    return !!chromium;
  } catch {
    return false;
  }
}
