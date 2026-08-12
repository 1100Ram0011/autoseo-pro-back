import { Worker } from "bullmq";
import axios from "axios";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import SocialPost from "../../models/SocialPost.js";
import { decrypt, encrypt } from "../../utils/crypto.js";
import PinterestAccount from "../../models/PinterestModal.js"
import config from "../../config/config.js";
import mongoose from "mongoose";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";

// const PINTEREST_API_BASE = "https://api.pinterest.com/v5";

const PINTEREST_API_BASE = process.env.PINTEREST_ENV === 'sandbox'
  ? "https://api-sandbox.pinterest.com/v5"
  : "https://api.pinterest.com/v5";

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: refresh Pinterest access token using the refresh_token grant
   Pinterest uses standard OAuth 2.0 refresh — POST to their token endpoint
───────────────────────────────────────────────────────────────────────────── */
async function refreshPinterestToken(pinterestAcc) {
  const refreshToken = decrypt(pinterestAcc.refreshToken);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const credentials = Buffer.from(
    `${config.PINTEREST_APP_ID}:${config.PINTEREST_APP_SECRET}`
  ).toString("base64");

  const response = await axios.post(
    `${PINTEREST_API_BASE}/oauth/token`,
    params.toString(),
    {
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );

  const { access_token, refresh_token, expires_in } = response.data;

  // Persist updated tokens (encrypted) — same pattern as YouTube's "tokens" event handler
  const updateData = {};
  if (access_token) updateData.accessToken = encrypt(access_token);
  if (refresh_token) updateData.refreshToken = encrypt(refresh_token); // rotation
  if (expires_in)
    updateData.tokenExpiry = new Date(Date.now() + expires_in * 1000);

  if (Object.keys(updateData).length > 0) {
    await PinterestAccount.updateOne(
      { _id: pinterestAcc._id },
      { $set: updateData }
    );
  }

  return access_token;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Helper: POST a pin to Pinterest v5 API
───────────────────────────────────────────────────────────────────────────── */
async function postPinToAPI(accessToken, pinData) {
  const { boardId, title, description, link, mediaUrl, altText, mediaType} = pinData;
  const isVideo = mediaType === "video"

  if (isVideo) {
    try {
      // 1. Fetch the video
      logger.info("Fetching video for Pinterest upload...", { mediaUrl });
      const videoBuffer = await axios.get(mediaUrl, { responseType: 'arraybuffer' }).then(r => r.data);
      const videoBlob = new Blob([videoBuffer], { type: 'video/mp4' });

      // 2. Register media with Pinterest
      logger.info("Registering video with Pinterest...");
      const registerRes = await axios.post(
        `${PINTEREST_API_BASE}/media`,
        { media_type: "video" },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        }
      );
      const { media_id, upload_url, upload_parameters } = registerRes.data;

      // 3. Upload video to provided S3 upload_url
      logger.info("Uploading video buffer to Pinterest S3...");
      const formData = new FormData();
      for (const [key, value] of Object.entries(upload_parameters)) {
        formData.append(key, value);
      }
      formData.append("file", videoBlob, "video.mp4");

      const uploadRes = await fetch(upload_url, {
        method: "POST",
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error(`Failed to upload video to Pinterest: ${uploadRes.statusText}`);
      }

      // 4. Poll for processing completion
      logger.info("Polling for Pinterest video processing completion...");
      let status = "registered";
      let attempts = 0;
      while ((status === "registered" || status === "processing") && attempts < 30) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const statusRes = await axios.get(`${PINTEREST_API_BASE}/media/${media_id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        status = statusRes.data.status;
        if (status === "failed") {
          throw new Error("Pinterest video processing failed.");
        }
        attempts++;
      }

      if (status !== "succeeded") {
        throw new Error(`Pinterest video processing timed out with status: ${status}`);
      }

      // 5. Create Pin
      logger.info("Video processed successfully, creating Pin...");
      const body = {
        board_id: boardId,
        media_source: {
          source_type: "video_id",
          media_id: media_id,
          cover_image_key_frame_time: 0,
        },
      };

      if (title) body.title = title;
      if (description) body.description = description;
      if (link) body.link = link;
      if (altText) body.alt_text = altText;

      const response = await axios.post(`${PINTEREST_API_BASE}/pins`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      });
      return response.data;
    } catch (err) {
      console.error("Pinterest POST /pins error (video):", JSON.stringify(err?.response?.data || err.message, null, 2));
      throw err;
    }
  } else {
    // Original image logic
    const body = {
      board_id: boardId,
      media_source: {
        source_type: "image_url",
        url: mediaUrl,
      },
    };

    if (title) body.title = title;
    if (description) body.description = description;
    if (link) body.link = link;
    if (altText) body.alt_text = altText;

    try {
      const response = await axios.post(`${PINTEREST_API_BASE}/pins`, body, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        timeout: 15_000,
      });
      return response.data;
    } catch (err) {
      console.error("Pinterest POST /pins error (image):", JSON.stringify(err?.response?.data || err.message, null, 2));
      console.error("Status:", err?.response?.status);
      console.error("Body sent:", JSON.stringify(body, null, 2));
      throw err;
    }
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   Worker — mirrors your youtubeWorker structure 1:1
───────────────────────────────────────────────────────────────────────────── */
export const pinterestWorker = new Worker(
  "pinterest-post-queue",

  async (job) => {
    const {
      socialPostId,
      userId,
      accountId,        // pinterestId (same role as channelId in YouTube)
      mediaUrl,
      mediaType,
      boardId,
      title = "",
      description = "",
      link = "",
      altText = "",
      _legacy = true,
      postIndex = null,
    } = job.data;

    logger.info("📌 Pinterest job START", { jobId: job.id });

    /* ─────────────────────────────
       MARK PROCESSING
    ───────────────────────────── */
    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
            "platforms.$[p].result.error": null,
          },
        },
        {
          arrayFilters: [
            { "p.platform": "pinterest", "p.accountId": accountId },
          ],
        }
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

    /* ─────────────────────────────
       GET CONNECTED PINTEREST ACCOUNT
    ───────────────────────────── */
    const pinterestAcc = await PinterestAccount.findOne({
      userId,
      $or: [
        { pinterestId: accountId },
        { _id: mongoose.isValidObjectId(accountId) ? accountId : null },
      ],
    });

    if (!pinterestAcc) {
      throw new Error("Pinterest account not connected.");
    }

    /* ─────────────────────────────
       RESOLVE VALID ACCESS TOKEN
       Refresh if expired (same logic as YouTube's getAccessToken())
    ───────────────────────────── */
    let accessToken = process.env.PINTEREST_ENV === 'sandbox'
  ? process.env.PINTEREST_ACCESS_TOKEN 
  : decrypt(pinterestAcc.accessToken);
    console.log("🔑 Decrypted token (first 20 chars):", accessToken?.slice(0, 20));
    console.log("🔑 Token from env (first 20 chars):", process.env.PINTEREST_ACCESS_TOKEN?.slice(0, 20));

    const isExpired =
      pinterestAcc.tokenExpiry && pinterestAcc.tokenExpiry <= new Date();

    if (isExpired && pinterestAcc.refreshToken) {
      logger.info("🔄 Pinterest token expired — refreshing", {
        accountId,
      });
      accessToken = await refreshPinterestToken(pinterestAcc);
    }

    /* ─────────────────────────────
       POST THE PIN
    ───────────────────────────── */
    const pinResult = await postPinToAPI(accessToken, {
      boardId,
      title,
      description,
      link,
      mediaUrl,
      altText,
      mediaType,
    });

    const pinId = pinResult.id;

    /* ─────────────────────────────
       MARK COMPLETED
    ───────────────────────────── */
    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PUBLISHED",
            "platforms.$[p].result.externalPostId": pinId,
            "platforms.$[p].result.publishedAt": new Date(),
          },
        },
        {
          arrayFilters: [
            { "p.platform": "pinterest", "p.accountId": accountId },
          ],
        }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: pinId,
            [`posts.${postIndex}.publishedAt`]: new Date(),
          },
        }
      );
    }

    await checkAndFinalizePost(socialPostId);

    logger.info("✅ Pinterest pin created", { pinId });

    return { pinId };
  },

  {
    connection: redisClient,
    concurrency: 3,
  }
);

/* ─────────────────────────────────────────────────────────────────────────────
   FAILURE HANDLER — mirrors youtubeWorker.on("failed")
───────────────────────────────────────────────────────────────────────────── */
pinterestWorker.on("failed", async (job, err) => {
  logger.error("❌ Pinterest job FAILED", {
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
      {
        arrayFilters: [
          { "p.platform": "pinterest", "p.accountId": d.accountId },
        ],
      }
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