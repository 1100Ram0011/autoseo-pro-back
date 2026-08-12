import { Worker } from "bullmq";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";
import redisClient from "../../config/redis.js";

import logger from "../../config/logger.js";

import SocialPost from "../../models/SocialPost.js";

import YoutubeModal from "../../models/YoutubeModal.js";

import { google } from "googleapis";

import axios from "axios";

import fs from "fs-extra";

import path from "path";

import os from "os";
import { decrypt, encrypt } from "../../utils/crypto.js";
import config from "../../config/config.js";
import mongoose from "mongoose";

export const youtubeWorker = new Worker(

  "youtube-post-queue",

  async (job) => {

    const {

      socialPostId,

      userId,

      accountId,

      mediaUrl,

      title = "Upload",

      description = "",

      privacyStatus = "public",
      _legacy = true,
      postIndex = null,

    } = job.data;

    logger.info("🎬 YouTube job START", { jobId: job.id });

    /* -----------------------------

       MARK PROCESSING

    ----------------------------- */

    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
            "platforms.$[p].result.error": null,
          },
        },
        { arrayFilters: [{ "p.platform": "youtube", "p.accountId": accountId }] }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PROCESSING",
            [`posts.${postIndex}.error`]: null,
          },
        }
      );
    }

    /* -----------------------------

       GET CONNECTED YOUTUBE ACCOUNT

    ----------------------------- */

    const ytAcc = await YoutubeModal.findOne({
      userId,
      $or: [
        { channelId: accountId },
        { _id: mongoose.isValidObjectId(accountId) ? accountId : null },
      ],
    });

    if (!ytAcc) {

      throw new Error("YouTube account not connected.");

    }

    /* -----------------------------

       DOWNLOAD VIDEO TEMPORARILY

    ----------------------------- */

    const tempFilePath = path.join(

      os.tmpdir(),

      `yt-${Date.now()}-${Math.random()}.mp4`

    );

    const response = await axios({
      method: "GET",
      url: mediaUrl,
      responseType: "stream",
      maxBodyLength: Infinity,
    });

    await new Promise((resolve, reject) => {

      const stream = fs.createWriteStream(tempFilePath);
      response.data.pipe(stream);
      stream.on("finish", resolve);
      stream.on("error", reject);
    });

    /* -----------------------------
       SETUP OAUTH CLIENT
    ----------------------------- */

    const oauth2Client = new google.auth.OAuth2(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
    );

    const accessToken = decrypt(ytAcc.accessToken);
    const refreshToken = decrypt(ytAcc.refreshToken);

    oauth2Client.setCredentials({

      access_token: accessToken,

      refresh_token: refreshToken,

      expiry_date: ytAcc.tokenExpiry || ytAcc.expiryDate

    });
    await oauth2Client.getAccessToken();
    /* -----------------------------

       AUTO TOKEN REFRESH HANDLER

    ----------------------------- */

    oauth2Client.on("tokens", async (tokens) => {
      const updateData = {};

      if (tokens.access_token) {
        updateData.accessToken = encrypt(tokens.access_token);
      }

      if (tokens.refresh_token) {
        updateData.refreshToken = encrypt(tokens.refresh_token);
      }

      if (tokens.expiry_date) {
        updateData.expiryDate = tokens.expiry_date;
      }

      if (Object.keys(updateData).length > 0) {
        await YoutubeModal.updateOne(
          { _id: ytAcc._id },
          { $set: updateData }
        );
      }
    });

    const youtube = google.youtube({

      version: "v3",

      auth: oauth2Client,

    });

    /* -----------------------------

       UPLOAD VIDEO (RESUMABLE)

       Cost: 1600 quota units

    ----------------------------- */

    const uploadResponse = await youtube.videos.insert({

      part: ["snippet", "status"],

      requestBody: {

        snippet: {

          title,

          description,

          categoryId: "22",

        },

        status: {

          privacyStatus,

        },

      },

      media: {

        body: fs.createReadStream(tempFilePath),

      },

    });

    const videoId = uploadResponse.data.id;

    if (job.data.thumbnailUrl) {
      try {
        const thumbPath = path.join(os.tmpdir(), `thumb-${Date.now()}-${Math.random()}.jpg`);
        const thumbRes = await axios({ method: "GET", url: job.data.thumbnailUrl, responseType: "stream" });
        await new Promise((resolve, reject) => {
          const stream = fs.createWriteStream(thumbPath);
          thumbRes.data.pipe(stream);
          stream.on("finish", resolve);
          stream.on("error", reject);
        });
        await youtube.thumbnails.set({
          videoId,
          media: { body: fs.createReadStream(thumbPath) }
        });
        await fs.remove(thumbPath);
      } catch (thumbErr) {
        logger.warn("Failed to set custom thumbnail for YouTube upload", { videoId, error: thumbErr.message });
      }
    }

    /* -----------------------------

       CLEANUP TEMP FILE

    ----------------------------- */

    await fs.remove(tempFilePath);

    /* -----------------------------

       MARK COMPLETED

    ----------------------------- */

    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PUBLISHED",
            "platforms.$[p].result.externalPostId": videoId,
            "platforms.$[p].result.publishedAt": new Date(),
          },
        },
        { arrayFilters: [{ "p.platform": "youtube", "p.accountId": accountId }] }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: videoId,
            [`posts.${postIndex}.publishedAt`]: new Date(),
          },
        }
      );
    }

    await checkAndFinalizePost(socialPostId);

    logger.info("✅ YouTube upload success", { videoId });

    await checkAndFinalizePost(socialPostId);

    return { videoId };

  },

  {

    connection: redisClient,

    concurrency: 2,

  }

);

/* -----------------------------

   FAILURE HANDLER

----------------------------- */

youtubeWorker.on("failed", async (job, err) => {

  logger.error("❌ YouTube job FAILED", {

    jobId: job?.id,

    error: err?.message,

  });

  const d = job?.data;

  if (!d?.socialPostId || !d?.accountId) return;

  if (d._legacy !== false) {
    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          "platforms.$[p].result.status": "FAILED",
          "platforms.$[p].result.error": err?.message,
        },
      },
      { arrayFilters: [{ "p.platform": "youtube", "p.accountId": d.accountId }] }
    );
  } else {
    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          [`posts.${d.postIndex}.status`]: "FAILED",
          [`posts.${d.postIndex}.error`]: err?.message,
        },
      }
    );
  }

  await checkAndFinalizePost(d.socialPostId);
});
