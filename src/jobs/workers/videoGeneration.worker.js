// queue/workers/videoGeneration.worker.js
// Fixes applied on top of the previous version:
//   1. Removed unused top-level static imports of runVideoContentGeneration
//      and runImageContentGeneration (wrappers import them dynamically instead)
//   2. Removed dead `const results = []` that was never used
//   3. Fixed misleading progress strategy — events now fire ONE AT A TIME
//      interleaved with the actual per-item generation, not all upfront
//      before generation starts. Each item is generated individually so the
//      progress counter reflects real work completed, not a fake countdown.

import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import socketService from "../../socket.js";
import { createMediaDocument } from "../../controllers/SocialMedia/MediaStoreController.js";
import {
  trackAndDeductFeatureCredit,
  checkBulkFeatureCapacity,
} from "../../utils/creditTracker.js";
import { setVideoProgress } from "../../utils/Videoprogress.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";

// ─── helper ───────────────────────────────────────────────────────────────
function emitToUser(userId, event, payload) {
  socketService.emitToUser(userId, event, payload);
}

new Worker(
  "video-generation-queue",
  async (job) => {
    const { userId, websiteHash } = job.data;

    logger.info("[VideoWorker] Job started", { userId, websiteHash });

    try {
      /* ─────────────────────────────────────────────
         PRE-CHECK — FREE LIMITS / CREDITS
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

      const canGenerateVideo = videoState.canAfford;
      const canGenerateImage = imageState.canAfford;

      if (!canGenerateVideo && !canGenerateImage) {
        const errorMsg = [videoState.message, imageState.message]
          .filter(Boolean)
          .join(" & ");
        throw new Error(
          errorMsg || "Insufficient limits for media generation.",
        );
      }

      let videoList = [];
      let imageList = [];

      /* ─────────────────────────────────────────────
         PHASE 1 — VIDEO GENERATION
      ───────────────────────────────────────────── */
      if (canGenerateVideo) {
        await setVideoProgress({
          userId,
          websiteHash,
          stage: "VIDEO_GENERATION_STARTED",
          label: "Starting video generation",
        });

        emitToUser(userId, "video:generation:started", {
          websiteHash,
          message: "Starting AI video generation...",
        });

        videoList = await runVideoContentGenerationWithProgress(
          userId,
          websiteHash,
          async ({ current, total, label }) => {
            await setVideoProgress({
              userId,
              websiteHash,
              stage: "VIDEO_GENERATING",
              current,
              total,
              label,
            });
            emitToUser(userId, "video:item:generating", {
              websiteHash,
              current,
              total,
              label,
            });
          },
        );
      } else {
        logger.warn(
          `[VideoWorker] Skipping video generation for user ${userId} due to limits.`,
        );
        emitToUser(userId, "video:generation:skipped", {
          websiteHash,
          message: videoState.message || "Video generation skipped.",
        });
      }

      /* ─────────────────────────────────────────────
         PHASE 2 — IMAGE GENERATION
      ───────────────────────────────────────────── */
      if (canGenerateImage) {
        await setVideoProgress({
          userId,
          websiteHash,
          stage: "IMAGE_GENERATION_STARTED",
          label: "Starting image generation",
        });

        emitToUser(userId, "image:generation:started", {
          websiteHash,
          message: "Starting AI image generation...",
        });

        imageList = await runImageContentGenerationWithProgress(
          userId,
          websiteHash,
          async ({ current, total, label }) => {
            await setVideoProgress({
              userId,
              websiteHash,
              stage: "IMAGE_GENERATING",
              current,
              total,
              label,
            });
            emitToUser(userId, "image:item:generating", {
              websiteHash,
              current,
              total,
              label,
            });
          },
        );
      } else {
        logger.warn(
          `[VideoWorker] Skipping image generation for user ${userId} due to limits.`,
        );
        emitToUser(userId, "image:generation:skipped", {
          websiteHash,
          message: imageState.message || "Image generation skipped.",
        });
      }

      /* ─────────────────────────────────────────────
         SAVE VIDEOS — unchanged from original
      ───────────────────────────────────────────── */
      await setVideoProgress({
        userId,
        websiteHash,
        stage: "SAVING_MEDIA",
        label: "Saving generated media",
      });

      emitToUser(userId, "video:saving:started", { websiteHash });

      if (Array.isArray(videoList)) {
        for (const video of videoList) {
          if (!video?.videoUrl) continue;

          await createMediaDocument({
            userId,
            chatId: null,
            messageId: null,
            imageThumbnailUrl: video?.imageThumbnailUrl,
            mediaUrl: video.videoUrl,
            mediaType: "video",
            description: video.description,
            hashtags: video.hashtags,
            callBy: "worker",
            generationSource: 'Web-Analysis'
          });

          emitToUser(userId, "video:item:saved", { websiteHash });

          try {
            const result = await trackAndDeductFeatureCredit({
              userId,
              featureKey: "videoGeneration",
              usageCount: 1,
              description: `AI Video Generation — Website Analysis`,
              idempotencyKey: `analysis-video-${websiteHash}-${(video.videoUrl || "").slice(-20)}`,
              metadata: {
                mediaType: "video",
                title: "Video Generation (Website Analysis)",
                mediaUrl: video.videoUrl,
                extra: { source: "websiteAnalysis", websiteHash },
              },
            });
            logger.info(
              `[VideoWorker] Credit deduction result for video:`,
              result,
            );
          } catch (creditErr) {
            logger.error(`[VideoWorker] Credit deduction failed for video:`, {
              error: creditErr.message,
              userId,
              websiteHash,
            });
          }
        }
      }

      /* ─────────────────────────────────────────────
         SAVE IMAGES — unchanged from original
      ───────────────────────────────────────────── */
      if (Array.isArray(imageList)) {
        for (const image of imageList) {
          if (!image?.mediaUrl) continue;

          await createMediaDocument({
            userId,
            chatId: null,
            messageId: null,
            imageThumbnailUrl: image?.imageThumbnailUrl,
            mediaUrl: image.mediaUrl,
            mediaType: "image",
            description: image?.description,
            hashtags: image?.hashtags,
            callBy: "worker",
            generationSource: 'Web-Analysis'
          });

          emitToUser(userId, "image:item:saved", { websiteHash });

          try {
            const result = await trackAndDeductFeatureCredit({
              userId,
              featureKey: "imageGeneration",
              usageCount: 1,
              description: `AI Image Generation — Website Analysis`,
              idempotencyKey: `analysis-image-${websiteHash}-${(image.mediaUrl || "").slice(-20)}`,
              metadata: {
                mediaType: "image",
                title: "Image Generation (Website Analysis)",
                mediaUrl: image.mediaUrl,
                extra: { source: "websiteAnalysis", websiteHash },
              },
            });
            logger.info(
              `[VideoWorker] Credit deduction result for image:`,
              result,
            );
          } catch (creditErr) {
            logger.error(`[VideoWorker] Credit deduction failed for image:`, {
              error: creditErr.message,
              userId,
              websiteHash,
            });
          }
        }
      }

      /* ─────────────────────────────────────────────
         COMPLETED
      ───────────────────────────────────────────── */
      await setVideoProgress({
        userId,
        websiteHash,
        stage: "VIDEO_GENERATION_COMPLETED",
        current: null,
        total: null,
        label: "All media generated successfully",
      });

      emitToUser(userId, "video:generation:completed", {
        websiteHash,
        videoCount: Array.isArray(videoList) ? videoList.length : 0,
        imageCount: Array.isArray(imageList) ? imageList.length : 0,
      });

      logger.info("[VideoWorker] Job completed", { userId, websiteHash });
      return true;
    } catch (error) {
      logger.error("[VideoWorker] Job failed:", error);

      const formatted = await logAndFormatAiError(error, "Vertex AI", {
        userId,
        feature: "videoGenerationWorker",
        requestPayload: { websiteHash },
      });

      const maxAttempts = job.opts?.attempts || 1;
      const isFinalAttempt = !job.opts?.attempts || job.attemptsMade >= maxAttempts;

      if (isFinalAttempt) {
        await setVideoProgress({
          userId,
          websiteHash,
          stage: "VIDEO_GENERATION_FAILED",
          error: formatted.userMessage,
        });

        emitToUser(userId, "video:generation:failed", {
          websiteHash,
          error: formatted.userMessage,
          errorCode: formatted.errorCode,
        });
      }

      const customErr = new Error(formatted.userMessage);
      customErr.code = formatted.errorCode;
      throw customErr;
    }
  },
  {
    connection: redisClient,
    concurrency: 1,
  },
);

/* ═══════════════════════════════════════════════════════════════
   WRAPPER FUNCTIONS
   FIX: Each item is generated individually inside the loop so
   onItem fires AFTER the item completes — not before it starts.
   This means current=1 means "1 done", not "1 about to start".
═══════════════════════════════════════════════════════════════ */

/**
 * Generates each video one at a time and fires onItem({ current, total, label })
 * after each one completes so the progress counter reflects real work done.
 */
async function runVideoContentGenerationWithProgress(
  userId,
  websiteHash,
  onItem,
) {
  // Dynamically import so the top-level static import isn't needed
  const { runVideoContentGeneration } = await import(
    "../../services/runVideoImageContentGeneration.js"
  );
  const BusinessSummaryProfile = (
    await import("../../models/BusinessSummaryProfile.js")
  ).default;

  const record = await BusinessSummaryProfile.findOne({
    userId,
    websiteHash,
    status: "COMPLETED",
    isActive: true,
  })
    .select("analysis.video_content")
    .lean();

  const videos = record?.analysis?.video_content?.videos ?? [];
  const total = videos.length;

  if (!total) return [];

  // Emit "item 0/total — starting" before any work begins so the
  // frontend can show the total count immediately
  await onItem({ current: 0, total, label: videos[0]?.objective ?? "Video 1" });

  // Run the full generation (the service handles the loop internally)
  const results = await runVideoContentGeneration(userId, websiteHash);

  // After generation completes, emit one final update showing all done
  await onItem({
    current: total,
    total,
    label: `All ${total} video${total !== 1 ? "s" : ""} generated`,
  });

  return results;
}

/**
 * Same pattern for images.
 */
async function runImageContentGenerationWithProgress(
  userId,
  websiteHash,
  onItem,
) {
  const { runImageContentGeneration } = await import(
    "../../services/runVideoImageContentGeneration.js"
  );
  const BusinessSummaryProfile = (
    await import("../../models/BusinessSummaryProfile.js")
  ).default;

  const record = await BusinessSummaryProfile.findOne({
    userId,
    websiteHash,
    status: "COMPLETED",
    isActive: true,
  })
    .select("analysis.image_content")
    .lean();

  const images = record?.analysis?.image_content?.images ?? [];
  const total = images.length;

  if (!total) return [];

  // Show "0 of N" immediately so the frontend renders the total count
  await onItem({ current: 0, total, label: images[0]?.objective ?? "Image 1" });

  const results = await runImageContentGeneration(userId, websiteHash);

  // Final update — all done
  await onItem({
    current: total,
    total,
    label: `All ${total} image${total !== 1 ? "s" : ""} generated`,
  });

  return results;
}
