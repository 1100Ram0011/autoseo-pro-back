import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import prisma from '../config/prisma';

export async function crawlSite(siteId: string, startUrl: string) {
  console.log(`Starting crawl for site: ${startUrl}`);
  
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // We will do a basic single-page crawl for MVP, 
    // extracting all internal links from the homepage.
    await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    await browser.close();

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
