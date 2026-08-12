import { Worker } from "bullmq";
import axios from "axios";
import crypto from "crypto";
import mongoose from "mongoose";
import redisClient from "../../config/redis.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import BusinessScrapedAsset from "../../models/BusinessScrapedAsset.js";
import { preparePdfData } from "../../controllers/BusinessSummary/BusinessSummaryController.js";
import { generatePdfBuffer, uploadPdfToS3 } from "../../template/pdfService.js";
import {
  analyzeWebsiteClaude,
  generateAnalysisSummary,
  runClaudeAnalysis,
} from "../../services/claude.service.js";
import { setProgress, clearProgress } from "../../utils/analysisProgress.js";
import ApiCredential from "../../models/ApiCredential.js";
import { decrypt } from "../../utils/crypto.js";
import logger from "../../config/logger.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";
import FirecrawllogModel from "../../models/Firecrawllog.model.js";
import { triggerScraperForProfile } from "../../queue/workers/enqueueScraperJob.js";
import { scrapeWebsite } from "../../services/scraper.service.js";
import { validateWebsite } from "./adminOutreach.worker.js";
import {
  firecrawlQueue,
  GoogleApileadGenerationQueue,
  scrapedAssetQueue,
  videoGenerationQueue,
} from "../index.js";
import {
  trackAndDeductFeatureCredit,
  checkBulkFeatureCapacity,
} from "../../utils/creditTracker.js";
import { sendThirdPartyApiErrorEmail } from "../../utils/emailServices.js";
import userModel from "../../models/userModel.js";
import { createStaticLogo } from "../../services/aiService.js";
import config from "../../config/config.js";
import {
  uploadBase64ToS3,
  uploadLogoBufferToS3,
  uploadStudioImageBufferToS3,
} from "../../utils/uploadBase64ToS3.js";
import sharp from "sharp";
import { createCanvas, loadImage } from "@napi-rs/canvas";

// const publisher = redisClient.duplicate();

export async function emitToUser(userId, event, data) {
  const payload = JSON.stringify({
    userId: userId.toString(),
    event,
    data,
  });

  // await publisher.publish("socket:user", payloa
  await redisClient.publish("socket:user", payload);
}

/**
 * Saves a Firecrawl API hit log to the firecrawl_log collection.
 * Called after every Firecrawl request — success or failure.
 */
async function saveFirecrawlLog({
  userId,
  websiteUrl,
  websiteHash,
  firecrawlUrl,
  response,
  status,
  errorMessage = null,
  source = "FIRECRAWL_API",
}) {
  try {
    const savedFirecrawlData = await FirecrawllogModel.create({
      userId,
      websiteUrl,
      websiteHash,
      firecrawlUrl,
      source,
      response,
      status,
      errorMessage,
    });

    logger.info(`[FirecrawlLog] Hit recorded`, {
      userId,
      websiteHash,
      status,
      source,
    });
    return savedFirecrawlData;
  } catch (err) {
    // Non-critical — log the error but don't interrupt the main flow
    logger.error("[FirecrawlLog] Failed to save Firecrawl log", {
      userId,
      websiteHash,
      error: err.message,
    });
  }
}

const convertBufferToPngBase64 = async (buffer) => {
  try {
    const pngBuffer = await sharp(buffer, { density: 300 }).png().toBuffer();
    return pngBuffer.toString("base64");
  } catch (error) {
    if (error.message.includes("unsupported image format") || error.message.includes("Input buffer")) {
      try {
        const image = await loadImage(buffer);
        const canvas = createCanvas(image.width, image.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, 0, 0);
        const pngBuffer = await canvas.encode("png");
        return pngBuffer.toString("base64");
      } catch (canvasError) {
        throw new Error(`Sharp and Canvas both failed: ${error.message} | ${canvasError.message}`);
      }
    }
    throw error;
  }
};

export const processAndUploadImage = async (
  inputUrl,
  businessName = null,
  isStudioImage = false,
) => {
  if (!inputUrl || typeof inputUrl !== "string") return inputUrl;

  const trimmedUrl = inputUrl.trim();

  // Already uploaded
  if (trimmedUrl.startsWith(config.CLOUDFRONT_BASE_URL)) {
    return trimmedUrl;
  }

  // Data URI
  if (trimmedUrl.startsWith("data:")) {
    const commaIndex = trimmedUrl.indexOf(",");

    if (commaIndex !== -1) {
      const meta = trimmedUrl.substring(0, commaIndex);
      const dataStr = trimmedUrl.substring(commaIndex + 1);

      let buffer;

      if (meta.includes(";base64")) {
        buffer = Buffer.from(dataStr, "base64");
      } else {
        try {
          buffer = Buffer.from(decodeURIComponent(dataStr));
        } catch {
          buffer = Buffer.from(dataStr);
        }
      }

      try {
        const pngBase64 = await convertBufferToPngBase64(buffer);

        if (isStudioImage && businessName) {
          return await uploadStudioImageBufferToS3(
            pngBase64,
            "image/png",
            businessName,
          );
        }

        return await uploadLogoBufferToS3(pngBase64, "image/png");
      } catch (err) {
        console.error("Error converting/uploading data URI:", err);
        return trimmedUrl;
      }
    }
  }

  // External URL
  let fetchUrl = trimmedUrl;

  if (fetchUrl.startsWith("//")) {
    fetchUrl = `https:${fetchUrl}`;
  }

  if (fetchUrl.startsWith("http")) {
    try {
      const response = await axios.get(fetchUrl, {
        responseType: "arraybuffer",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
        timeout: 10000,
      });

      const originalBuffer = Buffer.from(response.data);
      const contentType = response.headers["content-type"] || "";
      const fetchUrlLower = fetchUrl.toLowerCase();

      // Ensure we don't try to parse HTML pages as images
      if (contentType && !contentType.includes("image/") && !contentType.includes("icon") && !contentType.includes("octet-stream")) {
        console.warn(`[FirecrawlWorker] URL is not an image (Type: ${contentType}): ${fetchUrl}`);
        return trimmedUrl;
      }

      const pngBase64 = await convertBufferToPngBase64(originalBuffer);

      if (isStudioImage && businessName) {
        return await uploadStudioImageBufferToS3(
          pngBase64,
          "image/png",
          businessName,
        );
      }

      return await uploadLogoBufferToS3(pngBase64, "image/png");
    } catch (error) {
      console.error(
        `Error fetching/converting/uploading image (${fetchUrl}):`,
        error.message,
      );

      return trimmedUrl;
    }
  }

  console.log("trimmedUrl", trimmedUrl);

  return trimmedUrl;
};
/* ==============================
   BULLMQ WORKER
============================== */

new Worker(
  "firecrawl-queue",
  async (job) => {
    const { userId, websiteUrl, senderPhone, phoneNumberId } = job.data;

    console.log("🚀 Job Started:", {
      jobId: job.id,
      userId,
      websiteUrl,
    });

    const websiteHash = crypto
      .createHash("sha256")
      .update(websiteUrl)
      .digest("hex");

    try {
      /* ─────────────────────────────────────────────
         PRE-CHECK — FREE LIMITS / CREDITS
      ───────────────────────────────────────────── */
      const analysisCheck = await checkBulkFeatureCapacity({
        userId,
        featureKey: "websiteAnalysis",
        requiredCount: 1,
      });

      console.log(
        `[websiteAnalysis WORKER] Free Limit: ${analysisCheck.freeLimit}, Used: ${analysisCheck.freeUsed}`,
      );

      if (!analysisCheck.canAfford) {
        const user = await userModel.findById(userId);

        // try {
        //   await sendThirdPartyApiErrorEmail(
        //     {
        //       name: user?.name || "Unknown",
        //       email: user?.email || "-",
        //       phone: user?.phone || "-",
        //     },
        //     {
        //       jobId: job.id,
        //       userId: userId,
        //       message: analysisCheck.message,
        //     },
        //   );
        // } catch (emailErr) {
        //   console.error("Email sending failed:", emailErr);
        // }

        await BusinessSummaryProfile.findOneAndDelete({
          userId,
          websiteHash,
          isActive: true,
        });

        await setProgress({
          userId,
          websiteHash,
          stage: "FAILED",
          error: analysisCheck.message,
        });

        await emitToUser(userId, "analysis:failed", {
          websiteHash,
          error: analysisCheck.message,
        });

        // const jobremove = await firecrawlQueue.getJob(job.id);
        // await jobremove.remove();

        throw new Error(analysisCheck.message);
      }
      /* ================= FIRECRAWL START ================= */

      await setProgress({ userId, websiteHash, stage: "FIRECRAWL_STARTED" });

      console.log("📊 Progress Set: FIRECRAWL_STARTED", {
        userId,
        websiteHash,
      });

      await BusinessSummaryProfile.updateOne(
        { userId, websiteHash, isActive: true },
        { $set: { status: "PROCESSING" } },
      );

      await emitToUser(userId, "firecrawl:started", { websiteHash });

      const credential = await ApiCredential.findOne({
        provider: "FIRECRAWL",
        isActive: true,
      }).lean();

      if (!credential) {
        const user = await userModel.findById(userId);

        try {
          await sendThirdPartyApiErrorEmail(
            {
              name: user?.name || "Unknown",
              email: user?.email || "-",
              phone: user?.phone || "-",
            },
            {
              jobId: job.id,
              userId: userId,
              message: "No active Firecrawl API credential found",
            },
          );
        } catch (emailErr) {
          console.error("Email sending failed:", emailErr);
        }

        await BusinessSummaryProfile.findOneAndDelete({
          userId,
          websiteHash,
          isActive: true,
        });

        await setProgress({
          userId,
          websiteHash,
          stage: "FAILED",
          error: "No active Firecrawl API credential found",
        });

        await emitToUser(userId, "analysis:failed", {
          websiteHash,
          error: "No active Firecrawl API credential found",
        });

        // const jobremove = await firecrawlQueue.getJob(job.id);
        // await jobremove.remove();

        throw new Error("No active Firecrawl API credential found");
      }

      const apiKey = decrypt(credential.credentials.apiKey);

      const firecrawlUrl = credential.meta?.baseUrl?.length
        ? credential.meta.baseUrl
        : "https://api.firecrawl.dev/v2/scrape";

      let firecrawlResponse, savedFirecrawlData;

      /* ── CACHE CHECK: reuse existing successful Firecrawl log ── */
      const existingLog = await FirecrawllogModel.findOne({
        websiteHash,
        status: "success",
      }).lean();

      if (existingLog) {
        logger.info(
          `[FirecrawlWorker] Cache HIT for websiteUrl="${websiteUrl}" — skipping Firecrawl API call`,
          { userId, websiteHash },
        );
        console.log("♻️  Firecrawl Cache HIT — reusing stored response:", {
          userId,
          websiteUrl,
          websiteHash,
        });

        // Reconstruct a response-shaped object so the rest of the flow
        // works identically whether we hit the cache or the live API.
        firecrawlResponse = { data: existingLog.response };
        savedFirecrawlData = existingLog;
      } else {
        /* ── LIVE API CALL ── */
        // console.log(`[FirecrawlWorker] Checking website existence for: ${websiteUrl}`);
        // const validation = await validateWebsite(websiteUrl);
        // console.log("validation", validation)
        // if (!validation.exists) {
        //   const validationErrorMsg = `Website check failed: ${
        //     validation.errors.join("; ") || "Website is unreachable"
        //   }`;
        //   console.error(`[FirecrawlWorker] ${validationErrorMsg}`);

        //   await BusinessSummaryProfile.findOneAndDelete({
        //     userId,
        //     websiteHash,
        //     isActive: true,
        //   });

        //   await setProgress({
        //     userId,
        //     websiteHash,
        //     stage: "FAILED",
        //     error: validationErrorMsg,
        //   });

        //   await emitToUser(userId, "analysis:failed", {
        //     websiteHash,
        //     error: validationErrorMsg,
        //   });

        //   throw new Error(validationErrorMsg);
        // }

        try {
          console.log(
            `[FirecrawlWorker] Initiating Custom Scraper for ${websiteUrl}...`,
          );


          const customData = await scrapeWebsite(websiteUrl);
          firecrawlResponse = { data: customData };

          savedFirecrawlData = await saveFirecrawlLog({
            userId,
            websiteUrl,
            websiteHash,
            source: "CUSTOM_SCRAPER",
            response: customData,
            status: "success",
          });
          console.log(
            `[FirecrawlWorker] Custom Scraper SUCCESS for ${websiteUrl}`,
          );
        } catch (scraperError) {
          console.error(
            `[FirecrawlWorker] Custom Scraper FAILED for ${websiteUrl}:`,
            scraperError.message,
          );
          console.log(
            `[FirecrawlWorker] Initiating Firecrawl Fallback for ${websiteUrl}...`,
          );

          try {
            firecrawlResponse = await axios.post(
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
              },
            );

            savedFirecrawlData = await saveFirecrawlLog({
              userId,
              websiteUrl,
              websiteHash,
              firecrawlUrl,
              source: "FIRECRAWL_API",
              response: firecrawlResponse?.data,
              status: "success",
            });
            console.log(
              `[FirecrawlWorker] Firecrawl Fallback SUCCESS for ${websiteUrl}`,
            );
          } catch (firecrawlError) {
            console.error(
              `[FirecrawlWorker] Firecrawl Fallback FAILED for ${websiteUrl}:`,
              firecrawlError.message,
            );

            await saveFirecrawlLog({
              userId,
              websiteUrl,
              websiteHash,
              firecrawlUrl,
              source: "FIRECRAWL_API",
              response: firecrawlError?.response?.data ?? null,
              status: "failed",
              errorMessage: firecrawlError.message,
            });

            const user = await userModel.findById(userId);

            try {
              await sendThirdPartyApiErrorEmail(
                {
                  name: user?.name || "Unknown",
                  email: user?.email || "-",
                  phone: user?.phone || "-",
                },
                {
                  jobId: job.id,
                  userId: userId,
                  message: `Custom Scraper Error: ${scraperError.message} | Firecrawl Fallback Error: ${firecrawlError.message}`,
                },
              );
            } catch (emailErr) {
              console.error("Email sending failed:", emailErr);
            }

            await BusinessSummaryProfile.findOneAndDelete({
              userId,
              websiteHash,
              isActive: true,
            });

            await setProgress({
              userId,
              websiteHash,
              stage: "FAILED",
              error: firecrawlError.message,
            });

            await emitToUser(userId, "analysis:failed", {
              websiteHash,
              error: firecrawlError.message,
            });

            throw firecrawlError;
          }
        }
      } // end else (live API call)

      console.log("✅ Scraping Phase Complete", {
        userId,
        websiteHash,
        source: savedFirecrawlData?.source || "UNKNOWN",
      });

      let FirecrawlbrandingGuidelineslogoUrl = "";
      let FirecrawlbrandingGuidelinesfaviconUrl = "";
      let isDataBranding = false; // Flag to determine DB path

      if (savedFirecrawlData) {
        // Parse Firecrawl structure: handle both response.data.branding and response.branding
        let FirecrawlbrandingGuidelines =
          savedFirecrawlData?.response?.data?.branding;
        if (FirecrawlbrandingGuidelines) {
          isDataBranding = true;
        } else {
          FirecrawlbrandingGuidelines =
            savedFirecrawlData?.response?.branding || {};
        }

        // Extract from either nested images object or directly
        FirecrawlbrandingGuidelineslogoUrl =
          FirecrawlbrandingGuidelines?.images?.logo ||
          FirecrawlbrandingGuidelines?.logo;
        FirecrawlbrandingGuidelinesfaviconUrl =
          FirecrawlbrandingGuidelines?.images?.favicon ||
          FirecrawlbrandingGuidelines?.favicon;
      } else {
        // Parse Custom Scraper structure
        FirecrawlbrandingGuidelineslogoUrl =
          firecrawlResponse?.data?.branding?.images?.logo ||
          firecrawlResponse?.data?.branding?.logo;
        FirecrawlbrandingGuidelinesfaviconUrl =
          firecrawlResponse?.data?.branding?.images?.favicon ||
          firecrawlResponse?.data?.branding?.favicon;
      }

      const FirecrawlprocessedLogoUrl = await processAndUploadImage(
        FirecrawlbrandingGuidelineslogoUrl,
      );
      const FirecrawlprocessedFaviconUrl = await processAndUploadImage(
        FirecrawlbrandingGuidelinesfaviconUrl,
      );

      if (FirecrawlprocessedLogoUrl || FirecrawlprocessedFaviconUrl) {
        if (savedFirecrawlData && savedFirecrawlData._id) {
          // Construct the update fields dynamically based on the detected path
          const updateFields = {};
          const pathPrefix = isDataBranding
            ? "response.data.branding"
            : "response.branding";

          if (FirecrawlprocessedLogoUrl) {
            updateFields[`${pathPrefix}.images.logo`] =
              FirecrawlprocessedLogoUrl;
            updateFields[`${pathPrefix}.logo`] = FirecrawlprocessedLogoUrl;
          }
          if (FirecrawlprocessedFaviconUrl) {
            updateFields[`${pathPrefix}.images.favicon`] =
              FirecrawlprocessedFaviconUrl;
            updateFields[`${pathPrefix}.favicon`] =
              FirecrawlprocessedFaviconUrl;
          }

          // Update Firecrawl log cache if available
          await FirecrawllogModel.findByIdAndUpdate(savedFirecrawlData._id, {
            $set: updateFields,
          });
        }

        // Always ensure the current runtime object has the processed images for Claude
        if (firecrawlResponse?.data?.branding) {
          if (!firecrawlResponse.data.branding.images)
            firecrawlResponse.data.branding.images = {};

          if (FirecrawlprocessedLogoUrl) {
            firecrawlResponse.data.branding.images.logo =
              FirecrawlprocessedLogoUrl;
            firecrawlResponse.data.branding.logo = FirecrawlprocessedLogoUrl;
          }
          if (FirecrawlprocessedFaviconUrl) {
            firecrawlResponse.data.branding.images.favicon =
              FirecrawlprocessedFaviconUrl;
            firecrawlResponse.data.branding.favicon =
              FirecrawlprocessedFaviconUrl;
          }
        }
      }

      await setProgress({ userId, websiteHash, stage: "FIRECRAWL_COMPLETED" });

      await emitToUser(userId, "firecrawl:completed", { websiteHash });

      /* ================= SAVE SCRAPED ASSETS ================= */
      // Extract dynamic business name from the website URL
      let extractedBusinessName = "business";
      try {
        const urlObj = new URL(websiteUrl);
        extractedBusinessName = urlObj.hostname
          .replace(/^www\./i, "")
          .split(".")[0];
      } catch (e) {}

      // Persist images, links, iframes & branding into BusinessScrapedAsset
      try {
        // Locate the active business profile so we can key assets by its _id
        // const activeProfile = await BusinessSummaryProfile.findOne({
        //   userId,
        //   websiteHash,
        //   isActive: true,
        // }).lean();

        // if (activeProfile && activeProfile._id) {
        //   // Normalise scraped data — structure differs between Custom Scraper & Firecrawl API
        //   let scrapedImages = [];
        //   let scrapedLinks = [];
        //   let scrapedIframes = [];
        //   let scrapedBranding = {};

        //   if (savedFirecrawlData && savedFirecrawlData.response) {
        //     // Firecrawl API / cached log — assets live under response.data
        //     const respData =
        //       savedFirecrawlData.response?.data ||
        //       savedFirecrawlData.response ||
        //       {};
        //     scrapedImages = respData.images || [];
        //     scrapedLinks = respData.links || [];
        //     scrapedIframes = respData.iframes || [];
        //     scrapedBranding = respData.branding || {};
        //   } else if (firecrawlResponse && firecrawlResponse.data) {
        //     // Custom scraper — flat structure
        //     scrapedImages = firecrawlResponse.data.images || [];
        //     scrapedLinks = firecrawlResponse.data.links || [];
        //     scrapedIframes = firecrawlResponse.data.iframes || [];
        //     scrapedBranding = firecrawlResponse.data.branding || {};
        //   }

        //   // Process all scraped images to upload them to the dynamic S3 studio folder
        //   if (scrapedImages && scrapedImages.length > 0) {
        //     console.log(
        //       `[FirecrawlWorker] Processing ${scrapedImages.length} images for ${extractedBusinessName}...`,
        //     );
        //     // We use a simple for...of loop to avoid overwhelming the target server or memory,
        //     // but for speed we can do batches of 5.
        //     const batchSize = 5;
        //     for (let i = 0; i < scrapedImages.length; i += batchSize) {
        //       const batch = scrapedImages.slice(i, i + batchSize);
        //       await Promise.all(
        //         batch.map(async (imgObj) => {
        //           if (imgObj && imgObj.src) {
        //             imgObj.src = await processAndUploadImage(
        //               imgObj.src,
        //               extractedBusinessName,
        //               true,
        //             );
        //           }
        //         }),
        //       );
        //     }
        //   }

        //   const businessEntry = {
        //     businessId: activeProfile._id,
        //     images: scrapedImages,
        //     links: scrapedLinks,
        //     iframes: scrapedIframes,
        //     branding: scrapedBranding,
        //     scrapedAt: new Date(),
        //   };

        //   await BusinessScrapedAsset.findOneAndUpdate(
        //     { userId },
        //     { $push: { BusinessData: businessEntry } },
        //     { upsert: true, new: true },
        //   );

        //   console.log(
        //     "📦 Scraped assets (with S3 URLs) saved to BusinessScrapedAsset",
        //     {
        //       businessId: activeProfile._id,
        //       images: scrapedImages.length,
        //       links: scrapedLinks.length,
        //     },
        //   );
        // } else {
        //   logger.warn(
        //     "[FirecrawlWorker] No active BusinessSummaryProfile found — skipping asset save",
        //     {
        //       userId,
        //       websiteHash,
        //     },
        //   );
        // }

        let scrapedImages = [];
        let scrapedLinks = [];
        let scrapedIframes = [];
        let scrapedBranding = {};

        if (savedFirecrawlData && savedFirecrawlData.response) {
          const respData =
            savedFirecrawlData.response?.data ||
            savedFirecrawlData.response ||
            {};
          scrapedImages = respData.images || [];
          scrapedLinks = respData.links || [];
          scrapedIframes = respData.iframes || [];
          scrapedBranding = respData.branding || {};
        } else if (firecrawlResponse && firecrawlResponse.data) {
          scrapedImages = firecrawlResponse.data.images || [];
          scrapedLinks = firecrawlResponse.data.links || [];
          scrapedIframes = firecrawlResponse.data.iframes || [];
          scrapedBranding = firecrawlResponse.data.branding || {};
        }

        await scrapedAssetQueue.add(
          "process-scraped-assets",
          {
            userId,
            websiteHash,
            extractedBusinessName,
            scrapedImages,
            scrapedLinks,
            scrapedIframes,
            scrapedBranding,
          },
          {
            removeOnComplete: true,
            removeOnFail: {
              count: 100,
            },
          },
        );
        logger.info(
          `[FirecrawlWorker] Enqueued asset processing for ${extractedBusinessName}`,
          { userId, websiteHash },
        );
      } catch (assetErr) {
        // Non-critical — don't block Claude analysis
        logger.error("[FirecrawlWorker] Failed to save scraped assets", {
          userId,
          websiteHash,
          error: assetErr.message,
        });
      }

      /* ================= CLAUDE START ================= */

      await setProgress({ userId, websiteHash, stage: "CLAUDE_STARTED" });

      await emitToUser(userId, "claude:started", { websiteHash });

      console.log("🤖 Claude Analysis Started:", {
        userId,
        websiteHash,
      });
      //  analyzeWebsiteClaude(savedFirecrawlData, userId)
      const claudeAnalysis = await runClaudeAnalysis(
        firecrawlResponse?.data,
        userId,
        false,
        false,
      );

      const analysisSummary = await generateAnalysisSummary(claudeAnalysis);

      console.log("🤖 Claude Analysis Completed:", {
        userId,
        websiteHash,
      });

      await setProgress({ userId, websiteHash, stage: "CLAUDE_COMPLETED" });

      await emitToUser(userId, "claude:completed", { websiteHash });

      // let logoUrl = claudeAnalysis?.branding_guidelines?.logo_url;

      // if (!logoUrl || logoUrl === "") {
      //   const user = await userModel.findById(userId);

      //   if (user?.accountType === "business") {
      //     try {
      //       console.log("🎨 Generating logo for business account:", { userId });

      //       // 1. Generate logo from analysis summary
      //       const buffer = await createStaticLogo(claudeAnalysis);

      //       if (buffer) {
      //         // 2. Convert Buffer to Base64
      //         const base64 = 'data:image/png;base64,' + buffer.toString('base64');
      //         const base64Data = base64.replace(/^data:image\/\w+;base64,/, '');

      //         // 3. Upload to S3 and get final URL
      //         const uploadedLogoUrl = await uploadLogoBufferToS3(base64Data);
      //         console.log("✅ Logo uploaded:", uploadedLogoUrl);

      //         logoUrl = uploadedLogoUrl;

      //         // 4. Update claudeAnalysis object with new logo
      //         if (!claudeAnalysis.branding_guidelines) {
      //           claudeAnalysis.branding_guidelines = {};
      //         }
      //         claudeAnalysis.branding_guidelines.logo_url = logoUrl;
      //       }
      //     } catch (logoErr) {
      //       logger.error(`[FirecrawlWorker] Logo generation failed: ${logoErr.message}`, {
      //         userId,
      //         websiteHash,
      //         error: logoErr
      //       });
      //       // Non-critical error - continue without logo
      //     }
      //   }
      // }

      /* ================= SAVE RESULT ================= */

      const savedProfile = await BusinessSummaryProfile.findOneAndUpdate(
        { userId, websiteHash, isActive: true },
        {
          websiteUrl,
          websiteHash,
          status: "COMPLETED",
          analysis: claudeAnalysis,
          analysisSummary,
          model: "firecrawl+claude",
          isActive: true,
        },
        { upsert: true, new: true },
      );

      await userModel.findByIdAndUpdate(
        userId,
        { $set: { accountType: "business" } },
        { upsert: true, new: true },
      );

      console.log("💾 DB Saved:", {
        userId,
        websiteHash,
      });

      // Deduct credit / increment free usage for website analysis
      try {
        const creditResult = await trackAndDeductFeatureCredit({
          userId,
          featureKey: "websiteAnalysis",
          usageCount: 1,
          description: `Website Intelligence — ${websiteUrl}`,
          idempotencyKey: `analysis-${websiteHash}-${job.id}`,
          metadata: {
            title: `Website Analysis: ${websiteUrl}`,
            extra: {
              source: "websiteAnalysis",
              websiteUrl,
              websiteHash,
              jobId: job.id,
            },
          },
        });
        logger.info(
          `[FirecrawlWorker] Credit deducted successfully for ${websiteUrl} | via: ${creditResult.via} | balanceAfter: ${creditResult.balanceAfter}`,
        );
      } catch (creditErr) {
        logger.error(
          `[FirecrawlWorker] Credit deduction failed for ${websiteUrl}: ${creditErr.message || creditErr}`,
        );
      }

      await setProgress({ userId, websiteHash, stage: "COMPLETED" });

      await emitToUser(userId, "analysis:completed", { websiteHash });

      // 🔹 Automatically Send WhatsApp PDF Report if the user onboarded via Chatbot
      try {
        const Contact = mongoose.model("Contact");
        let contact = null;
        if (senderPhone) {
          contact = await Contact.findOne({
            userId,
            $or: [
              { phone: senderPhone },
              { phone: `+${senderPhone}` },
              { phone: senderPhone.replace(/^\+/, "") }
            ],
            isDeleted: false
          });
        }
        if (!contact) {
          contact = await Contact.findOne({ userId, isDeleted: false });
        }
        if (contact && contact.phone) {
          const WhatsAppToken = mongoose.model("WhatsAppToken");
          let credentials = null;
          if (phoneNumberId) {
            credentials = await WhatsAppToken.findOne({ userId, phoneNumberId }).select(
              "+accessToken",
            );
          }
          if (!credentials) {
            credentials = await WhatsAppToken.findOne({ userId }).select(
              "+accessToken",
            );
          }
          if (
            credentials &&
            credentials.accessToken &&
            credentials.phoneNumberId
          ) {
            logger.info(
              `[FirecrawlWorker] Generating WhatsApp analysis PDF report for contact: ${contact.phone}`,
            );
            const pdfData = preparePdfData(claudeAnalysis, websiteUrl);
            const pdfBuffer = await generatePdfBuffer(
              "analysis_report.html",
              pdfData,
            );
            const pdfUrl = await uploadPdfToS3(
              pdfBuffer,
              config.AWS_S3_ANALYSIS_REPORT_FOLDER,
            );

            savedProfile.pdfUrl = pdfUrl;
            await savedProfile.save();

            const FB_GRAPH = "https://graph.facebook.com/v21.0";
            await axios.post(
              `${FB_GRAPH}/${credentials.phoneNumberId}/messages`,
              {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to: contact.phone,
                type: "document",
                document: {
                  link: pdfUrl,
                  filename: `${claudeAnalysis?.business_overview?.brand_name || "Borade_AI"}_Website_Analysis_Report.pdf`,
                  caption: `Here is your complete website analysis report PDF from Borade AI!`,
                },
              },
              {
                headers: {
                  Authorization: `Bearer ${credentials.accessToken}`,
                  "Content-Type": "application/json",
                },
              },
            );
            logger.info(
              `[FirecrawlWorker] Automatically sent PDF report via WhatsApp to ${contact.phone}`,
            );
          }
        }
      } catch (waNotifyErr) {
        logger.error(
          `[FirecrawlWorker] Failed to send wa notification: ${waNotifyErr.message}`,
        );
      }

      const targetMarket = savedProfile?.analysis?.target_market || {};
      const businessOverview = savedProfile?.analysis?.business_overview || {};

      const dynamicQueries =
        (targetMarket.primary_customer_segments?.length || 0) +
        (targetMarket.ideal_client_profiles?.length || 0) +
        (targetMarket.decision_makers?.length || 0);

      const dynamicLocations = businessOverview.geographic_focus?.length || 0;

      // Dynamic Lead Limit based on primaryLeads limit
      const leadsLimitCheck = await checkBulkFeatureCapacity({
        userId,
        featureKey: "leads",
        requiredCount: 1,
      });

      const leadLimit = leadsLimitCheck.freeLimit || 5; // Default to 5 if not found
      // logger.info(`[FirecrawlWorker] Triggering scraper with lead limit: ${leadLimit}`);

      // triggerScraperForProfile({
      //   userId: userId.toString(),
      //   profileId: savedProfile._id.toString(),
      //   maxResults: leadLimit,
      //   maxQueries: 1,
      //   maxLocations: 1,
      // }).catch((err) =>
      //   logger.error(
      //     `[AUTO-SCRAPER] Failed to trigger for userId=${userId}: ${err.message}`,
      //   ),
      // );

      const TargetMarket =
        targetMarket?.primary_customer_segments[1] ||
        targetMarket?.primary_customer_segments[0];

      const TargetGeoLocation =
        businessOverview?.geographic_focus[0] ||
        businessOverview?.geographic_focus[1];

      const leadJob = await GoogleApileadGenerationQueue.add(
        "generate-leads",
        {
          targetMarket: TargetMarket,
          geographicFocus: TargetGeoLocation,
          numberOfLeads: leadLimit || 5,
          userId: userId.toString(),
        },
        {
          jobId: `lead-${userId}-${Date.now()}`,
        },
      );

      console.log("🎉 Job Completed Successfully:", {
        jobId: leadJob.id,
        userId,
      });

      /* ─────────────────────────────────────────────
         PRE-CHECK — VIDEO/IMAGE LIMITS BEFORE QUEUE
      ───────────────────────────────────────────── */
      const videoState = await checkBulkFeatureCapacity({
        userId,
        featureKey: "videoGeneration",
        requiredCount: 1,
        metadata: { source: "websiteAnalysis" },
      });

      const imageState = await checkBulkFeatureCapacity({
        userId,
        featureKey: "imageGeneration",
        requiredCount: 1,
        metadata: { source: "websiteAnalysis" },
      });

      // Only skip if BOTH are unaffordable
      if (!videoState.canAfford && !imageState.canAfford) {
        logger.warn(
          `[FirecrawlWorker] Skipping video generation for user ${userId} due to limits.`,
        );
        await emitToUser(userId, "video:generation:failed", {
          websiteHash,
          error: "Video and image generation skipped due to plan limits.",
        });
      } else {
        await videoGenerationQueue.add("generate-videos", {
          userId,
          websiteHash,
        });
      }

      // Non-blocking auto-trigger
      // triggerScraperForProfile({
      //   userId: userId.toString(),
      //   profileId: savedProfile._id.toString(),
      //   maxResults: 5,
      //   maxQueries: 1,
      //   maxLocations: 1,
      // }).catch((err) =>
      //   console.error("[AUTO-SCRAPER] Trigger failed:", err.Message),
      // );

      // Safe clean up: Clear progress from Redis after 5s to allow UI sync to finish
      // setTimeout(async () => {
      //   try {
      //     await clearProgress(userId, websiteHash);
      //     logger.info(
      //       `[FirecrawlWorker] Cleared Redis progress key for user: ${userId}`,
      //     );
      //   } catch (err) {
      //     logger.error(
      //       `[FirecrawlWorker] Failed to clear progress key: ${err.message}`,
      //     );
      //   }
      // }, 5000);

      return true;
    } catch (error) {
      let message = "Service temporarily unavailable. Kindly try again after some time.";
      let errorCode = "ANT-500";

      if (error?.formattedAiError) {
        message = error.formattedAiError.userMessage;
        errorCode = error.formattedAiError.code;
      } else {
        try {
          const providerName = error?.config?.url?.includes("anthropic") ? "Anthropic" : "Firecrawl";
          const formatted = await logAndFormatAiError(error, providerName, {
            endpoint: "firecrawl.worker",
            userId,
            requestPayload: { websiteUrl, websiteHash, jobId: job.id },
          });
          message = formatted.userMessage;
          errorCode = formatted.code;
        } catch (logErr) {
          console.error("Failed to log worker error:", logErr);
          message = error?.message || message;
        }
      }

      console.error("🔥 API Error:", message, `(Code: ${errorCode})`);

      console.error("🔥 Worker Error:", {
        jobId: job.id,
        userId,
        errorCode,
        message,
      });

      const user = await userModel.findById(userId);

      try {
        await sendThirdPartyApiErrorEmail(
          {
            name: user?.name || "Unknown",
            email: user?.email || "-",
            phone: user?.phone || "-",
          },
          {
            jobId: job.id,
            userId: userId,
            message: `${message} (Code: ${errorCode})`,
          },
        );
      } catch (emailErr) {
        console.error("Email sending failed:", emailErr);
      }

      await BusinessSummaryProfile.findOneAndDelete({
        userId,
        websiteHash,
        isActive: true,
      });

      await setProgress({
        userId,
        websiteHash,
        stage: "FAILED",
        error: message,
        errorCode,
      });

      await emitToUser(userId, "analysis:failed", {
        websiteHash,
        error: message,
        errorCode,
      });

      throw error;
    }
  },
  {
    connection: redisClient.duplicate(),
    concurrency: 1,
    lockDuration: 300000, // 5 minutes lock for heavy Puppeteer scraping
  },
);
