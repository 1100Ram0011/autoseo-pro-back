import { Worker } from "bullmq";
import axios from "axios";

import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import SocialPost from "../../models/SocialPost.js";
import FacebookAccount from "../../models/FacebookAccount.js";
import { decrypt } from "../../utils/crypto.js";
import config from "../../config/config.js";
import socketService from "../../socket.js";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";

const GRAPH = "https://graph.facebook.com/v19.0";

async function metaRequest(label, request, extra = {}) {
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

async function debugToken(inputToken) {
  const appToken = `${config.META_APP_ID}|${config.META_APP_SECRET}`;
  const res = await metaRequest("DEBUG_TOKEN_FB", () =>
    axios.get(`${GRAPH}/debug_token`, {
      params: { input_token: inputToken, access_token: appToken },
    })
  );
  return res?.data;
}

async function publishFacebookPhoto({ pageId, pageAccessToken, imageUrl, caption }) {
  const res = await metaRequest("FB_PHOTO_UPLOAD", () =>
    axios.post(`${GRAPH}/${pageId}/photos`, null, {
      params: {
        url: imageUrl,
        caption: caption || "",
        published: true,
        access_token: pageAccessToken,
      },
    })
  );
  return res?.data?.post_id || res?.data?.id;
}

async function publishFacebookVideo({ pageId, pageAccessToken, videoUrl, description }) {
  const res = await metaRequest("FB_VIDEO_UPLOAD", () =>
    axios.post(`${GRAPH}/${pageId}/videos`, null, {
      params: {
        file_url: videoUrl,
        description: description || "",
        access_token: pageAccessToken,
      },
    })
  );
  return res?.data?.id;
}

async function publishFacebookText({ pageId, pageAccessToken, message }) {
  const res = await metaRequest("FB_TEXT_POST", () =>
    axios.post(`${GRAPH}/${pageId}/feed`, null, {
      params: { message: message || "Posted via Mytek AI", access_token: pageAccessToken },
    })
  );
  return res?.data?.id;
}

async function publishFacebookStoryPhoto({ pageId, pageAccessToken, imageUrl }) {
  // 1. Upload photo as unpublished
  const params = new URLSearchParams();
  params.append("url", imageUrl);
  params.append("published", "false");
  params.append("access_token", pageAccessToken);

  const uploadRes = await metaRequest("FB_STORY_PHOTO_UPLOAD", () =>
    axios.post(`${GRAPH}/${pageId}/photos`, params)
  );
  const photoId = uploadRes?.data?.id;
  if (!photoId) throw new Error("Failed to get photo ID for story");

  // 2. Publish the story using the photo_id
  const storyParams = new URLSearchParams();
  storyParams.append("photo_id", photoId);
  storyParams.append("access_token", pageAccessToken);

  const storyRes = await metaRequest("FB_STORY_PHOTO_PUBLISH", () =>
    axios.post(`${GRAPH}/${pageId}/photo_stories`, storyParams)
  );
  return storyRes?.data?.id || storyRes?.data?.post_id || photoId;
}

async function publishFacebookStoryVideo({ pageId, pageAccessToken, videoUrl }) {
  // 1. Initialize upload session
  const initRes = await metaRequest("FB_STORY_VIDEO_INIT", () =>
    axios.post(`${GRAPH}/${pageId}/video_stories`, null, {
      params: {
        upload_phase: "start",
        access_token: pageAccessToken,
      },
    })
  );
  
  const videoId = initRes?.data?.video_id;
  const uploadUrl = initRes?.data?.upload_url;
  
  if (!videoId || !uploadUrl) {
    throw new Error("Failed to initialize video story upload");
  }

  // 2. Download video to buffer
  const videoBuffer = await axios.get(videoUrl, { responseType: "arraybuffer" }).then(res => res.data);

  // 3. Upload video using the provided upload URL and binary body
  await metaRequest("FB_STORY_VIDEO_UPLOAD", () =>
    axios.post(uploadUrl, videoBuffer, {
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: 0,
        file_size: videoBuffer.byteLength,
        "Content-Type": "application/octet-stream",
      },
    })
  );

  // 4. Finish the upload
  const finishRes = await metaRequest("FB_STORY_VIDEO_FINISH", () =>
    axios.post(`${GRAPH}/${pageId}/video_stories`, null, {
      params: {
        upload_phase: "finish",
        video_id: videoId,
        access_token: pageAccessToken,
      },
    })
  );

  return finishRes?.data?.id || finishRes?.data?.post_id || videoId;
}

export const facebookWorker = new Worker(
  "facebook-post-queue",
  async (job) => {
    console.log("WORKER RUNNING");
    const {
      socialPostId,
      userId,
      facebookAccountId,
      mediaUrl,
      mediaType,
      description = "",
      hashtags = [],
      mediaIndex = 0,
      isStory = false,
      _legacy = true,
      postIndex = null,
    } = job.data;

    logger.info("Facebook job START", {
      jobId: job.id,
      socialPostId,
      facebookAccountId,
      mediaIndex,
      mediaType,
      _legacy,
      postIndex,
    });

    if (_legacy) {
      const fbPlatformFilter = [{ "p.platform": "facebook", "p.accountId": facebookAccountId }];
      if (job.data.postType) fbPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${job.data.postType}$`, "i") };

      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PROCESSING",
            "platforms.$[p].result.error": null,
          },
        },
        { arrayFilters: fbPlatformFilter }
      );
    } else {
      const fbPostFilter = [{ "p._id": postIndex !== null ? undefined : "ignore_if_null" }]; // We'll just use positional if postIndex is known, but actually postIndex is array index. We can use dot notation directly.
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

    const acc = await FacebookAccount.findOne({ _id: facebookAccountId, userId }).lean();
    if (!acc) throw new Error("Account not found for Facebook publishing.");

    const pageId = acc.pageId;

    const pageAccessToken = acc.pageAccessToken ? decrypt(acc.pageAccessToken) : null;

    if (!pageId) throw new Error("pageId missing on account");
    if (!pageAccessToken) throw new Error("pageAccessToken missing on account");

    const tagLine = (Array.isArray(hashtags) ? hashtags : [])
      .map((h) => `#${String(h).replace(/^#/, "")}`)
      .join(" ");
    const caption = description ? `${description}${tagLine ? `\n${tagLine}` : ""}` : tagLine;

    logger.info("FB DEBUG INFO", { pageId, tokenPrefix: pageAccessToken.slice(0, 15) });

    await debugToken(pageAccessToken);

    let fbPostId = null;
    const lower = String(mediaType).toLowerCase();

    if (isStory) {
      if (lower === "image") {
        fbPostId = await publishFacebookStoryPhoto({ pageId, pageAccessToken, imageUrl: mediaUrl });
      } else if (lower === "video") {
        fbPostId = await publishFacebookStoryVideo({ pageId, pageAccessToken, videoUrl: mediaUrl });
      } else {
        throw new Error("Text stories are not supported on Facebook via API");
      }
    } else {
      if (lower === "image") {
        fbPostId = await publishFacebookPhoto({ pageId, pageAccessToken, imageUrl: mediaUrl, caption });
      } else if (lower === "video") {
        fbPostId = await publishFacebookVideo({ pageId, pageAccessToken, videoUrl: mediaUrl, description: caption });
      } else {
        fbPostId = await publishFacebookText({ pageId, pageAccessToken, message: caption });
      }
    }

    if (_legacy) {
      const fbPlatformFilter = [{ "p.platform": "facebook", "p.accountId": facebookAccountId }];
      if (job.data.postType) fbPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${job.data.postType}$`, "i") };

      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PUBLISHED",
            "platforms.$[p].result.externalPostId": fbPostId,
            "platforms.$[p].result.publishedAt": new Date(),
            "platforms.$[p].result.error": null,
          },
        },
        { arrayFilters: fbPlatformFilter }
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: fbPostId,
            [`posts.${postIndex}.publishedAt`]: new Date(),
            [`posts.${postIndex}.error`]: null,
          },
        }
      );
    }

    await checkAndFinalizePost(socialPostId);


    socketService.emitToUser(
      userId,
      isStory ? "facebook:story:completed" : "facebook:media:completed",
      {
        socialPostId: socialPostId,
        mediaUrl: mediaUrl,
        status: "PUBLISHED",
        type: isStory ? "story" : "post",
      }
    );

    logger.info(`✅ Facebook ${isStory ? "story" : "post"} publish success`, { fbPostId });
    return { fbPostId, type: isStory ? "story" : "post" };
  },
  { connection: redisClient, concurrency: 2 }
);

facebookWorker.on("failed", async (job, err) => {
  logger.error("❌ Facebook job FAILED", { jobId: job?.id, error: err?.message });

  const d = job?.data;
  if (!d?.socialPostId || !d?.facebookAccountId) return;

  if (d._legacy !== false) {
    const fbPlatformFilter = [{ "p.platform": "facebook", "p.accountId": d.facebookAccountId }];
    if (d.postType) fbPlatformFilter[0]["p.postType"] = { $regex: new RegExp(`^${d.postType}$`, "i") };

    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          "platforms.$[p].result.status": "FAILED",
          "platforms.$[p].result.error": err?.message,
        },
      },
      { arrayFilters: fbPlatformFilter }
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