import { Worker } from "bullmq";
import axios from "axios";
import crypto from "crypto";
import redisClient from "../../config/redis.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import {
  generateAnalysisSummary,
  runClaudeAnalysis,
} from "../../services/claude.service.js";
import { setProgress, clearProgress } from "../../utils/analysisProgress.js";
import ApiCredential from "../../models/ApiCredential.js";
import { decrypt } from "../../utils/crypto.js";
import logger from "../../config/logger.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";
import FirecrawllogModel from "../../models/Firecrawllog.model.js";
import {
  trackAndDeductFeatureCredit,
  checkBulkFeatureCapacity,
} from "../../utils/creditTracker.js";
import { sendThirdPartyApiErrorEmail } from "../../utils/emailServices.js";
import userModel from "../../models/userModel.js";
import { processAndUploadImage } from "./firecrawl.worker.js";

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

async function saveFirecrawlLog({
  userId,
  websiteUrl,
  websiteHash,
  firecrawlUrl,
  response,
  status,
  errorMessage = null,
}) {
  try {
    const savedFirecrawlData = await FirecrawllogModel.create({
      userId,
      websiteUrl,
      websiteHash,
      firecrawlUrl,
      response,
      status,
      errorMessage,
    });
    logger.info(`[FirecrawlLog] Hit recorded`, { userId, websiteHash, status });
    return savedFirecrawlData;
  } catch (err) {
    logger.error("[FirecrawlLog] Failed to save Firecrawl log", {
      userId,
      websiteHash,
      error: err.message,
    });
  }
}

new Worker(
  "reanalysis-queue",
  async (job) => {
    const { userId, websiteUrl, websiteHash: passedHash } = job.data;

    console.log("🚀 Re-analysis Job Started:", {
      jobId: job.id,
      userId,
      websiteUrl,
      passedHash,
    });

    const websiteHash =
      passedHash ||
      crypto.createHash("sha256").update(websiteUrl).digest("hex");

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
        `[Re-analysis WORKER] Free Limit: ${analysisCheck.freeLimit}, Used: ${analysisCheck.freeUsed}`,
      );

      if (!analysisCheck.canAfford) {
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
              message: analysisCheck.message,
            },
          );
        } catch (emailErr) {
          console.error("Email sending failed:", emailErr);
        }

        await BusinessSummaryProfile.findOneAndUpdate(
          { userId, websiteHash, isActive: true },
          {
            $set: {
              status: "FAILED",
              isActive: false,
              errorMessage: analysisCheck.message,
            },
          },
        );

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

        throw new Error(analysisCheck.message);
      }

      /* ================= FIRECRAWL START ================= */
      await setProgress({ userId, websiteHash, stage: "FIRECRAWL_STARTED" });
      console.log("📊 Progress Set: FIRECRAWL_STARTED", {
        userId,
        websiteHash,
      });

      // Update BSP status to PROCESSING so page-refresh shows loader
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

        await BusinessSummaryProfile.findOneAndUpdate(
          { userId, websiteHash, isActive: true },
          {
            $set: {
              status: "FAILED",
              isActive: false,
              errorMessage: "No active Firecrawl API credential found",
            },
          },
        );

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

        throw new Error("No active Firecrawl API credential found");
      }

      const apiKey = decrypt(credential.credentials.apiKey);
      const firecrawlUrl = credential.meta?.baseUrl?.length
        ? credential.meta.baseUrl
        : "https://api.firecrawl.dev/v2/scrape";

      let firecrawlResponse, savedFirecrawlData;
      let  FirecrawlprocessedLogoUrl, FirecrawlprocessedFaviconUrl;

      // Re-analysis: Force live API scrape or check log.
      // Usually re-analysis wants fresh data, but we can respect log cache if desired.
      // Let's use cache or fetch fresh. Let's do fresh scrape first, but fallback to cache if live API fails.
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
          response: firecrawlResponse?.data,
          status: "success",
        });

        let FirecrawlbrandingGuidelineslogoUrl = "";
        let FirecrawlbrandingGuidelinesfaviconUrl = "";
        let isDataBranding = false; // Flag to determine DB path
        
        if (savedFirecrawlData) {
          // Parse Firecrawl structure: handle both response.data.branding and response.branding
          let FirecrawlbrandingGuidelines = savedFirecrawlData?.response?.data?.branding;
          if (FirecrawlbrandingGuidelines) {
            isDataBranding = true;
          } else {
            FirecrawlbrandingGuidelines = savedFirecrawlData?.response?.branding || {};
          }

          // Extract from either nested images object or directly
          FirecrawlbrandingGuidelineslogoUrl = FirecrawlbrandingGuidelines?.images?.logo || FirecrawlbrandingGuidelines?.logo;
          FirecrawlbrandingGuidelinesfaviconUrl = FirecrawlbrandingGuidelines?.images?.favicon || FirecrawlbrandingGuidelines?.favicon;
        } else {
          // Fallback if savedFirecrawlData is somehow null
          FirecrawlbrandingGuidelineslogoUrl = firecrawlResponse?.data?.branding?.images?.logo || firecrawlResponse?.data?.branding?.logo;
          FirecrawlbrandingGuidelinesfaviconUrl = firecrawlResponse?.data?.branding?.images?.favicon || firecrawlResponse?.data?.branding?.favicon;
        }

        FirecrawlprocessedLogoUrl = await processAndUploadImage(
          FirecrawlbrandingGuidelineslogoUrl,
        );
        FirecrawlprocessedFaviconUrl = await processAndUploadImage(
          FirecrawlbrandingGuidelinesfaviconUrl,
        );

        if (FirecrawlprocessedLogoUrl || FirecrawlprocessedFaviconUrl) {
          if (savedFirecrawlData && savedFirecrawlData._id) {
            // Construct the update fields dynamically based on the detected path
            const updateFields = {};
            const pathPrefix = isDataBranding ? "response.data.branding" : "response.branding";

            if (FirecrawlprocessedLogoUrl) {
              updateFields[`${pathPrefix}.images.logo`] = FirecrawlprocessedLogoUrl;
              updateFields[`${pathPrefix}.logo`] = FirecrawlprocessedLogoUrl;
            }
            if (FirecrawlprocessedFaviconUrl) {
              updateFields[`${pathPrefix}.images.favicon`] = FirecrawlprocessedFaviconUrl;
              updateFields[`${pathPrefix}.favicon`] = FirecrawlprocessedFaviconUrl;
            }

            savedFirecrawlData = await FirecrawllogModel.findByIdAndUpdate(
              savedFirecrawlData._id,
              { $set: updateFields },
              { new: true }
            );
          }
          
          // Always ensure the current runtime object has the processed images for Claude
          if (firecrawlResponse?.data?.branding) {
            if (!firecrawlResponse.data.branding.images) firecrawlResponse.data.branding.images = {};
            
            if (FirecrawlprocessedLogoUrl) {
              firecrawlResponse.data.branding.images.logo = FirecrawlprocessedLogoUrl;
              firecrawlResponse.data.branding.logo = FirecrawlprocessedLogoUrl;
            }
            if (FirecrawlprocessedFaviconUrl) {
              firecrawlResponse.data.branding.images.favicon = FirecrawlprocessedFaviconUrl;
              firecrawlResponse.data.branding.favicon = FirecrawlprocessedFaviconUrl;
            }
          }
        }
      } catch (firecrawlError) {
        // Enforce fresh data for re-analysis: If live scrape fails, we do NOT fallback to cache
        await saveFirecrawlLog({
          userId,
          websiteUrl,
          websiteHash,
          firecrawlUrl,
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
              message: firecrawlError.message,
            },
          );
        } catch (emailErr) {
          console.error("Email sending failed:", emailErr);
        }

        await BusinessSummaryProfile.findOneAndUpdate(
          { userId, websiteHash, isActive: true },
          {
            $set: {
              status: "FAILED",
              isActive: false,
              errorMessage: firecrawlError.message,
            },
          },
        );

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

      await setProgress({ userId, websiteHash, stage: "FIRECRAWL_COMPLETED" });
      await emitToUser(userId, "firecrawl:completed", { websiteHash });

      /* ================= CLAUDE START ================= */
      await setProgress({ userId, websiteHash, stage: "CLAUDE_STARTED" });
      await emitToUser(userId, "claude:started", { websiteHash });

      const claudeAnalysis = await runClaudeAnalysis(
        firecrawlResponse?.data,
        userId,
        false,
        true,
      );
      const analysisSummary = await generateAnalysisSummary(claudeAnalysis);

      await setProgress({ userId, websiteHash, stage: "CLAUDE_COMPLETED" });
      await emitToUser(userId, "claude:completed", { websiteHash });

      /* ================= SAVE RESULT & UPDATE HISTORIES ================= */
      const oldProfile = await BusinessSummaryProfile.findOne({
        userId,
        websiteHash,
      }).sort({ createdAt: -1 });

      // Deactivate all previous profiles for this user
      await BusinessSummaryProfile.updateMany(
        { userId },
        { $set: { isActive: false } },
      );

      // Create new active profile
      const savedProfile = await BusinessSummaryProfile.create({
        userId,
        websiteUrl,
        websiteHash,
        status: "COMPLETED",
        analysis: claudeAnalysis,
        analysisSummary,
        model: "firecrawl+claude",
        isActive: true,
        verifiedEmail: oldProfile?.verifiedEmail,
        crawledEmails: oldProfile?.crawledEmails || [],
        whoGenerated: oldProfile?.whoGenerated || "user",
        adminOutreachId: oldProfile?.adminOutreachId,
      });

      await BusinessSummaryProfile.updateOne(
        {
          _id: savedProfile?._id,
        },
        {
          $set: {
            "analysis.branding_guidelines.logo_url": FirecrawlprocessedLogoUrl,
            "analysis.branding_guidelines.favicon_url": FirecrawlprocessedFaviconUrl,
          },
        },
      );

      console.log("💾 DB Saved New Active Re-analysis Profile:", {
        userId,
        websiteHash,
      });

      // Deduct credit for re-analysis
      try {
        const creditResult = await trackAndDeductFeatureCredit({
          userId,
          featureKey: "websiteAnalysis",
          usageCount: 1,
          description: `Website Intelligence Re-analysis — ${websiteUrl}`,
          idempotencyKey: `reanalysis-${websiteHash}-${job.id}`,
          metadata: {
            title: `Website Re-analysis: ${websiteUrl}`,
            extra: {
              source: "websiteAnalysis",
              websiteUrl,
              websiteHash,
              jobId: job.id,
            },
          },
        });
        logger.info(
          `[ReanalysisWorker] Credit deducted successfully for ${websiteUrl}`,
        );
      } catch (creditErr) {
        logger.error(
          `[ReanalysisWorker] Credit deduction failed: ${creditErr.message}`,
        );
      }

      await setProgress({ userId, websiteHash, stage: "COMPLETED" });
      await emitToUser(userId, "analysis:completed", { websiteHash });

      // Safe clean up: Clear progress from Redis after 5s to allow UI sync to finish
      // setTimeout(async () => {
      //   try {
      //     await clearProgress(userId, websiteHash);
      //     logger.info(
      //       `[ReanalysisWorker] Cleared Redis progress key for user: ${userId}`,
      //     );
      //   } catch (err) {
      //     logger.error(
      //       `[ReanalysisWorker] Failed to clear progress key: ${err.message}`,
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
            endpoint: "reanalysis.worker",
            userId,
            requestPayload: { websiteUrl, websiteHash, jobId: job.id },
          });
          message = formatted.userMessage;
          errorCode = formatted.code;
        } catch (logErr) {
          console.error("Failed to log reanalysis worker error:", logErr);
          message = error?.message || message;
        }
      }

      console.error("🔥 Re-analysis Worker Error:", {
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

      await BusinessSummaryProfile.findOneAndUpdate(
        { userId, websiteHash, isActive: true },
        { $set: { status: "FAILED", isActive: false, errorMessage: message } },
      );

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

      // Safe clean up: Clear progress from Redis after 5s to allow UI sync to finish
      setTimeout(async () => {
        try {
          await clearProgress(userId, websiteHash);
          logger.info(
            `[ReanalysisWorker] Cleared Redis progress key for user: ${userId} (failed analysis)`,
          );
        } catch (err) {
          logger.error(
            `[ReanalysisWorker] Failed to clear progress key: ${err.message}`,
          );
        }
      }, 5000);

      throw error;
    }
  },
  {
    connection: redisClient.duplicate(),
    concurrency: 1,
  },
);
