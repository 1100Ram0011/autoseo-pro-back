import { Worker } from "bullmq";
import axios from "axios";

import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";

import SocialPost from "../../models/SocialPost.js";
import InstagramAccount from "../../models/InstagramAccount.js";
import { decrypt } from "../../utils/crypto.js";
import config from "../../config/config.js";
import socketService from "../../socket.js";
import { processImageForStory, processVideoForStory } from "../../services/storyProcessing.service.js";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";

const GRAPH = `${config.GRAPH_BASE_URL}`;

/** -------- META REQUEST WRAPPER (logs full FB/IG error details) -------- */
export async function metaRequest(label, request, extra = {}) {
  try {
    const res = await request();
    logger.info(`✅ META SUCCESS → ${label}`, { ...extra, data: res?.data });
    return res;
  } catch (err) {
    const e = err?.response?.data?.error;
    logger.error(`❌ META ERROR → ${label}`, {
      ...extra,
      status: err?.response?.status,
      message: err?.message,
      code: e?.code,
      subcode: e?.error_subcode,
      type: e?.type,
      metaMessage: e?.message,
      fbtrace_id: e?.fbtrace_id,
      raw: err?.response?.data,
    });
    throw err;
  }
}

/** -------- TOKEN DEBUG (helpful when FB publish fails) -------- */
async function debugToken(inputToken, label) {
  const appToken = `${config.META_APP_ID}|${config.META_APP_SECRET}`;

  const res = await metaRequest(
    `DEBUG_TOKEN_${label}`,
    () =>
      axios.get(`${GRAPH}/debug_token`, {
        params: {
          input_token: inputToken,
          access_token: appToken,
        },
      }),
    { label }
  );

  return res?.data;
}

/** -------- IG PERMISSION CHECK -------- */
async function assertInstagramPublishPermission(accessToken) {
  const dbg = await debugToken(accessToken, "IG");
  const scopes = dbg?.data?.scopes || [];
  const isValid = dbg?.data?.is_valid;

  if (!isValid) {
    throw new Error("Meta token is invalid/expired. Reconnect Instagram.");
  }

  if (!scopes.includes("instagram_content_publish")) {
    throw new Error(
      "Missing permission: instagram_content_publish. Reconnect with correct scopes and ensure app is Live/approved or user is App role in dev mode."
    );
  }
}

/** -------- IG HELPERS -------- */
async function createIgMediaContainer({ igUserId, accessToken, params }) {
  const res = await metaRequest(
    "IG_CREATE_MEDIA_CONTAINER",
    () =>
      axios.post(`${GRAPH}/${igUserId}/media`, null, {
        params: { ...params, access_token: accessToken },
      }),
    { igUserId }
  );

  const creationId = res?.data?.id;
  if (!creationId) throw new Error("Failed to create IG media container.");
  return creationId;
}

async function waitForIgContainerReady({ creationId, accessToken, timeoutMs = 60 * 1000 }) {
  const started = Date.now();

  while (true) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("IG image processing timeout (container not FINISHED).");
    }

    const res = await axios.get(`${GRAPH}/${creationId}`, {
      params: {
        fields: "status_code",
        access_token: accessToken,
      },
    });

    const statusCode = res?.data?.status_code; // IN_PROGRESS | FINISHED | ERROR
    logger.info("IG container status", { creationId, statusCode });

    if (statusCode === "FINISHED") return true;
    if (statusCode === "ERROR") throw new Error(`IG container ERROR: ${JSON.stringify(res.data)}`);

    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function publishIgContainer({ igUserId, accessToken, creationId }) {
  const res = await metaRequest(
    "IG_MEDIA_PUBLISH",
    () =>
      axios.post(`${GRAPH}/${igUserId}/media_publish`, null, {
        params: { creation_id: creationId, access_token: accessToken },
      }),
    { igUserId, creationId }
  );

  const igMediaId = res?.data?.id;
  if (!igMediaId) throw new Error("Failed to publish IG media.");
  return igMediaId;
}

async function publishInstagramImage({ igUserId, accessToken, imageUrl, caption }) {
  const creationId = await createIgMediaContainer({
    igUserId,
    accessToken,
    params: { image_url: imageUrl, caption },
  });

  await waitForIgContainerReady({ creationId, accessToken });

  const igMediaId = await publishIgContainer({ igUserId, accessToken, creationId });
  return { igMediaId, creationId };
}

async function publishInstagramVideo({ igUserId, accessToken, videoUrl, caption }) {
  const creationId = await createIgMediaContainer({
    igUserId,
    accessToken,
    params: {
      media_type: "REELS",
      video_url: videoUrl,
      caption,
    },
  });

  await waitForIgContainerReady({ creationId, accessToken });

  const igMediaId = await publishIgContainer({ igUserId, accessToken, creationId });
  return { igMediaId, creationId };
}

async function publishInstagramStory({ igUserId, accessToken, imageUrl, videoUrl }) {
  const creationId = await createIgMediaContainer({
    igUserId,
    accessToken,
    params: {
      media_type: "STORIES",
      image_url: imageUrl || undefined,
      video_url: videoUrl || undefined,
    },
  });

  await waitForIgContainerReady({ creationId, accessToken });

  const igMediaId = await publishIgContainer({ igUserId, accessToken, creationId });
  return { igMediaId, creationId };
}

/** -------- FB HELPERS (PAGE TOKEN REQUIRED) -------- */
async function publishFacebookPhoto({ pageId, pageAccessToken, imageUrl, caption }) {
  const res = await metaRequest(
    "FB_PHOTO_UPLOAD",
    () =>
      axios.post(`${GRAPH}/${pageId}/photos`, null, {
        params: {
          url: imageUrl,
          caption: caption || "",
          published: true,
          access_token: pageAccessToken,
        },
      }),
    { pageId }
  );

  return res?.data?.post_id || res?.data?.id;
}

/** -------------------------- WORKER -------------------------- */
export const instagramWorker = new Worker(
  "instagram-post-queue",
  async (job) => {
    const {
      socialPostId,
      userId,
      instagramAccountId,
      mediaUrl,
      mediaType,
      description = "",
      hashtags = [],
      isStory = false,
      crossPostToFacebook = false,
      mediaIndex = 0,
      _legacy = true,
      postIndex = null,
    } = job.data;

    if (_legacy) {
      const igPlatformFilter = [{ "p.platform": "instagram", "p.accountId": instagramAccountId }];
      if (job.data.postType) igPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${job.data.postType}$`, "i") };

      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
            "platforms.$[p].result.error": null,
          },
        },
        { arrayFilters: igPlatformFilter }
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

    // Load IG account
    const isObjectId = /^[a-f\d]{24}$/i.test(instagramAccountId);
    const query = isObjectId ? { _id: instagramAccountId, userId } : { instagramBusinessId: instagramAccountId, userId };
    const igAcc = await InstagramAccount.findOne(query).lean();
    if (!igAcc) throw new Error("Instagram account not connected (bad instagramAccountId).");

    // IG token + IG business ID
    const igAccessToken = igAcc.accessToken?.content ? decrypt(igAcc.accessToken) : null;
    const igUserId = igAcc.instagramBusinessId;
    if (!igAccessToken || !igUserId) throw new Error("Instagram credentials missing.");

    // IG permission check
    await assertInstagramPublishPermission(igAccessToken);

    // Publish IG
    let igMediaId;
    try {
      const lower = String(mediaType).toLowerCase();

      if (isStory) {
        // STORY UPLOAD - no captions, no hashtags
        logger.info("📖 Publishing Instagram Story", { mediaType: lower });
        
        // Process media to 9:16 portrait format to avoid stretching on Instagram
        let storyMediaUrl = mediaUrl;
        try {
          if (lower === "image") {
            storyMediaUrl = await processImageForStory(mediaUrl, socialPostId);
          } else if (lower === "video") {
            storyMediaUrl = await processVideoForStory(mediaUrl, socialPostId);
          }
        } catch (processErr) {
          logger.warn("Failed to process story to 9:16 aspect ratio, using original", { error: processErr.message });
        }

        const res = await publishInstagramStory({
          igUserId,
          accessToken: igAccessToken,
          imageUrl: lower === "image" ? storyMediaUrl : undefined,
          videoUrl: lower === "video" ? storyMediaUrl : undefined,
        });
        igMediaId = res.igMediaId;

        // Update DB with story
        await InstagramAccount.updateOne(
          { _id: igAcc._id },
          {
            $inc: { "insights.storiesCount": 1 },
            $push: {
              stories: {
                id: igMediaId,
                mediaType: lower.toUpperCase(),
                mediaUrl: mediaUrl,
                timestamp: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h from now
              },
            },
          }
        );
      } else if (lower === "image") {
        // FEED IMAGE
        const res = await publishInstagramImage({
          igUserId,
          accessToken: igAccessToken,
          imageUrl: mediaUrl,
          caption: description ? `${description}${hashtags.length ? `\n${hashtags.map((h) => `#${String(h).replace(/^#/, "")}`).join(" ")}` : ""}` : hashtags.map((h) => `#${String(h).replace(/^#/, "")}`).join(" "),
        });
        igMediaId = res.igMediaId;
      } else if (lower === "video") {
        // FEED VIDEO (REELS)
        const res = await publishInstagramVideo({
          igUserId,
          accessToken: igAccessToken,
          videoUrl: mediaUrl,
          caption: description ? `${description}${hashtags.length ? `\n${hashtags.map((h) => `#${String(h).replace(/^#/, "")}`).join(" ")}` : ""}` : hashtags.map((h) => `#${String(h).replace(/^#/, "")}`).join(" "),
        });
        igMediaId = res.igMediaId;
      } else {
        throw new Error(`Unsupported mediaType: ${mediaType}`);
      }

      // Try to fetch permalink
      try {
        const pRes = await axios.get(`${config.GRAPH_BASE_URL || 'https://graph.facebook.com/v19.0'}/${igMediaId}?fields=permalink&access_token=${igAccessToken}`);
        if (pRes.data && pRes.data.permalink) {
          job.data.igPermalink = pRes.data.permalink;
        }
      } catch (perr) {
        logger.warn("Could not fetch IG permalink", { error: perr.message });
      }
    } catch (e) {
      const apiErr = e?.response?.data || e?.message;
      logger.error("❌ IG publish API error", { jobId: job.id, apiErr });
      throw new Error(typeof apiErr === "string" ? apiErr : JSON.stringify(apiErr));
    }

    if (_legacy) {
      const igPlatformFilter = [{ "p.platform": "instagram", "p.accountId": instagramAccountId }];
      if (job.data.postType) igPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${job.data.postType}$`, "i") };

      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PUBLISHED",
            "platforms.$[p].result.externalPostId": igMediaId,
            "platforms.$[p].result.permalink": job.data.igPermalink,
            "platforms.$[p].result.publishedAt": new Date(),
            "platforms.$[p].result.error": null,
          },
        },
        { arrayFilters: igPlatformFilter }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: igMediaId,
            [`posts.${postIndex}.permalink`]: job.data.igPermalink,
            [`posts.${postIndex}.publishedAt`]: new Date(),
            [`posts.${postIndex}.error`]: null,
          },
        }
      );
    }

    await checkAndFinalizePost(socialPostId);

    socketService.emitToUser(
      userId,
      isStory ? "instagram:story:completed" : "instagram:media:completed",
      {
        socialPostId: socialPostId,
        mediaUrl: mediaUrl,
        status: "PUBLISHED",
        type: isStory ? "story" : "post",
      }
    );

    logger.info(`✅ Instagram ${isStory ? "story" : "post"} publish success`, { igMediaId });
    return { igMediaId, type: isStory ? "story" : "post" };
  },
  { connection: redisClient, concurrency: 2 }
);

/** -------- BullMQ failure handler -------- */
instagramWorker.on("failed", async (job, err) => {
  logger.error("❌ Instagram job FAILED", { jobId: job?.id, error: err?.message });

  const d = job?.data;
  if (!d?.socialPostId || !d?.instagramAccountId) return;

  if (d._legacy !== false) {
    const igPlatformFilter = [{ "p.platform": "instagram", "p.accountId": d.instagramAccountId }];
    if (d.postType) igPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${d.postType}$`, "i") };

    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          "platforms.$[p].result.status": "FAILED",
          "platforms.$[p].result.error": err?.message,
        },
      },
      { arrayFilters: igPlatformFilter }
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