"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.firecrawlWorker = exports.firecrawlQueueEvents = exports.firecrawlQueue = exports.FIRECRAWL_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const prisma_1 = __importDefault(require("../config/prisma"));
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
const scraper_service_1 = require("../services/scraper.service");
exports.FIRECRAWL_QUEUE_NAME = 'firecrawl-queue';
exports.firecrawlQueue = new bullmq_1.Queue(exports.FIRECRAWL_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.firecrawlQueueEvents = new bullmq_1.QueueEvents(exports.FIRECRAWL_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.firecrawlWorker = new bullmq_1.Worker(exports.FIRECRAWL_QUEUE_NAME, async (job) => {
    const { userId, websiteUrl } = job.data;
    console.log("🚀 Scraper Job Started:", {
        jobId: job.id,
        userId,
        websiteUrl,
    });
    const websiteHash = crypto_1.default
        .createHash("sha256")
        .update(websiteUrl)
        .digest("hex");
    let finalResponseData = null;
    let usedFallback = false;
    try {
        // 1. CACHE CHECK
        const existingLog = await prisma_1.default.firecrawlLog.findFirst({
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
            const customData = await (0, scraper_service_1.scrapeWebsite)(websiteUrl);
            finalResponseData = customData;
            await prisma_1.default.firecrawlLog.create({
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
        }
        catch (scraperError) {
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
                const firecrawlResponse = await axios_1.default.post(firecrawlUrl, {
                    url: websiteUrl,
                    onlyMainContent: false,
                    maxAge: 1728000000000,
                    parsers: ["pdf"],
                    formats: ["markdown", "summary", "links", "images", "branding"],
                }, {
                    headers: { Authorization: `Bearer ${apiKey}` },
                });
                finalResponseData = firecrawlResponse.data;
                await prisma_1.default.firecrawlLog.create({
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
            }
            catch (firecrawlError) {
                console.error(`[ScraperWorker] Firecrawl Fallback FAILED for ${websiteUrl}:`, firecrawlError.message);
                await prisma_1.default.firecrawlLog.create({
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
    }
    catch (error) {
        console.error("Job failed", error);
        throw error;
    }
}, { connection: redis_1.redis });
exports.firecrawlWorker.on('completed', (job) => {
    console.log(`Job ${job.id} has completed!`);
});
exports.firecrawlWorker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} has failed with ${err.message}`);
});
//# sourceMappingURL=firecrawlQueue.js.map