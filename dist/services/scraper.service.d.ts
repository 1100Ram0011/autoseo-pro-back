/**
 * Scrapes a website using a stealthy headless browser to extract text, links, images, and branding info.
 * Implements advanced "God Mode" anti-bot bypass techniques to evade detection from services like
 * Cloudflare, disable-devtool, and basic fingerprinting.
 *
 * @param {string} formattedUrl - The target website URL to scrape
 * @returns {Promise<Object>} An object containing markdown text, images, iframes, metadata, links, and branding details
 * @throws {Error} If the scraper fails to extract any valid content or crashes
 */
export declare const scrapeWebsite: (formattedUrl: string) => Promise<any>;
//# sourceMappingURL=scraper.service.d.ts.map