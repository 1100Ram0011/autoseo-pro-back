import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import socketService from "../../socket.js";
import axios from "axios";

import LinkedInAccount from "../../models/LinkedinModel.js";
import { decrypt } from "../../utils/crypto.js";
import SocialPost from "../../models/SocialPost.js";
import {
  registerUpload,
  uploadBinary,
  createMediaPost,
  createTextPost,
} from "../../services/linkedin.service.js";
import mongoose from "mongoose";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";
import { getValidLinkedInToken } from "../../controllers/SocialMedia/linkedin.controller.js";

/* ---------------------------------
   SOCKET HELPER
   - Keeps socket usage consistent
   - Easy to replace later if needed
---------------------------------- */
function emitToUser(userId, event, payload) {
  socketService.emitToUser(userId, event, payload);
}

/* ---------------------------------
   LINKEDIN POST WORKER
   Queue name MUST match producer
---------------------------------- */
new Worker(
  "linkedin-post-queue",
  async (job) => {
    const {
      socialPostId,
      userId, // Mongo user id
      accountId, // LinkedIn linkedInId (NOT Mongo _id)
      mediaUrl,
      mediaType, // "image" | "video"
      description,
      hashtags = [],
      _legacy = true,
      postIndex = null,
    } = job.data;

    logger.info("LinkedIn post job started", {
      jobId: job.id,
      accountId,
    });

    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
          },
        },
        {
          arrayFilters: [
            { "p.platform": "linkedin", "p.accountId": accountId },
          ],
        },
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PROCESSING",
          },
        },
      );
    }

    try {
      /* -----------------------------
               SOCKET: POST STARTED
            ----------------------------- */
      // emitToUser(userId, "linkedin:post:started", {
      //     jobId: job.id,
      //     mediaUrl,
      // });

      /* -----------------------------
               FETCH LINKEDIN ACCOUNT
               IMPORTANT:
               - accountId === linkedInId
               - NEVER query by _id here
            ----------------------------- */
      const account = await LinkedInAccount.findOne({
        userId,
        $or: [
          { linkedInId: accountId },
          { _id: mongoose.isValidObjectId(accountId) ? accountId : null },
        ],
      });

      if (!account) {
        throw new Error("LinkedIn account not found for user");
      }

      /* -----------------------------
               DECRYPT ACCESS TOKEN
            ----------------------------- */
      const accessToken = await getValidLinkedInToken(account);

      if (!accessToken) {
        socketService.emitToUser(userId, "linkedin:media:error", {
          socialPostId: socialPostId,
          mediaUrl: mediaUrl,
          status: "FAILED",
        });
        throw new Error("Invalid LinkedIn access token");
      }

      /* -----------------------------
               BUILD POST TEXT
               - LinkedIn formatting safe
            ----------------------------- */
      const text =
        description +
        (hashtags.length
          ? "\n\n" + hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")
          : "");

      let response;

      if (mediaUrl) {
        /* -----------------------------
                   DOWNLOAD MEDIA
                   - LinkedIn does NOT accept URLs
                   - We must upload binary
                ----------------------------- */
        const mediaRes = await axios.get(mediaUrl, {
          responseType: "arraybuffer",
          timeout: 30_000,
        });

        const buffer = Buffer.from(mediaRes.data);
        const mimeType = mediaRes.headers["content-type"];

        if (!mimeType) {
          throw new Error("Unable to detect media MIME type");
        }

        /* -----------------------------
                   REGISTER LINKEDIN UPLOAD
                   - Returns uploadUrl + asset URN
                ----------------------------- */
        const ownerUrn =
          account.accountType === "organization"
            ? account.organizationId
            : `urn:li:person:${account.linkedInId}`;

        const { uploadUrl, asset } = await registerUpload({
          accessToken,
          owner: ownerUrn,
          mediaType,
        });

        if (!uploadUrl || !asset) {
          throw new Error("LinkedIn upload registration failed");
        }

        /* -----------------------------
                   UPLOAD MEDIA BINARY
                ----------------------------- */
        await uploadBinary({
          uploadUrl,
          buffer,
          mimeType,
        });

        /* -----------------------------
                   CREATE LINKEDIN POST
                   - ONE media per post (LinkedIn rule)
                ----------------------------- */

        response = await createMediaPost({
          accessToken,
          owner: ownerUrn,
          text,
          asset,
          mediaType,
        });
      } else {
        /* -----------------------------
                   CREATE LINKEDIN TEXT POST
                ----------------------------- */
        const ownerUrn =
          account.accountType === "organization"
            ? account.organizationId
            : `urn:li:person:${account.linkedInId}`;

        response = await createTextPost({
          accessToken,
          urn: ownerUrn,
          text,
        });
      }

      const newPostId = response?.headers?.["x-restli-id"] || "";

      if (_legacy) {
        await SocialPost.updateOne(
          {
            _id: socialPostId,
            "platforms.platform": "linkedin",
            "platforms.accountId": accountId,
          },
          {
            $set: {
              "platforms.$[p].result.status": "PUBLISHED",
              "platforms.$[p].result.externalPostId": newPostId,
              "platforms.$[p].result.publishedAt": new Date(),
            },
          },
          {
            arrayFilters: [
              { "p.platform": "linkedin", "p.accountId": accountId },
            ],
          },
        );
      } else {
        await SocialPost.updateOne(
          { _id: socialPostId },
          {
            $set: {
              [`posts.${postIndex}.status`]: "PUBLISHED",
              [`posts.${postIndex}.externalPostId`]: newPostId,
              [`posts.${postIndex}.publishedAt`]: new Date(),
            },
          },
        );
      }

      await checkAndFinalizePost(socialPostId);

      /* -----------------------------
               SOCKET: POST COMPLETED
            // ----------------------------- */
      socketService.emitToUser(userId, "linkedin:media:completed", {
        socialPostId: socialPostId,
        mediaUrl: mediaUrl,
        status: "PUBLISHED",
      });

      logger.info("LinkedIn post completed", {
        jobId: job.id,
      });

      return true;
    } catch (error) {
      let errorMessage = error.message;
      if (error.response?.data) {
        const data = error.response.data;
        
        // 1. Try to get the specific input error description first (e.g. "Duplicate post is detected")
        const inputErrorDescription = data.errorDetails?.inputErrors?.[0]?.description;
        
        if (inputErrorDescription) {
          errorMessage = inputErrorDescription;
        } else if (data.message) {
          // 2. Fallback to the general message
          // (e.g. "com.linkedin.content.common.exception.BadRequestResponseException: Content is a duplicate...")
          errorMessage = data.message;
        } else {
          // 3. Fallback to stringified object if structure is totally unknown
          errorMessage = typeof data === "object" ? JSON.stringify(data) : data;
        }
      }

      if (_legacy) {
        await SocialPost.updateOne(
          {
            _id: job.data.socialPostId,
            "platforms.platform": "linkedin",
            "platforms.accountId": accountId,
          },
          {
            $set: {
              "platforms.$.result.status": "FAILED",
              "platforms.$.result.error": errorMessage,
            },
          },
        );
      } else {
        await SocialPost.updateOne(
          { _id: job.data.socialPostId },
          {
            $set: {
              [`posts.${postIndex}.status`]: "FAILED",
              [`posts.${postIndex}.error`]: errorMessage,
            },
          },
        );
      }

      await checkAndFinalizePost(job.data.socialPostId);

      /* -----------------------------
               FAILURE HANDLING
               - Throwing ensures BullMQ retry
            ----------------------------- */
      logger.error("LinkedIn post failed", {
        jobId: job.id,
        error: errorMessage,
      });

      // emitToUser(userId, "linkedin:post:failed", {
      //     jobId: job.id,
      //     mediaUrl,
      //     error: error.message,
      // });

      throw error; // REQUIRED for retry
    }
  },
  {
    connection: redisClient,

    /*
          CRITICAL:
          LinkedIn rate limits aggressively.
          concurrency: 1 ensures:
          - No parallel uploads
          - No post collisions
          - Safe retries
        */
    concurrency: 1,
  },
);
