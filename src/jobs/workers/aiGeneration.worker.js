import { Worker } from "bullmq";
import Message from "../../models/Message.js";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import socketService from "../../socket.js";
import axios from "axios";

import {
  createStaticLogo,
  generateChatGPT,
  generateImage,
  generateNanoBanana,
  generateOvelay,
  generatePrompt,
  generateVideo,
  overlayLogoOnImage,
  processBusinessBranding,
} from "../../services/aiService.js";

// ✅ NEW IMPORT — long-form pipeline (only used when duration > 8s)
import { extractLastFrameAsBase64, generateLongFormVideo } from "../../services/longFormVideoService.js";

import { uploadBase64ToS3, uploadBase64VideoToS3 } from "../../utils/uploadBase64ToS3.js";
import { createMediaDocument } from "../../controllers/SocialMedia/MediaStoreController.js";
import { describeCharacterWithClaude } from "../../utils/describeCharacterWithClaude.js";
import { enhancePromptCinematically } from "../../utils/cinematicPromptEnhancer.js";
import { addLogoOutroToVideo } from "../../utils/addLogoOutroToVideo.js";

import {
  trackAndDeductFeatureCredit,
  checkBulkFeatureCapacity,
  deductDynamicCredit,
} from "../../utils/creditTracker.js";
import { calculateDynamicVideoCost } from "../../utils/videoPricingCalculate.js";
import AISetting from "../../models/AISetting.js";
import { compositeLogoOnFirstFrame } from "../../utils/imageCompositor.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import { createAndSchedulePost } from "../../controllers/socialGrowth.controller.js";
import { stripCrMetadata } from "../../utils/stripCrMetadata.js";
import { generatePromptAttachmentVideo } from "../../controllers/pixverseVideoController.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";
import userModel from "../../models/userModel.js";
import config from "../../config/config.js";
import GeneratedGrowthPlan from "../../models/GeneratedGrowthPlan.js";

/* -----------------------------
SOCKET EMIT
----------------------------- */

function emit(chatId, event, payload) {
  const data = {
    chatId,
    ...payload,
  };

  if (chatId) {
    socketService.emitToChat(chatId, event, data);
  }
  if (payload?.userId) {
    socketService.emitToUser(payload.userId, event, data);
  }

  const userId = payload?.userId;
  if (userId) {
    const message = JSON.stringify({
      userId,
      event,
      data,
    });
    redisClient.publish("socket:user", message).catch((err) => {
      console.error("Redis publish error:", err);
    });
  }
}

/* -----------------------------
AI GENERATION WORKER
----------------------------- */
async function callGeminiWithRetry(fn, retries = 4) {
  let attempt = 0;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      const is429 =
        err?.message?.includes("429") ||
        err?.message?.includes("RESOURCE_EXHAUSTED");

      if (!is429) throw err;

      const delay = Math.pow(2, attempt) * 1500; // 1.5s, 3s, 6s, 12s

      console.warn(
        `⚠️ Gemini 429 hit. Retry ${attempt + 1}/${retries} in ${delay}ms`,
      );

      await new Promise((res) => setTimeout(res, delay));

      attempt++;
    }
  }

  throw new Error("Gemini retry limit exceeded");
}
new Worker(
  "ai-generation-queue",
  async (job) => {
    let {
      userId,
      chatId,
      messageId,
      generationType,
      prompt,
      attachmentPath = [],
      ContentHashtagsRes,
      generationParams = {},
      contactLines = [],
      scheduling,
      isBusiness,
      isApprovalSkipped = false,
      generationSource = ''
    } = job.data;

    try {
      const featureKey =
        generationType === "video" ? "videoGeneration" : "imageGeneration";

      /* -----------------------------
         CREDIT CHECK
      ----------------------------- */
      let dynamicVideoCost = 0;
      let activeVideoModel = "veo";
      let videoCostDetails = null;

      if (generationType === "video") {
        const setting = await AISetting.findOne({ key: "activeVideoModel" });
        activeVideoModel = generationParams?.engine || setting?.value || "veo";
        const requestedDuration = parseInt(generationParams?.duration) || 8;
        const quality = generationParams?.quality || "720p";

        videoCostDetails = await calculateDynamicVideoCost(activeVideoModel, quality, requestedDuration);
        dynamicVideoCost = videoCostDetails.credits;

        // Ensure user has enough before proceeding (Dry run effectively)
        // We do a manual check or let checkBulkFeatureCapacity check if we can pass a cost? 
        // We will just do a standard check for free limit if it's 1 credit, but wait, video isn't free anymore if it's dynamic.
        // Actually, let's still use checkBulkFeatureCapacity but pass dynamic requiredCount. Wait, checkBulkFeatureCapacity multiplies requiredCount by ServiceCost!
        // To be safe, we just check if they have enough balance in eligibleWallets.
        // Or we can rely on `deductDynamicCredit` which throws if insufficient.
        // However, we want to deduct AFTER generation. So let's pre-check balance.
        const { CreditBalance } = await import("../../models/credits/index.js");
        const eligibleWallets = await CreditBalance.find({
          userId,
          isActive: true,
          validUntil: { $gt: new Date() },
          balance: { $gte: dynamicVideoCost },
        });

        if (!eligibleWallets.length && dynamicVideoCost > 0) {
          throw new Error(`Insufficient credits. This video costs ${dynamicVideoCost} credits. Please upgrade your plan.`);
        }
      } else {
        const analysisCheck = await checkBulkFeatureCapacity({
          userId,
          featureKey,
          requiredCount: 1,
          metadata: { source: "normalPrompt" },
        });

        if (!analysisCheck.canAfford) {
          throw new Error(analysisCheck.message);
        }
      }
      if (scheduling?.enabled) {
        const promptResult = await generatePrompt({
          scene: prompt,
          contentType: generationType,
          userId: userId,
        });
        try {
          await trackAndDeductFeatureCredit({
            userId,
            featureKey:
              generationType === "video" ? "videoPromptGen" : "imagePromptGen",
            usageCount: 1,
            description: `AI ${generationType} prompt generation`,
            idempotencyKey: `prompt-gen-${scheduling?.contentId}`,
            metadata: { source: "scriptPrompt" },
            skipWalletDeduction: false,
          });
        } catch (err) {
          console.error("Free usage increment failed for prompt:", err.message);
        }
        prompt = promptResult?.final_prompt || prompt;
      }

      emit(chatId, "generation:progress", {
        messageId,
        percentage: 10,
        message: "Initializing AI model...",
        userId,
        contentId: scheduling?.contentId,
        planId: scheduling?.planId,
      });

      let mediaUrl;
      let metadata = {};
      let firstFrameUrl = null;
      let usage = {}

      /* -----------------------------
         GENERATE MEDIA
      ----------------------------- */
      let backgroundImage = null;

      let finalFirstFrameBase64 = null;

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      async function callGeminiWithRetry(fn, generationParams) {
        const maxRetries = 3;
        const baseDelay = 4000; // 4 seconds
        let lastError;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            const params =
              attempt >= 2
                ? { ...generationParams, model: "imagen-4-fast" }
                : generationParams;

            return await fn(params);
          } catch (err) {
            lastError = err;

            if (attempt === maxRetries - 1) break;

            // 4s -> 8s -> 16s
            const delay = baseDelay * Math.pow(2, attempt);

            console.log(`Retry ${attempt + 1} in ${delay / 1000}s...`);

            await sleep(delay);
          }
        }

        throw lastError;
      }

      const logoAttachment =
        attachmentPath.length > 0 ? attachmentPath[0].path : [];

      /* ═══════════════════════════════════════════════════════
         VIDEO GENERATION
      ═══════════════════════════════════════════════════════ */
      if (generationType === "video") {
        // ── Shared: parse prompt tags (used by both 8s and long-form paths) ──
        const visualMatch = prompt.match(
          /\[VISUAL\]([\s\S]*?)(?:\[AUDIO\]|$)/i,
        );
        const audioMatch = prompt.match(/\[AUDIO\]([\s\S]*?)$/i);

        let visualPrompt = visualMatch ? visualMatch[1].trim() : prompt;
        const audioPrompt = audioMatch ? audioMatch[1].trim() : "";

        let logoUrl = attachmentPath[0]?.path;

        if (generationParams?.characterImages && generationParams.characterImages.length > 0) {
          try {
            emit(chatId, "generation:progress", {
              messageId,
              percentage: 15,
              message: "Loading character references...",
              userId,
              contentId: scheduling?.contentId,
              planId: scheduling?.planId,
            });

            const response = await axios.get(generationParams.characterImages[0], {
              responseType: "arraybuffer",
            });
            finalFirstFrameBase64 = Buffer.from(response.data).toString("base64");
          } catch (err) {
            console.error("Failed to process character images:", err);
          }
        } else if (generationParams?.characterImage) {
          try {
            const response = await axios.get(generationParams.characterImage, {
              responseType: "arraybuffer",
            });
            finalFirstFrameBase64 = Buffer.from(response.data).toString("base64");
          } catch (err) {
            console.error("Failed to fetch character image from S3:", err);
          }
        }

        // ── Shared: generate brand-composited first frame ────────────────────
        // This first frame is used by BOTH the 8s path (as init_image for Veo/PixVerse)
        // AND the long-form path (as the init_image for scene 1 only).
        // 
        // [User Request]: Skip this part in video generation.
        // if (logoAttachment) {
        //   emit(chatId, "generation:progress", {
        //     messageId,
        //     percentage: 20,
        //     message: "Generating first frame...",
        //   });
        //
        //   // Generate background scene using Imagen 4
        //   const imagenResult = await generateImage(visualPrompt, {
        //     aspect: generationParams?.aspect || "9:16",
        //   });
        //
        //   finalFirstFrameBase64 = imagenResult?.imageBase64;
        //
        //   if (
        //     imagenResult?.success &&
        //     imagenResult?.imageBase64 &&
        //     attachmentPath?.length > 0 &&
        //     isBusiness
        //   ) {
        //     // Save clean background as a thumbnail before logo stamp
        //     firstFrameUrl = await uploadBase64ToS3(imagenResult.imageBase64);
        //
        //     emit(chatId, "generation:progress", {
        //       messageId,
        //       percentage: 40,
        //       message: "Compositing brand assets...",
        //     });
        //
        //     // Stamp the logo onto the generated background
        //     finalFirstFrameBase64 = await compositeLogoOnFirstFrame(
        //       imagenResult.imageBase64,
        //       logoAttachment,
        //     );
        //   }
        // }

        emit(chatId, "generation:progress", {
          messageId,
          percentage: 50,
          message: "Animating scene...",
          userId,
          contentId: scheduling?.contentId,
          planId: scheduling?.planId,
        });

        // Build Veo-compatible prompt (visual + critical instruction FIRST)
        let veoPrompt = visualPrompt;

        const hasUploadedImage = attachmentPath?.length > 0 || !!generationParams?.characterImage;
        if (hasUploadedImage) {
          veoPrompt += "\n\nCRITICAL INSTRUCTION: Use the Face and Body of the subject from the provided image perfectly, but do not use or preserve the background. Generate a new background based on the prompt.";
        }

        // Append audio track at the absolute END to prevent LLM recency bias overriding it
        if (audioPrompt) {
          veoPrompt += `\n\nAudio track: ${audioPrompt}`;
        }

        // Params shared by both paths
        const currentParams = {
          ...generationParams,
          logoUrl: logoUrl,
          contactLines: contactLines,
          enhancePrompt: isApprovalSkipped,
        };

        const requestedDuration = parseInt(generationParams?.duration) || 8;

        /* ────────────────────────────────────────────────────────
           ✅ DURATION BRANCH
           ≤ 8s → existing single-clip flow (UNTOUCHED)
           > 8s → long-form multi-scene pipeline (NEW)
        ──────────────────────────────────────────────────────── */
        if (requestedDuration <= 8 || generationParams?.engine === 'omni-flash') {
          /* ── 8-SECOND FLOW (ENHANCED) ─────────────────────────
             Cinematic prompt structuring + Logo Watermarking
          ──────────────────────────────────────────────────────── */

          let enhancedVeoPrompt = veoPrompt;
          const userHasVoiceover =
            /\[audio\]|voiceover|voice over|voice-over|narration|dialogue|script:|saying:|say\s*[:"']|speak/i.test(
              veoPrompt,
            );

          if (isApprovalSkipped) {
            emit(chatId, "generation:progress", {
              messageId,
              percentage: 55,
              message: "Structuring user prompt...",
              userId,
              contentId: scheduling?.contentId,
              planId: scheduling?.planId,
            });

            // If user did not specify a voiceover, auto-generate smooth voiceover within timeframe via enhancer
            if (!userHasVoiceover) {
              try {
                enhancedVeoPrompt = await enhancePromptCinematically(veoPrompt, userId);
              } catch (e) {
                logger.warn("[Worker] Auto-voiceover enhancement fallback:", e.message);
              }
            }
            enhancedVeoPrompt +=
              "\n\nMOTION & PHYSICS INSTRUCTION: Enforce ultra-realistic physics, natural gravity, and correct anatomical movement. The subject must move realistically with forward momentum, proper foot contact, and realistic weight. No sliding, floating, or backward motion. Render in cinematic quality with depth.";
          } else {
            emit(chatId, "generation:progress", {
              messageId,
              percentage: 55,
              message: "Enhancing prompt cinematically...",
              userId,
              contentId: scheduling?.contentId,
              planId: scheduling?.planId,
            });
            enhancedVeoPrompt = await enhancePromptCinematically(veoPrompt, userId);
          }

          let result = await generateVideo(
            enhancedVeoPrompt,
            userId,
            finalFirstFrameBase64,
            currentParams,
            chatId,
            messageId,
            false,
            isBusiness
          );

          console.log("generatePromptAttachmentVideo - result", result);

          let finalMediaUrl = result.videoUrl;

          mediaUrl = finalMediaUrl;
          metadata = result.metadata || {};
          usage = result?.usage || {}
        } else {
          /* ── LONG-FORM FLOW (duration > 8s) ─────────────────────
             Orchestrates: storyboard → sequential clips →
             last-frame continuity → FFmpeg stitch → S3 upload.
             The existing generateVideo() is called internally
             for each individual scene clip.
          ──────────────────────────────────────────────────────── */
          logger.info(
            `[Worker] Long-form video requested: ${requestedDuration}s for user ${userId}`,
          );

          const longFormResult = await generateLongFormVideo({
            prompt: veoPrompt,
            userId,
            firstFrameBase64: finalFirstFrameBase64, // Brand-composited first frame for scene 1
            params: currentParams,
            chatId,
            messageId,
            totalDuration: requestedDuration,
            contactLines,
            logoUrl,
            clipDuration: videoCostDetails.clipDuration,
            sceneCount: videoCostDetails.chunks,
            finalCostPerChunk: videoCostDetails.finalCostPerChunk,
            activeVideoModel,
            isApprovalSkipped,
            isBusiness,
            hasUploadedImage,
          });

          // /*
          // let currentInitFrame;
          //
          // if (longFormResult?.videoUrl) {
          //   try {
          //     currentInitFrame = await extractLastFrameAsBase64(
          //       longFormResult?.videoUrl,
          //     );
          //
          //     logger.info(`[LongForm] Last frame extracted for scene`);
          //   } catch (frameErr) {
          //     logger.warn(
          //       `[LongForm] Last-frame extraction failed for scene: ${frameErr.message}. Next scene will use no init frame.`,
          //     );
          //
          //     currentInitFrame = null;
          //   }
          // }
          // */

          console.log("generateLongFormVideo - result", longFormResult);

          mediaUrl = longFormResult?.videoUrl;
          metadata = longFormResult.metadata || {};
        }
      } else {
        /* ═══════════════════════════════════════════════════════
           IMAGE GENERATION
           (completely unchanged from original)
        ═══════════════════════════════════════════════════════ */

        let logoUrl = null;
        if (isBusiness && (attachmentPath.length === 0 || !attachmentPath[0].path)) {
          logoUrl = await processBusinessBranding(userId);
          attachmentPath.push({ path: logoUrl });
        }

        let result;
        if (generationParams?.engine && generationParams?.engine === 'nano-banana-2') {
          result = await callGeminiWithRetry(
            (params) =>
              generateNanoBanana(prompt, params, userId, attachmentPath, isApprovalSkipped),
            generationParams,
          );

        }
        else {
          result = await generateChatGPT(prompt, generationParams, userId, attachmentPath, isApprovalSkipped)
        }

        if (!result?.imageBase64) {
          console.error(
            "Image generation returned no image",
            result
          );

          const actualErrorMsg =
            result?.error ||
            result?.message ||
            result?.userMessage ||
            "Unable to generate an image for this request. Please provide a more detailed description and try again.";

          throw new Error(actualErrorMsg);
        }
        backgroundImage = await uploadBase64ToS3(result.imageBase64, config.AWS_S3_GENERATE_ORIGINAL_FOLDER);
        console.log("backgroundImage generated", backgroundImage);
        emit(chatId, "generation:progress", {
          messageId,
          percentage: 60,
          message: "Generating Layout...",
          userId,
          contentId: scheduling?.contentId,
          planId: scheduling?.planId,
        });
        let attchLogoFinal = result.imageBase64;
        try {
          if (attachmentPath?.length > 0 && isBusiness && result?.logoSkipped && !isApprovalSkipped) {
            attchLogoFinal = await overlayLogoOnImage(result.imageBase64, attachmentPath, messageId, generationParams,)
          }
        } catch (err) {
          logger.error("Error during logo overlay:", err);
          attchLogoFinal = result.imageBase64; // Fallback to original image if overlay fails
        }

        // if (attachmentPath?.length > 0) {
        //   const logoAttachment = attachmentPath[0].path;

        //   // finalFirstFrameBase64 = await compositeLogoOnFirstFrame(
        //   //   result.imageBase64,
        //   //   logoAttachment
        //   // );


        // }
        // const brandData = await BusinessSummaryProfile.findOne({ userId }).lean()
        // const brandProfile = {
        //   aiInsights: {
        //     summary: brandData?.analysisSummary
        //   },
        //   company: {
        //     name: brandData?.analysis?.business_overview?.brand_name,
        //     logo: brandData?.analysis?.branding_guidelines?.logo_url
        //   },
        //   visualIdentity: {
        //     designStyle: brandData?.analysis?.branding_guidelines?.visual_style,
        //     colors: brandData?.analysis?.branding_guidelines?.brand_colors
        //   },

        // }

        // const userPrompt = await Message.findOne({ chat: chatId, user: userId, role: 'user' }).lean()

        // // const finalFirstFrameBase64 = result.imageBase64 
        //  const finalFirstFrameBase64 = await generateOvelay({ brandProfile, backgroundImage, scene: prompt, userPrompt: userPrompt?.content, })

        // STACK THE STRIPPER HERE to ensure the overlay didn't add it back
        const finalCleanBuffer = await stripCrMetadata(attchLogoFinal, 'image');
        const finalCleanBase64 = finalCleanBuffer.toString('base64');

        mediaUrl = await uploadBase64ToS3(finalCleanBase64, config.AWS_S3_GENERATE_WITH_LOGO_FOLDER);
        metadata = {
          mimeType: result.mimeType || "image/jpeg",
        };

        usage = result?.usage || {}
      }

      /* -----------------------------
         UPDATE MESSAGE
      ----------------------------- */
      let updatedMessage;
      if (scheduling?.enabled) {
        updatedMessage = {
          _id: scheduling?.contentId,
        };

        if (scheduling.planId && scheduling.contentId) {
          await GeneratedGrowthPlan.findOneAndUpdate(
            { planId: scheduling.planId, "days.contents._id": scheduling.contentId },
            {
              $set: {
                "days.$[day].contents.$[content].mediaUrl": mediaUrl,
                "days.$[day].contents.$[content].status": "completed"
              }
            },
            { arrayFilters: [{ "day.contents._id": scheduling.contentId }, { "content._id": scheduling.contentId }] }
          );
        }
      } else {
        updatedMessage = await Message.findByIdAndUpdate(
          messageId,
          {
            mediaUrl,
            mediaType: generationType,
            mediaMetadata: metadata,
            tokens: usage,
            generationStatus: "completed",
            content: isApprovalSkipped
              ? `${generationType === "video" ? "Video" : "Image"} generated successfully using the user prompt.`
              : `${generationType === "video" ? "Video" : "Image"} generated successfully using the approved prompt.`
          },
          { new: true },
        );
      }

      // Emitted at the very end now.

      /* -----------------------------
         CREDIT DEDUCTION
      ----------------------------- */
      if (generationType === "video") {
        let actualCostToDeduct = dynamicVideoCost;
        const requestedDuration = parseInt(generationParams?.duration) || 8;

        // If long-form, recalculate cost based on actual chunks generated successfully
        if (requestedDuration > 8 && metadata?.clipUrls) {
          const generatedScenes = metadata.clipUrls.length;
          actualCostToDeduct = generatedScenes * videoCostDetails.finalCostPerChunk;
          logger.info(`[Worker] Long-form video cost recalculated: requested ${videoCostDetails.chunks} chunks, actual ${generatedScenes} chunks. Final cost: ${actualCostToDeduct}`);
        }

        if (actualCostToDeduct > 0) {
          await deductDynamicCredit({
            userId,
            creditAmount: actualCostToDeduct,
            serviceName: `${activeVideoModel}VideoGeneration`,
            description: `AI Video Generation (${activeVideoModel})`,
            idempotencyKey: `ai-${featureKey}-gen-${updatedMessage._id}`,
            metadata: {
              referenceId: updatedMessage._id,
              referenceModel: "Message",
              mediaType: generationType,
              prompt: prompt || null,
              mediaUrl: mediaUrl || null,
              source: "normalPrompt",
            },
          });
        }
      } else if (generationType === "image") {
        if (generationParams?.engine === 'gpt-image-2' && usage?.chargeableCost?.inr) {
          await deductDynamicCredit({
            userId,
            featureKey,
            serviceName: "Image Generation",
            creditAmount: usage?.chargeableCost?.inr,
            usageCount: 1,
            referenceId: updatedMessage._id,
            referenceModel: "Message",
            description: `AI Image Generation`,
            idempotencyKey: `ai-${featureKey}-gen-${updatedMessage._id}`,
            metadata: {
              referenceId: updatedMessage._id,
              referenceModel: "Message",
              mediaType: generationType,
              prompt: prompt || null,
              mediaUrl: mediaUrl || null,
              source: "normalPrompt",
            },
          });
        }
        else {
          await trackAndDeductFeatureCredit({
            userId,
            featureKey,
            usageCount: 1,
            referenceId: updatedMessage._id,
            referenceModel: "Message",
            description: `AI Image Generation`,
            idempotencyKey: `ai-${featureKey}-gen-${updatedMessage._id}`,
            metadata: {
              referenceId: updatedMessage._id,
              referenceModel: "Message",
              mediaType: generationType,
              prompt: prompt || null,
              mediaUrl: mediaUrl || null,
              source: "normalPrompt",
            },
          });

        }

      }

      /* -----------------------------
         MEDIA STORE
      ----------------------------- */
      const media = await createMediaDocument({
        userId,
        chatId,
        messageId,
        imageThumbnailUrl: firstFrameUrl || backgroundImage,
        mediaUrl,
        mediaType: generationType,
        description: ContentHashtagsRes?.description,
        hashtags: ContentHashtagsRes?.hashtags,
        callBy: "worker",
        generationSource
      });

      emit(chatId, "generation:progress", {
        messageId,
        percentage: 100,
        message: "Generation completed!",
        userId,
        contentId: scheduling?.contentId,
        planId: scheduling?.planId,
      });

      emit(chatId, "generation:complete", {
        messageId,
        message: updatedMessage,
        userId,
        contentId: scheduling?.contentId,
        planId: scheduling?.planId,
        mediaUrl: mediaUrl,
        status: "completed"
      });

      /* -----------------------------
      OPTIONAL: SCHEDULING TRIGGER
      ----------------------------- */
      if (scheduling?.enabled) {
        try {
          await createAndSchedulePost({
            contendId: scheduling?.contentId,
            mediaRes: media,
            scheduledDay: scheduling.scheduledDay,
            postingTimes: scheduling.postingTimes,
            planId: scheduling?.planId,
            contentType: generationType,
            platformData: ContentHashtagsRes?.platformData || {},
          });
        } catch (err) {
          logger.error("Post scheduling failed:", err);
        }
      }

      return true;
    } catch (error) {
      logger.error("AI generation failed:", error);

      const formatted = await logAndFormatAiError(error, "AI Worker", {
        userId,
        feature: "aiGenerationWorker",
        chatId,
        messageId,
      });

      let finalErrorMessage = formatted?.userMessage || error.message;
      let shouldThrowForInternalRetry = true;

      // Intercept Veo Safety blocks or No-Video errors
      if (
        finalErrorMessage.includes("Vertex AI's usage guidelines") ||
        finalErrorMessage.includes("Veo completed but returned no video")
      ) {
        shouldThrowForInternalRetry = false; // Stop BullMQ internal retry

        // Fetch current retry state for this specific message
        const currentMsg = await Message.findById(messageId).select("veoRetryCount");
        const currentCount = currentMsg?.veoRetryCount || 0;

        if (currentCount >= 1) {
          // On 2nd retry, display high traffic message
          finalErrorMessage = "Come back later, we are facing high traffic at the moment.";
        } else {
          // On 1st failure, increment count
          await Message.findByIdAndUpdate(messageId, { $inc: { veoRetryCount: 1 } });
          finalErrorMessage = "Vertex AI blocked the generation. Please try again or rephrase your prompt.";
        }
      }

      const maxAttempts = job.opts?.attempts || 1;

      if (job.attemptsMade < maxAttempts - 1) {
        logger.info(`Retrying job (Attempt ${job.attemptsMade + 1} of ${maxAttempts})...`);
        throw error;
      }

      if (messageId) {
        await Message.findByIdAndUpdate(messageId, {
          generationStatus: "failed",
          generationError: finalErrorMessage,
        });
      }

      emit(chatId, "generation:failed", {
        messageId,
        error: finalErrorMessage,
        userId,
        contentId: scheduling?.contentId,
        planId: scheduling?.planId,
        status: "failed"
      });

      if (scheduling?.planId && scheduling?.contentId) {
        await GeneratedGrowthPlan.findOneAndUpdate(
          { planId: scheduling.planId, "days.contents._id": scheduling.contentId },
          { $set: { "days.$[day].contents.$[content].status": "failed" } },
          { arrayFilters: [{ "day.contents._id": scheduling.contentId }, { "content._id": scheduling.contentId }] }
        );
      }

      if (shouldThrowForInternalRetry) {
        throw error;
      } else {
        return false; // Tells BullMQ the job is handled, preventing retries
      }
    }
  },
  {
    connection: redisClient,
    concurrency: 2,
  },
);
