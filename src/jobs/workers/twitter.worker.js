import { Worker, UnrecoverableError } from "bullmq";
import { TwitterApi } from "twitter-api-v2";
import axios from "axios";
import SocialPost from "../../models/SocialPost.js";
import TwitterModal from "../../models/TwitterModal.js";
import { decrypt, encrypt } from "../../utils/crypto.js";
import redisClient from "../../config/redis.js";
import config from "../../config/config.js";
import logger from "../../config/logger.js";
import {
  trackAndDeductFeatureCredit,
  verifyFeatureAccess,
} from "../../utils/creditTracker.js";
import { checkAndFinalizePost } from "../../jobs/socialPublish.job.js";

const X_OAUTH2_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const TWITTER_OAUTH2_CLIENT_ID =
  config.TWITTER_OAUTH2_CLIENT_ID || config.TWITTER_API_KEY;
const TWITTER_OAUTH2_CLIENT_SECRET =
  config.TWITTER_OAUTH2_CLIENT_SECRET || config.TWITTER_API_SECRET;

const getTwitterOAuth2TokenHeaders = () => {
  const headers = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (TWITTER_OAUTH2_CLIENT_SECRET) {
    headers.Authorization = `Basic ${Buffer.from(
      `${TWITTER_OAUTH2_CLIENT_ID}:${TWITTER_OAUTH2_CLIENT_SECRET}`,
    ).toString("base64")}`;
  }

  return headers;
};

export const getTwitterOAuth2AccessToken = async (twAcc) => {
  if (!twAcc?.oauth2AccessToken) return null;

  const checkNeedsRefresh = (acc) => {
    const expiresAt = acc.oauth2ExpiresAt ? new Date(acc.oauth2ExpiresAt).getTime() : 0;
    return !expiresAt || expiresAt < Date.now() + 2 * 60 * 1000;
  };

  if (!checkNeedsRefresh(twAcc) || !twAcc.oauth2RefreshToken) {
    return decrypt(twAcc.oauth2AccessToken);
  }

  const lockKey = `twitter_oauth2_refresh_lock:${twAcc._id}`;
  
  // Try to acquire lock
  const acquired = await redisClient.set(lockKey, "locked", "EX", 15, "NX");
  
  if (!acquired) {
    // Wait for the lock to be released (another process is refreshing)
    logger.info("Twitter token refresh lock acquired by another process, waiting...", { accountId: twAcc.twitterId });
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const freshAcc = await TwitterModal.findById(twAcc._id);
      if (freshAcc && !checkNeedsRefresh(freshAcc)) {
        return decrypt(freshAcc.oauth2AccessToken);
      }
      
      // If the lock was released but the token still needs refresh, the previous attempt failed.
      const lockStatus = await redisClient.get(lockKey);
      if (!lockStatus) {
        throw new Error("Twitter OAuth2 token refresh failed in another process");
      }
    }
    throw new Error("Timeout waiting for Twitter OAuth2 token refresh lock");
  }

  try {
    // Re-fetch to ensure we have the absolute latest refresh token before doing the API call
    const currentAcc = await TwitterModal.findById(twAcc._id);
    if (!currentAcc) throw new Error("Twitter account not found");
    
    if (!checkNeedsRefresh(currentAcc)) {
      return decrypt(currentAcc.oauth2AccessToken);
    }
    
    if (!currentAcc.oauth2RefreshToken) {
      throw new Error("No refresh token available");
    }

    const bodyObj = {
      grant_type: "refresh_token",
      refresh_token: decrypt(currentAcc.oauth2RefreshToken),
    };
    if (!TWITTER_OAUTH2_CLIENT_SECRET) {
      bodyObj.client_id = TWITTER_OAUTH2_CLIENT_ID;
    }

    const response = await axios.post(
      "https://api.x.com/2/oauth2/token",
      new URLSearchParams(bodyObj),
      {
        headers: getTwitterOAuth2TokenHeaders(),
      }
    );

    const tokenData = response.data;
    const update = {
      oauth2AccessToken: encrypt(tokenData.access_token),
      oauth2ExpiresAt: tokenData.expires_in
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : currentAcc.oauth2ExpiresAt,
    };
    if (tokenData.refresh_token) {
      update.oauth2RefreshToken = encrypt(tokenData.refresh_token);
    }
    if (tokenData.scope) {
      update.oauth2Scopes = String(tokenData.scope).split(/\s+/).filter(Boolean);
    }

    await TwitterModal.updateOne({ _id: currentAcc._id }, { $set: update });
    return tokenData.access_token;
  } finally {
    await redisClient.del(lockKey);
  }
};

// ─── Helper: download media to Buffer ───────────────────────────────────────
async function downloadToBuffer(url) {
  const response = await axios({
    method: "GET",
    url,
    responseType: "arraybuffer",
  });
  return Buffer.from(response.data);
}

async function uploadMedia(
  userClient,
  mediaUrl,
  mediaType,
  authMode = "oauth1",
) {
  const normalizedMediaType = String(mediaType || "").toLowerCase();
  const isVideo = normalizedMediaType === "video";
  const mimeType = isVideo ? "video/mp4" : "image/jpeg";

  const buffer = await downloadToBuffer(mediaUrl);

  // Media upload for Twitter must always use v1 API, even for OAuth2 tokens.
  // The v2 endpoint for media upload is either non-existent or restricted.

  if (isVideo) {
    const mediaId = await userClient.v1.uploadMedia(buffer, {
      mimeType,
      longVideo: true,
    });
    return mediaId;
  }

  // Image — simple upload
  const mediaId = await userClient.v1.uploadMedia(buffer, { mimeType });
  return mediaId;
}

export const buildTwitterPostingClient = async (twAcc) => {
  if (twAcc.oauth2AccessToken) {
    try {
      const oauth2AccessToken = await getTwitterOAuth2AccessToken(twAcc);
      if (oauth2AccessToken) {
        return {
          client: new TwitterApi(oauth2AccessToken),
          authMode: "oauth2",
        };
      }
    } catch (err) {
      logger.warn(
        "Twitter OAuth2 posting client unavailable, trying OAuth1 fallback",
        {
          accountId: twAcc.twitterId,
          err: err?.response?.data || err?.message,
        },
      );
    }
  }

  if (twAcc.accessToken && twAcc.accessSecret) {
    return {
      client: new TwitterApi({
        appKey: config.TWITTER_API_KEY,
        appSecret: config.TWITTER_API_SECRET,
        accessToken: decrypt(twAcc.accessToken),
        accessSecret: decrypt(twAcc.accessSecret),
      }),
      authMode: "oauth1",
    };
  }

  throw new Error("Twitter account is missing usable OAuth tokens.");
};

// ─── Worker ──────────────────────────────────────────────────────────────────
export const twitterWorker = new Worker(
  "twitter-post-queue",
  async (job) => {
    const {
      socialPostId,
      userId,
      accountId,
      text,
      mediaUrl,
      mediaType = "image",
      _legacy = true,
      postIndex = null,
    } = job.data;

    logger.info("🐦 Twitter job START", { jobId: job.id, socialPostId });

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
          arrayFilters: [{ "p.platform": "twitter", "p.accountId": accountId }],
        },
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PROCESSING",
            [`posts.${postIndex}.error`]: null,
          },
        },
      );
    }

    const twAcc = await TwitterModal.findOne({ userId, twitterId: accountId });
    if (!twAcc) throw new Error("Twitter account not connected.");

    let { client: userClient, authMode } =
      await buildTwitterPostingClient(twAcc);

    let mediaId = null;
    if (mediaUrl) {
      logger.info(`📎 Uploading ${mediaType} to Twitter`, { socialPostId });
      try {
        mediaId = await uploadMedia(userClient, mediaUrl, mediaType, authMode);
      } catch (uploadErr) {
        if (authMode === "oauth2" && twAcc.accessToken && twAcc.accessSecret) {
          logger.warn(
            "Twitter OAuth2 media upload failed, retrying with OAuth1 fallback",
            {
              socialPostId,
              err: uploadErr?.data || uploadErr?.message,
            },
          );
          userClient = new TwitterApi({
            appKey: config.TWITTER_API_KEY,
            appSecret: config.TWITTER_API_SECRET,
            accessToken: decrypt(twAcc.accessToken),
            accessSecret: decrypt(twAcc.accessSecret),
          });
          authMode = "oauth1";
          mediaId = await uploadMedia(
            userClient,
            mediaUrl,
            mediaType,
            authMode,
          );
        } else {
          throw uploadErr;
        }
      }
      logger.info("📎 Twitter media uploaded", { mediaId });
    }

    const payload = {};
    if (text) {
      payload.text = text;
    }
    if (mediaId) {
      payload.media = { media_ids: [mediaId.toString()] };
    }

    // Verify credits before posting to Twitter
    try {
      await verifyFeatureAccess({
        userId,
        featureKey: "twitterPost",
        usageCount: 1,
        metadata: {
          mediaType,
        },
      });
    } catch (creditErr) {
      throw new Error(
        `Insufficient credits for Twitter posting: ${creditErr.message}`,
      );
    }

    let tweet;
    let tweetId;
    try {
      logger.info("📤 Sending payload to Twitter v2", { payload });
      tweet = await userClient.v2.tweet(payload);
      tweetId = tweet?.data?.id;

      if (!tweetId) {
        throw new Error("Failed to extract tweet ID from response");
      }
    } catch (apiErr) {
      if (
        authMode === "oauth2" &&
        twAcc.accessToken &&
        twAcc.accessSecret &&
        !mediaId
      ) {
        logger.warn(
          "Twitter OAuth2 post failed, retrying with OAuth1 fallback",
          {
            socialPostId,
            err: apiErr?.data || apiErr?.message,
          },
        );
        const oauth1Client = new TwitterApi({
          appKey: config.TWITTER_API_KEY,
          appSecret: config.TWITTER_API_SECRET,
          accessToken: decrypt(twAcc.accessToken),
          accessSecret: decrypt(twAcc.accessSecret),
        });
        tweet = await oauth1Client.v2.tweet(payload);
        tweetId = tweet?.data?.id;

        if (!tweetId) {
          throw new Error(
            "Failed to extract tweet ID from OAuth1 fallback response",
          );
        }
      } else {
        // Check if it's a 4xx client error (like 403 Forbidden / Duplicate)
        const status =
          apiErr?.code || apiErr?.status || apiErr?.response?.status;
        if (status >= 400 && status < 500) {
          throw new UnrecoverableError(
            `Twitter API Error: ${apiErr.message || "Forbidden/Client Error"}`,
          );
        }
        throw apiErr;
      }
    }

    logger.info("✅ Tweet posted successfully", {
      tweetId,
      mediaId: mediaId || null,
      hasMedia: !!mediaId,
    });

    // Deduct credits AFTER successful post
    try {
      await trackAndDeductFeatureCredit({
        userId,
        featureKey: "twitterPost",
        usageCount: 1,
        referenceId: socialPostId,
        referenceModel: "SocialPost",
        description: "Auto-deducted for Twitter post",
        idempotencyKey: `twitter-post-${socialPostId}-${job.id}`,
        metadata: {
          mediaType,
          tweetId,
          accountId,
          hasMedia: !!mediaId,
        },
      });
    } catch (deductErr) {
      logger.error("Failed to deduct credits after successful Twitter post", {
        err: deductErr.message,
        socialPostId,
        userId,
      });
    }

    if (_legacy) {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            "platforms.$[p].result.status": "PUBLISHED",
            "platforms.$[p].result.externalPostId": tweetId,
            "platforms.$[p].result.publishedAt": new Date(),
          },
        },
        {
          arrayFilters: [{ "p.platform": "twitter", "p.accountId": accountId }],
        },
      );
    } else {
      await SocialPost.updateOne(
        { _id: socialPostId },
        {
          $set: {
            [`posts.${postIndex}.status`]: "PUBLISHED",
            [`posts.${postIndex}.externalPostId`]: tweetId,
            [`posts.${postIndex}.publishedAt`]: new Date(),
          },
        },
      );
    }

    await checkAndFinalizePost(socialPostId);

    logger.info("✅ Twitter post success", { tweetId });
    return { tweetId };
  },
  { connection: redisClient, concurrency: 2 },
);

// ─── Failed handler ───────────────────────────────────────────────────────────
twitterWorker.on("failed", async (job, err) => {
  logger.error("❌ Twitter job FAILED", {
    jobId: job?.id,
    error: err?.message,
    detail: err?.data ?? null,
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
        arrayFilters: [{ "p.platform": "twitter", "p.accountId": d.accountId }],
      },
    );
  } else {
    await SocialPost.updateOne(
      { _id: d.socialPostId },
      {
        $set: {
          [`posts.${d.postIndex}.status`]: "FAILED",
          [`posts.${d.postIndex}.error`]: err?.message,
        },
      },
    );
  }

  await checkAndFinalizePost(d.socialPostId);
});
