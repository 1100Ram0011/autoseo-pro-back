
import * as cheerio from 'cheerio';
import prisma from '../config/prisma';

export async function crawlSite(siteId: string, startUrl: string) {
  console.log(`Starting crawl for site: ${startUrl}`);
  
  try {
    // Using native fetch instead of Puppeteer to prevent Chromium dependency issues on production
    const response = await fetch(startUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch ${startUrl}: ${response.status} ${response.statusText}`);
    }
    
    const html = await response.text();

    const $ = cheerio.load(html);
    const links = new Set<string>();
    
    // Always add the homepage
    links.add(startUrl);

    const baseUrl = new URL(startUrl);

    $('a').each((_, element) => {
      const href = $(element).attr('href');
      if (href) {
        try {
          const urlObj = new URL(href, startUrl);
          // Only add internal links, ignore hashes
          if (urlObj.hostname === baseUrl.hostname) {
            // Remove hash from URL
            urlObj.hash = '';
            links.add(urlObj.href);
          }
        } catch (e) {
          // Ignore invalid URLs
        }
      }
    });

    console.log(`Found ${links.size} unique internal pages on ${startUrl}`);

    // Save to Database
    const savedPages = [];
    for (const link of links) {
      // Check if page already exists for this site
      let dbPage = await prisma.page.findFirst({
        where: { siteId, url: link }
      });

      if (!dbPage) {
        dbPage = await prisma.page.create({
          data: {
            siteId,
            url: link,
            indexed: false
          }
        });
      }
      savedPages.push(dbPage);
    }

    // Update site last_crawled timestamp
    await prisma.site.update({
      where: { id: siteId },
      data: { last_crawled: new Date() }
    });

    return savedPages;
  } catch (error) {
    console.error(`Crawl failed for ${startUrl}:`, error);
    throw error;
  }
}
