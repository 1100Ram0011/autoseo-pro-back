import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import {
  generatePlatformSpecificCaptions,
  generateSocialPostCaptions,
  generateTextSocialPostCaptions,
  generateCaptionAndTags,
} from "../../services/aiService.js";
import userModel from "../../models/userModel.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import IndividualAnalysisProfile from "../../models/IndividualAnalysisProfile.js";
import SocialMediaAISummary from "../../models/SocialMediaAISummary.js";
import MediaStore from "../../models/MediaStore.js";
import { logAndFormatAiError } from "../../utils/aiErrorHandler.js";
import socketService from "../../socket.js";

const aiCaptionWorker = new Worker(
  "ai-caption-queue",
  async (job) => {
    const {
      type, // "platform", "social", "text", or "ai"
      mediaUrl,
      scene,
      userInput,
      platforms,
      targetAccounts,
      mediaType,
      draftId,
      mediaStoreId,
      userId,
      isTextOnly = false,
      updateMediaStore = false,
    } = job.data;

    try {
      // Validate user profile
      const userData = await userModel.findById(userId);
      if (!userData) {
        throw new Error("User not found");
      }
      const accountType = userData.accountType || "individual";

      // Fetch brand profile
      let brandProfile = null;
      const profileQuery = { $or: [{ userId: userId }, { user: userId }], isActive: true };
      if (accountType === "business") {
        brandProfile = await BusinessSummaryProfile.findOne(profileQuery);
      } else {
        brandProfile = await IndividualAnalysisProfile.findOne(profileQuery);
      }

      // Fetch AI summary profile
      let aiSummaryProfile = null;
      if (!isTextOnly) {
        aiSummaryProfile = await SocialMediaAISummary.findOne({ userId });
      }

      // Execute appropriate generator function
      let data = null;
      if (type === "platform") {
        data = await generatePlatformSpecificCaptions({
          imageUrl: mediaUrl,
          mediaType,
          scene,
          userInput,
          brandProfile,
          userId,
          platforms,
          targetAccounts,
          aiSummaryProfile,
        });
      } else if (type === "social") {
        data = await generateSocialPostCaptions({
          imageUrl: mediaUrl,
          mediaType,
          scene,
          userInput,
          brandProfile,
          userId,
          platforms,
          targetAccounts,
          draftId,
          mediaStoreId,
          aiSummaryProfile,
        });
      } else if (type === "text") {
        data = await generateTextSocialPostCaptions({
          userInput,
          brandProfile,
          userId,
          platforms,
          targetAccounts,
          draftId,
        });
      } else if (type === "ai") {
        data = await generateCaptionAndTags({
          imageUrl: mediaUrl,
          scene,
          userInput,
          brandProfile,
          userId,
        });
      } else {
        throw new Error("Invalid caption generation type");
      }

      // Update MediaStore if needed (like in generate-platform-captions)
      if (updateMediaStore && mediaUrl) {
        try {
          const mediaDoc = await MediaStore.findOne({ mediaUrl: mediaUrl });
          if (mediaDoc) {
            let updatedCaptions = [...(mediaDoc.platformSpecificCaptions || [])];
            
            if (targetAccounts && targetAccounts.length > 0) {
              targetAccounts.forEach((acc) => {
                const plat = acc.platform.toLowerCase();
                const aiData = data[acc.id] || data[plat];
                
                if (aiData) {
                  const newData = { accountId: acc.id, platform: plat, ...aiData };
                  const existingIndex = updatedCaptions.findIndex(c => c.accountId === acc.id);
                  
                  if (existingIndex >= 0) {
                    updatedCaptions[existingIndex] = { ...updatedCaptions[existingIndex], ...newData };
                  } else {
                    updatedCaptions.push(newData);
                  }
                }
              });
            }
            mediaDoc.platformSpecificCaptions = updatedCaptions;
            await mediaDoc.save();
          }
        } catch (dbErr) {
          logger.error("Failed to update MediaStore with platform captions:", dbErr);
        }
      }

      // Return the generated data to the job which will be received by waitUntilFinished
      return data;
    } catch (error) {
      logger.error(`AI Caption Worker Error [${type}]:`, error);

      const formatted = await logAndFormatAiError(error, "Anthropic", {
        userId,
        feature: `aiCaptionWorker:${type}`,
        requestPayload: { type, draftId, mediaStoreId },
      });

      const maxAttempts = job.opts?.attempts || 1;
      const isFinalAttempt = !job.opts?.attempts || job.attemptsMade >= maxAttempts;

      if (isFinalAttempt && userId) {
        socketService.emitToUser(userId, "aiCaption:failed", {
          draftId,
          type,
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
    concurrency: 5,
  }
);

export default aiCaptionWorker;
