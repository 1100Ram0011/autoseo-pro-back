import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import BusinessScrapedAsset from "../../models/BusinessScrapedAsset.js";
import logger from "../../config/logger.js";
import { processAndUploadImage } from "./firecrawl.worker.js";

const scrapedAssetWorker = new Worker(
  "scraped-asset-queue",
  async (job) => {
    const {
      userId,
      websiteHash,
      extractedBusinessName,
      scrapedImages,
      scrapedLinks,
      scrapedIframes,
      scrapedBranding,
    } = job.data;

    try {
      const activeProfile = await BusinessSummaryProfile.findOne({
        userId,
        websiteHash,
        isActive: true,
      }).lean();

      if (activeProfile && activeProfile._id) {
        if (scrapedImages && scrapedImages.length > 0) {
          console.log(
            `[ScrapedAssetWorker] Processing ${scrapedImages.length} images for ${extractedBusinessName}...`
          );
          const batchSize = 5;
          for (let i = 0; i < scrapedImages.length; i += batchSize) {
            const batch = scrapedImages.slice(i, i + batchSize);
            await Promise.all(
              batch.map(async (imgObj) => {
                if (imgObj && imgObj.src) {
                  try {
                    imgObj.src = await processAndUploadImage(
                      imgObj.src,
                      extractedBusinessName,
                      true
                    );
                  } catch (imgErr) {
                    logger.warn(
                      `[ScrapedAssetWorker] Failed to process image ${imgObj.src}`,
                      { error: imgErr.message }
                    );
                  }
                }
              })
            );
          }
        }

        const businessEntry = {
          businessId: activeProfile._id,
          images: scrapedImages,
          links: scrapedLinks,
          iframes: scrapedIframes,
          branding: scrapedBranding,
          scrapedAt: new Date(),
        };

        await BusinessScrapedAsset.findOneAndUpdate(
          { userId },
          { $push: { BusinessData: businessEntry } },
          { upsert: true, new: true }
        );

        console.log(
          "📦 Scraped assets (with S3 URLs) saved to BusinessScrapedAsset by background worker",
          {
            businessId: activeProfile._id,
            images: scrapedImages.length,
            links: scrapedLinks.length,
          }
        );
      } else {
        logger.warn(
          "[ScrapedAssetWorker] No active BusinessSummaryProfile found — skipping asset save",
          {
            userId,
            websiteHash,
          }
        );
      }
    } catch (assetErr) {
      logger.error("[ScrapedAssetWorker] Failed to save scraped assets", {
        userId,
        websiteHash,
        error: assetErr.message,
      });
      throw assetErr; // throw so BullMQ can retry
    }
  },
  {
    connection: redisClient,
    concurrency: 5,
  }
);

scrapedAssetWorker.on("completed", (job) => {
  logger.info(`[ScrapedAssetWorker] Job ${job.id} completed successfully.`);
});

scrapedAssetWorker.on("failed", (job, err) => {
  logger.error(`[ScrapedAssetWorker] Job ${job.id} failed: ${err.message}`);
});

export default scrapedAssetWorker;
