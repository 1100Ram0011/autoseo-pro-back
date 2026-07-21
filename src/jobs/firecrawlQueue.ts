import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import prisma from '../config/prisma';
import axios from 'axios';
import crypto from 'crypto';
import { scrapeWebsite } from '../services/scraper.service';

export const FIRECRAWL_QUEUE_NAME = 'firecrawl-queue';

export const firecrawlQueue = new Queue(FIRECRAWL_QUEUE_NAME, {
  connection: redis
});

export const firecrawlQueueEvents = new QueueEvents(FIRECRAWL_QUEUE_NAME, {
  connection: redis
});

export const firecrawlWorker = new Worker(FIRECRAWL_QUEUE_NAME, async (job) => {
  const { userId, websiteUrl } = job.data;

  console.log("🚀 Scraper Job Started:", {
    jobId: job.id,
    userId,
    websiteUrl,
  });

  const websiteHash = crypto
    .createHash("sha256")
    .update(websiteUrl)
    .digest("hex");

  let finalResponseData: any = null;
  let usedFallback = false;

  try {
    // 1. CACHE CHECK
    const existingLog = await prisma.firecrawlLog.findFirst({
      where: {
        websiteHash,
        status: "success"
      }
    });

    if (existingLog) {
      console.log("♻️  Scraper Cache HIT — reusing stored response:", { websiteUrl });
      finalResponseData = existingLog.response ? JSON.parse(existingLog.response) : null;
      return { success: true, cached: true, source: existingLog.source, data: finalResponseData };
    }

    // 2. LIVE SCRAPING (Primary: Custom Puppeteer Scraper)
    console.log(`[ScraperWorker] Initiating Custom Puppeteer Scraper for ${websiteUrl}...`);
    try {
      const customData = await scrapeWebsite(websiteUrl);
      finalResponseData = customData;
      
      await prisma.firecrawlLog.create({
        data: {
          userId,
          websiteUrl,
          websiteHash,
          source: "CUSTOM_SCRAPER",
          response: JSON.stringify(customData),
          status: "success"
        }
      });
      console.log(`[ScraperWorker] Custom Scraper SUCCESS for ${websiteUrl}`);

    } catch (scraperError: any) {
      console.error(`[ScraperWorker] Custom Scraper FAILED for ${websiteUrl}:`, scraperError.message);
      console.log(`[ScraperWorker] Initiating Firecrawl API Fallback for ${websiteUrl}...`);
      
      usedFallback = true;
      const apiKey = process.env.FIRECRAWL_API_KEY;
      const firecrawlUrl = "https://api.firecrawl.dev/v2/scrape";

      if (!apiKey) {
        throw new Error("FIRECRAWL_API_KEY is not configured in .env for fallback.");
      }

      // 3. FALLBACK: Firecrawl API
      try {
        const firecrawlResponse = await axios.post(
          firecrawlUrl,
          {
            url: websiteUrl,
            onlyMainContent: false,
            maxAge: 1728000000000,
            parsers: ["pdf"],
            formats: ["markdown", "summary", "links", "images", "branding"],
          },
          {
            headers: { Authorization: `Bearer ${apiKey}` },
          }
        );

        finalResponseData = firecrawlResponse.data;

        await prisma.firecrawlLog.create({
          data: {
            userId,
            websiteUrl,
            websiteHash,
            firecrawlUrl,
            source: "FIRECRAWL_API",
            response: JSON.stringify(firecrawlResponse.data),
            status: "success"
          }
        });
        console.log(`[ScraperWorker] Firecrawl Fallback SUCCESS for ${websiteUrl}`);

      } catch (firecrawlError: any) {
        console.error(`[ScraperWorker] Firecrawl Fallback FAILED for ${websiteUrl}:`, firecrawlError.message);
        
        await prisma.firecrawlLog.create({
          data: {
            userId,
            websiteUrl,
            websiteHash,
            firecrawlUrl,
            source: "FIRECRAWL_API",
            response: firecrawlError.response?.data ? JSON.stringify(firecrawlError.response.data) : null,
            status: "failed",
            errorMessage: firecrawlError.message
          }
        });

        throw new Error(`Scraping Failed. Puppeteer Error: ${scraperError.message} | Firecrawl Error: ${firecrawlError.message}`);
      }
    }

    return { success: true, source: usedFallback ? "FIRECRAWL_API" : "CUSTOM_SCRAPER", data: finalResponseData };

  } catch (error: any) {
    console.error("Job failed", error);
    throw error;
  }
}, { connection: redis });

firecrawlWorker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed!`);
});

firecrawlWorker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} has failed with ${err.message}`);
});
