import { Worker } from "bullmq";
import axios from "axios";
import FaceSwapRequest from "../../models/FaceSwapRequest.js";
import redisClient from "../../config/redis.js";
import pixverseVideoService from "../../utils/pixverseVideoService.js";
import SwapTemplate from "../../models/SwapTemplate.js";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { handleReferralAfterTemplateCreation } from "../../services/referral.service.js";
import { deductDynamicCredit } from "../../utils/creditTracker.js";
import PixversePromptTemplate from "../../models/Pixverse/Pixverseprompttemplate.model.js";
import PixversePromptRequest from "../../models/PixversePromptRequest.js";
import { videoQueue } from "../index.js";
import { trace } from "console";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const uploadImageFromUrl = async (url, apiKey) => {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  return await pixverseVideoService.uploadImage(response.data, apiKey);
};

/**
 * Ensure a SwapTemplate has a PixVerse media ID.
 * If missing, downloads the video from S3 and uploads it to PixVerse,
 * then caches the result on the template document so future jobs skip this step.
 */
const resolveVideoMediaId = async (template, apiKey) => {
  if (template.pixverseVideoMediaId) {
    return String(template.pixverseVideoMediaId);
  }

  console.log(
    `⚠️  Template ${template._id} has no pixverseVideoMediaId — uploading to PixVerse now...`
  );

  if (!template.videoUrl) {
    throw new Error(`Template ${template._id} has no videoUrl to upload to PixVerse`);
  }

  const videoResponse = await axios.get(template.videoUrl, {
    responseType: "arraybuffer",
    timeout: 120000,
    headers: { "User-Agent": "mytekai-server/1.0" },
  });

  const videoBuffer = Buffer.from(videoResponse.data);

  const uploaded = await pixverseVideoService.uploadVideoMedia(
    videoBuffer,
    "video/mp4",
    apiKey,
    `template-${template._id}.mp4`,
  );

  const videoMediaId = String(uploaded.media_id);

  // Cache on the DB document so the next job skips this upload
  await SwapTemplate.findByIdAndUpdate(template._id, {
    pixverseVideoMediaId: videoMediaId,
    pixverseMediaUrl: uploaded.url || null,
  });

  console.log(`✅ Cached pixverseVideoMediaId ${videoMediaId} on template ${template._id}`);
  return videoMediaId;
};

const docToServiceTemplate = (doc) => ({
  id: doc.feedId,
  name: doc.title,
  description: doc.description || "",
  category: doc.category || "prompt",
  prompt: doc.prompt || "",
  negative_prompt: doc.negativePrompt || null,
  duration: doc.durationSeconds,
  model: doc.model || "v5.6",
  fps: doc.fps || 24,
  quality: doc.quality || "720p",
  motion_mode: doc.motionMode || "normal",
  motionType: doc.motionType || "character-animation",
  seed: doc.seed ?? null,
  generate_audio_switch: doc.soundEffectSwitch ?? false,
  sound_effect_content: doc.soundEffectContent || null,
  tags: doc.tags || [],
  icon: doc.icon || null,
  bestFor: doc.bestFor || null,
  previewVideoUrl: doc.videoUrl || null,
  pixverseVideoMediaId: doc.pixverseVideoMediaId || null,
});

// ─── Worker ───────────────────────────────────────────────────────────────────
const worker = new Worker(
  "face-swap-queue",
  async (job) => {
    const {
      requestId,
      paymentMode,
      creditAmount,
      isFaceswap = false,
    } = job.data;

    console.log("🎬 Job Started:", requestId, "| isFaceswap:", isFaceswap);

    // =========================================================================
    // BRANCH A — PROMPT TEMPLATE GENERATION
    // =========================================================================
    if (!isFaceswap) {
      const request = await FaceSwapRequest.findById(requestId);
      if (!request) throw new Error("PromptTemplate request not found");

      if (request.status === "completed") {
        console.log("⚠️ Already processed:", requestId);
        return;
      }

      const template = await PixversePromptTemplate.findById(request.templateId);
      if (!template) throw new Error("PromptTemplate not found");

      const apiKey = process.env.PIXVERSE_API_KEY;

      try {
        request.status = "processing";
        request.attempts = (request.attempts || 0) + 1;
        await request.save();

        console.log("📸 [PromptTemplate] Uploading user image...");
        const imgId = await uploadImageFromUrl(request.faceImageUrl, apiKey);

        request.pixverse = { ...request.pixverse, imgId };
        await request.save();

        console.log("📸 [PromptTemplate] imgId:", imgId);

        const serviceTemplate = docToServiceTemplate(template);

        console.log("🎬 [PromptTemplate] Generating video...", {
          model: serviceTemplate.model,
          duration: serviceTemplate.duration,
          motionType: serviceTemplate.motionType,
        });

        const templateTraceId = await pixverseVideoService?.generateTraceId()

        const videoId = await pixverseVideoService.generateVideoFromImage({
          imgId,
          template: serviceTemplate,
          userInput: request.userInput || {},
          apiKey,
          traceId: templateTraceId
        });

        request.pixverse.videoId = videoId;
        await request.save();

        console.log("🎥 [PromptTemplate] PixVerse videoId:", videoId);

        const pixverseVideoUrl = await pixverseVideoService.pollForResult(videoId, apiKey);

        console.log("✅ [PromptTemplate] PixVerse video ready:", pixverseVideoUrl);

        const finalUrl = await pixverseVideoService.downloadAndUploadToS3(
          pixverseVideoUrl,
          template,
        );

        request.status = "completed";
        request.outputVideoUrl = finalUrl;
        await request.save();

        console.log("🚀 [PromptTemplate] Generation completed:", finalUrl);

        let createdTemplate = null;

        try {
          const generatedVideoResponse = await axios.get(finalUrl, { responseType: "arraybuffer" });
          const generatedBuffer = Buffer.from(generatedVideoResponse.data);

          const contentHash = crypto.createHash("sha256").update(generatedBuffer).digest("hex");

          const existingTemplate = await PixversePromptTemplate.findOne({
            ownerId: request.userId,
            contentHash,
            isDeleted: false,
          });

          if (!existingTemplate) {
            console.log("📦 [PromptTemplate] Uploading generated video to PixVerse...");

            const uploaded = await pixverseVideoService.uploadVideoMedia(
              generatedBuffer,
              "video/mp4",
              apiKey,
              `prompt-created-${uuidv4()}.mp4`,
            );

            createdTemplate = await PixversePromptTemplate.create({
              feedId: String(uploaded.media_id) || `created-${uuidv4()}`,
              ownerId: request.userId,
              videoUrl: finalUrl,
              pixverseVideoMediaId: uploaded?.media_id ? String(uploaded.media_id) : null,
              pixverseMediaUrl: uploaded?.url || null,
              thumbnailUrl: template.thumbnailUrl || null,
              title: "",
              description: "",
              prompt: template.prompt || "",
              negativePrompt: template.negativePrompt || null,
              category: "created",
              model: template.model || "v5.6",
              fps: template.fps || 24,
              quality: template.quality || "720p",
              motionMode: template.motionMode || "normal",
              motionType: template.motionType || "character-animation",
              durationSeconds: template.durationSeconds || null,
              seed: template.seed ?? null,
              soundEffectSwitch: template.soundEffectSwitch ?? false,
              soundEffectContent: template.soundEffectContent || null,
              tags: template.tags || [],
              icon: template.icon || null,
              bestFor: template.bestFor || null,
              parentTemplateId: template._id,
              originTemplateId: template.originTemplateId || template._id,
              lineageDepth: (template.lineageDepth || 0) + 1,
              contentHash,
              isApproved: false,
              isPublic: false,
              isDeleted: false,
              rawPayload: null,
            });

            await videoQueue.add(
              "process-video",
              {
                mp4Url: createdTemplate?.videoUrl,
                sourceId: createdTemplate?._id,
                sourceModel: "PixverseprompttemplateModel",
              },
              { removeOnComplete: true, removeOnFail: false }
            );

            console.log("🧩 [PromptTemplate] Child template created:", createdTemplate._id);

            if (createdTemplate) {
              await handleReferralAfterTemplateCreation({
                createdTemplate,
                request,
                templateOwnerId: template?.ownerId,
                isFaceswap,
              });
            }

            if (paymentMode === "wallet") {
              await deductDynamicCredit({
                userId: request.userId,
                featureKey: request?.templateId,
                usageCount: 1,
                referenceId: requestId,
                creditAmount,
                serviceName: "Prompt Template generation",
                referenceModel: "FaceSwapRequest",
                description: "Prompt Template generation",
                idempotencyKey: `ai-${request?.templateId}-gen-${requestId}`,
                metadata: {
                  referenceId: request,
                  referenceModel: "FaceSwapRequest",
                  mediaType: "video",
                  mediaUrl: finalUrl || null,
                  source: "prompt",
                },
              });
            }
          } else {
            console.log("⚠️ [PromptTemplate] Duplicate detected — skipping template creation");
          }
        } catch (err) {
          console.error("❌ [PromptTemplate] Child template creation failed:", err.message);
        }

        return { success: true, videoUrl: finalUrl };
      } catch (err) {
        console.error("❌ [PromptTemplate] Generation failed:", err.message);
        request.status = "failed";
        request.error = err.message;
        await request.save();
        throw err;
      }
    }

    // =========================================================================
    // BRANCH B — FACESWAP
    // =========================================================================
    else {
      const request = await FaceSwapRequest.findById(requestId);
      if (!request) throw new Error("Request not found");

      if (request.status === "completed") {
        console.log("⚠️ Already processed");
        return;
      }

      const template = await SwapTemplate.findById(request.templateId);
      if (!template) throw new Error("Template not found");

      const apiKey = process.env.PIXVERSE_API_KEY;

      try {
        request.status = "processing";
        request.attempts = (request.attempts || 0) + 1;
        await request.save();

        // ── Step 1: Upload user face image ────────────────────────────────
        const imgId = await uploadImageFromUrl(request.faceImageUrl, apiKey);

        // ── Step 2: Resolve PixVerse media ID (uploads if missing) ────────
        const videoMediaId = await resolveVideoMediaId(template, apiKey);
        const maskTraceId = await pixverseVideoService?.generateTraceId()
        const faceSwapTraceId = await pixverseVideoService?.generateTraceId()
        request.pixverse = {
          ...request.pixverse,
          imgId,
          videoMediaId,
          keyframeId: template.defaultKeyframeId,
          maskTraceId: maskTraceId,
        };
        request.videoGenerationTraceId = faceSwapTraceId
        await request.save();


        // ── Step 3: Get face mask ─────────────────────────────────────────
        const mask = await pixverseVideoService.generateSwapMaskSelection(
          {
            videoMediaId,
            keyframeId: template.defaultKeyframeId,
            traceId: maskTraceId
          },
          apiKey,
        );

        request.pixverse.maskId = mask.mask_id;
        await request.save();

        // ── Step 4: Generate swap ─────────────────────────────────────────
        const swap = await pixverseVideoService.generateSwap(
          {
            videoMediaId,
            keyframeId: template.defaultKeyframeId,
            maskId: mask.mask_id,
            imgId,
            quality: "720p",
            traceId: faceSwapTraceId
          },
          apiKey,
        );

        console.log('swap here', swap)

        const videoId = swap.video_id;
        request.pixverse.videoId = videoId;
        await request.save();

        // ── Step 5: Poll for completion ───────────────────────────────────
        const videoUrl = await pixverseVideoService.pollForResult(videoId, apiKey);

        // ── Step 6: Download + upload to S3 ──────────────────────────────
        const finalUrl = await pixverseVideoService.downloadAndUploadToS3(videoUrl, template);

        request.status = "completed";
        request.outputVideoUrl = finalUrl;
        await request.save();

        console.log("🚀 FaceSwap Completed:", finalUrl);

        // ── Step 7: Create child template (lineage) ───────────────────────
        let createdTemplate = null;

        try {
          const generatedVideoResponse = await axios.get(finalUrl, { responseType: "arraybuffer" });
          const generatedBuffer = Buffer.from(generatedVideoResponse.data);

          const contentHash = crypto.createHash("sha256").update(generatedBuffer).digest("hex");

          let existingTemplate = await SwapTemplate.findOne({
            ownerId: request.userId,
            contentHash,
            isDeleted: false,
          });

          if (!existingTemplate) {
            console.log("📦 Uploading generated video to PixVerse...");

            const uploaded = await pixverseVideoService.uploadVideoMedia(
              generatedBuffer,
              "video/mp4",
              apiKey,
              `created-template-${uuidv4()}.mp4`,
            );

            const parentTemplate = template;

            createdTemplate = await SwapTemplate.create({
              contentHash,
              videoUrl: finalUrl,
              pixverseVideoMediaId: String(uploaded.media_id),
              pixverseMediaUrl: uploaded.url || null,
              title: "",
              description: "",
              category: "created",
              durationSeconds: template.durationSeconds,
              defaultKeyframeId: 1,
              ownerId: request.userId,
              parentTemplateId: parentTemplate?._id || null,
              originTemplateId: parentTemplate?.originTemplateId || parentTemplate?._id,
              lineageDepth: (parentTemplate?.lineageDepth || 0) + 1,
              isUnderReview: false,
              isRejected: false,
              isPublic: false,
            });

            await videoQueue.add(
              "process-video",
              {
                mp4Url: createdTemplate?.videoUrl,
                sourceId: createdTemplate?._id,
                sourceModel: "SwapTemplate",
              },
              { removeOnComplete: true, removeOnFail: false }
            );

            console.log("🧩 New template created:", createdTemplate._id);

            if (createdTemplate) {
              await handleReferralAfterTemplateCreation({
                createdTemplate,
                request,
                templateOwnerId: template?.ownerId,
                isFaceswap,
              });
            }

            if (paymentMode === "wallet") {
              await deductDynamicCredit({
                userId: request.userId,
                featureKey: request?.templateId,
                usageCount: 1,
                referenceId: requestId,
                creditAmount,
                serviceName: "Template generation",
                referenceModel: "FaceSwapRequest",
                description: "Template generation",
                idempotencyKey: `ai-${request?.templateId}-gen-${requestId}`,
                metadata: {
                  referenceId: request,
                  referenceModel: "FaceSwapRequest",
                  mediaType: "video",
                  mediaUrl: finalUrl || null,
                  source: "swap",
                },
              });
            }
          } else {
            console.log("⚠️ Template already exists (deduped)");
          }
        } catch (err) {
          console.error("❌ Failed to create template:", err.message);
        }

        return { success: true, videoUrl: finalUrl };
      } catch (err) {
        console.error("❌ FaceSwap Failed:", err.message);
        request.status = "failed";
        request.error = err.message;
        await request.save();
        throw err;
      }
    }
  },
  {
    connection: redisClient,
    concurrency: 2,
  },
);

worker.on("completed", (job) => console.log(`✅ Job completed: ${job.id}`));
worker.on("failed", (job, err) => console.error(`❌ Job failed: ${job.id}`, err.message));

export default worker;