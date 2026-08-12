// workers/threads.worker.js
import { Worker } from "bullmq";
import axios from "axios";
import mongoose from "mongoose";
import SocialPost from "../../models/SocialPost.js";
import ThreadsModal from "../../models/ThreadsAccount.js";
import { decrypt, encrypt } from "../../utils/crypto.js";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import config from "../../config/config.js";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";

const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const THREADS_LONG_LIVED_TOKEN_URL = "https://graph.threads.net/access_token";

const buildThreadsAccountQuery = ({ userId, accountId }) => {
  const accountKey = String(accountId || "").trim();
  const accountMatchers = [{ threadsUserId: accountKey }];

  if (mongoose.Types.ObjectId.isValid(accountKey)) {
    accountMatchers.push({ _id: accountKey });
  }

  return { userId, $or: accountMatchers };
};

// ─── Token refresh helper ────────────────────────────────────────────────────
async function getFreshToken(threadsAcc) {
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const needsRefresh =
    !threadsAcc.tokenExpiresAt ||
    threadsAcc.tokenExpiresAt.getTime() - Date.now() < sevenDays;

  if (!needsRefresh) return decrypt(threadsAcc.accessToken);

  try {
    const res = await axios.get(THREADS_LONG_LIVED_TOKEN_URL, {
      params: {
        grant_type:   "th_refresh_token",
        access_token: decrypt(threadsAcc.accessToken),
        client_secret: config.THREADS_APP_SECRET,
      },
    });

    const { access_token: newToken, expires_in } = res.data;
    const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);

    await ThreadsModal.updateOne(
      { _id: threadsAcc._id },
      { $set: { accessToken: encrypt(newToken), tokenExpiresAt } }
    );

    logger.info("🔄 Threads token refreshed", { userId: threadsAcc.userId });
    return newToken;
  } catch (err) {
    logger.warn("⚠️ Threads token refresh failed, using existing token", {
      error: err?.response?.data ?? err?.message,
    });
    return decrypt(threadsAcc.accessToken);
  }
}

// ─── Media container helper ──────────────────────────────────────────────────
async function createMediaContainer({ threadsUserId, accessToken, text, mediaUrl, mediaType }) {
  let params = { access_token: accessToken };

  if (!mediaUrl) {
    params = { ...params, media_type: "TEXT", text };
  } else if (mediaType === "video") {
    params = {
      ...params,
      media_type: "VIDEO",
      video_url:  mediaUrl,
      ...(text && { text }),
    };
  } else {
    params = {
      ...params,
      media_type: "IMAGE",
      image_url:  mediaUrl,
      ...(text && { text }),
    };
  }

  const res = await axios.post(
    `${THREADS_API_BASE}/${threadsUserId}/threads`,
    null,
    { params }
  );

  return res.data.id;
}

// ─── Poll until video container is ready ────────────────────────────────────
async function waitForContainer(containerId, accessToken, maxWaitMs = 60_000) {
  const interval = 3_000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const statusRes = await axios.get(`${THREADS_API_BASE}/${containerId}`, {
      params: { fields: "status,error_message", access_token: accessToken },
    });

    const { status, error_message } = statusRes.data;

    if (status === "FINISHED") return;
    if (status === "ERROR") throw new Error(`Container error: ${error_message}`);

    await new Promise((r) => setTimeout(r, interval));
  }

  throw new Error("Timed out waiting for Threads media container");
}

// ─── Worker ──────────────────────────────────────────────────────────────────
export const threadsWorker = new Worker(
  "threads-post-queue",
  async (job) => {
    const { socialPostId, userId, accountId, text, mediaUrl, mediaType, _legacy = true, postIndex = null } = job.data;

    logger.info("🧵 Threads job START", { jobId: job.id, socialPostId });

    // Mark as PROCESSING
    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
            "platforms.$[p].result.error":  null,
          },
        },
        { arrayFilters: [{ "p.platform": "threads", "p.accountId": accountId }] }
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

    // Load account
    const threadsAcc = await ThreadsModal.findOne(
      buildThreadsAccountQuery({ userId, accountId })
    );
    if (!threadsAcc) throw new Error("Threads account not connected.");

    // Get a valid (possibly refreshed) token
    const accessToken = await getFreshToken(threadsAcc);
    const threadsUserId = threadsAcc.threadsUserId;

    // Step 1 — Create media container
    const containerId = await createMediaContainer({
      threadsUserId,
      accessToken,
      text,
      mediaUrl,
      mediaType,
    });

    // Step 2 — For video, poll until container is ready
    if (mediaUrl && mediaType === "video") {
      await waitForContainer(containerId, accessToken);
    }

    // Step 3 — Publish the container
    const publishRes = await axios.post(
      `${THREADS_API_BASE}/${threadsUserId}/threads_publish`,
      null,
      { params: { creation_id: containerId, access_token: accessToken } }
    );

    const threadsPostId = publishRes.data.id;

    // Mark as COMPLETED
    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status":         "PUBLISHED",
            "platforms.$[p].result.externalPostId": threadsPostId,
            "platforms.$[p].result.publishedAt":    new Date(),
          },
        },
        { arrayFilters: [{ "p.platform": "threads", "p.accountId": accountId }] }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: threadsPostId,
            [`posts.${postIndex}.publishedAt`]: new Date(),
          },
        }
      );
    }

    await checkAndFinalizePost(socialPostId);

    logger.info("✅ Threads post success", { threadsPostId });
    return { threadsPostId };
  },
  { connection: redisClient, concurrency: 2 }
);

// ─── Failed handler ───────────────────────────────────────────────────────────
threadsWorker.on("failed", async (job, err) => {
  logger.error("❌ Threads job FAILED", { jobId: job?.id, error: err?.message , threadsApiError: err?.response?.data ?? null, status: err?.response?.status ?? null,});

  const d = job?.data;
  if (!d?.socialPostId || !d?.accountId) return;

  if (d._legacy !== false) {
    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          "platforms.$[p].result.status": "FAILED",
          "platforms.$[p].result.error":  err?.message,
        },
      },
      { arrayFilters: [{ "p.platform": "threads", "p.accountId": d.accountId }] }
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
