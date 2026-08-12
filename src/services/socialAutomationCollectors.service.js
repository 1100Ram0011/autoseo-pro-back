import axios from "axios";
import config from "../config/config.js";
import logger from "../config/logger.js";
import { decrypt } from "../utils/crypto.js";
import SocialMonitoredAccount from "../models/SocialMonitoredAccount.js";
import PinterestAccount from "../models/PinterestModal.js";
import ThreadsAccount from "../models/ThreadsAccount.js";
import LinkedinModel from "../models/LinkedinModel.js";
import { ingestAutomationEvent } from "./socialAutomation.service.js";
import { resolveYouTubeChannelIdentifier } from "./youtubeChannelResolver.service.js";
import { deductDynamicCredit } from "../utils/creditTracker.js";
import { assertDynamicSocialAnalyticsCredit } from "../utils/socialAnalyticsCredit.js";
import { calculateTwitterAnalyticsApiCost } from "../utils/socialAuditPricingCalculate.js";
import { getValidLinkedInToken } from "../controllers/SocialMedia/linkedin.controller.js";

const X_API_BASE = "https://api.x.com/2";
const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const YOUTUBE_WEBSUB_HUB_URL = "https://pubsubhubbub.appspot.com/subscribe";
const PINTEREST_API_BASE =
  process.env.PINTEREST_ENV === "sandbox"
    ? "https://api-sandbox.pinterest.com/v5"
    : "https://api.pinterest.com/v5";

const AUTOMATION_SOURCE_POLL_JOB = "SOCIAL_AUTOMATION_POLL_SOURCES";
const YOUTUBE_WEBSUB_RENEW_JOB = "YOUTUBE_WEBSUB_RENEW_SUBSCRIPTIONS";

const normalizeId = (value) => String(value || "").trim();
const truthy = (value) =>
  ["1", "true", "yes"].includes(String(value || "").toLowerCase());

const newestFirst = (items) =>
  [...items].sort(
    (a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0),
  );

const sourceAccountPayload = (monitored) => ({
  platformAccountId: monitored.platformAccountId,
  username: monitored.username,
  displayName: monitored.displayName,
  profileUrl: monitored.profileUrl,
  avatarUrl: monitored.avatarUrl,
  sourceType: monitored.sourceType,
  sourceConnectedAccountId: monitored.sourceConnectedAccountId,
  isConnectedAccount: monitored.isConnectedAccount,
  metadata: monitored.metadata || {},
});

const ingestPostsForMonitoredAccount = async ({ monitored, posts }) => {
  const ingested = [];
  for (const post of newestFirst(posts).reverse()) {
    const result = await ingestAutomationEvent({
      userId: monitored.userId,
      payload: {
        platform: monitored.platform,
        monitoredAccountId: monitored._id,
        sourceAccount: sourceAccountPayload(monitored),
        post,
        rawPayload: {
          collector: "social-automation-poller",
          platform: monitored.platform,
          post,
        },
      },
    });
    ingested.push({
      eventId: result.event?._id,
      duplicate: result.duplicate,
      runs: result.runs?.length || 0,
    });
  }
  return ingested;
};

const decodeXml = (value = "") =>
  String(value)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const extractTag = (xml, tagName) => {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(xml || "").match(
    new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"),
  );
  return match ? decodeXml(match[1].trim()) : "";
};

const extractLinkHref = (xml) => {
  const match = String(xml || "").match(
    /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i,
  );
  return match ? decodeXml(match[1]) : "";
};

export const getYouTubeWebSubCallbackUrl = () => {
  const explicit = normalizeId(config.YOUTUBE_WEBSUB_CALLBACK_URL);
  if (explicit) return explicit;

  const base = normalizeId(config.BACKEND_BASE_URL).replace(/\/$/, "");
  if (!base) {
    throw new Error(
      "YOUTUBE_WEBSUB_CALLBACK_URL or BACKEND_BASE_URL is required",
    );
  }
  return `${base}/api/youtube-webhook`;
};

export const subscribeToYouTubeChannel = async ({
  channelId,
  mode = "subscribe",
}) => {
  const requestedChannelId = normalizeId(channelId);
  if (!requestedChannelId)
    throw new Error("channelId is required for YouTube WebSub subscription");

  const resolvedChannel =
    await resolveYouTubeChannelIdentifier(requestedChannelId);
  const safeChannelId = resolvedChannel.channelId;

  const callbackUrl = getYouTubeWebSubCallbackUrl();
  if (!callbackUrl.startsWith("https://")) {
    throw new Error("YouTube WebSub callback URL must be public HTTPS");
  }

  const topicUrl = `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(safeChannelId)}`;
  const form = new URLSearchParams({
    "hub.callback": callbackUrl,
    "hub.topic": topicUrl,
    "hub.verify": "async",
    "hub.mode": mode,
  });

  await axios.post(YOUTUBE_WEBSUB_HUB_URL, form.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    timeout: 15000,
  });

  const matchedAccounts = await SocialMonitoredAccount.find({
    platform: "youtube",
    $or: [
      { platformAccountId: safeChannelId },
      { platformAccountId: requestedChannelId },
      { "metadata.youtubeChannelId": safeChannelId },
    ],
  });

  const subscriptionUpdate = {
    "metadata.youtubeChannelId": safeChannelId,
    "metadata.youtubeInput": resolvedChannel.input || requestedChannelId,
    "metadata.webSubSubscribedAt": new Date(),
    "metadata.webSubCallbackUrl": callbackUrl,
    "metadata.webSubTopicUrl": topicUrl,
    "metadata.webSubLastMode": mode,
  };

  for (const account of matchedAccounts) {
    const update = { ...subscriptionUpdate };
    if (account.platformAccountId !== safeChannelId) {
      const duplicate = await SocialMonitoredAccount.exists({
        _id: { $ne: account._id },
        userId: account.userId,
        platform: "youtube",
        platformAccountId: safeChannelId,
      });
      if (!duplicate) update.platformAccountId = safeChannelId;
    }

    await SocialMonitoredAccount.updateOne(
      { _id: account._id },
      { $set: update },
    );
  }

  return { channelId: safeChannelId, callbackUrl, topicUrl, mode };
};

export const renewYouTubeWebSubSubscriptions = async ({
  userId = null,
} = {}) => {
  const channels = await SocialMonitoredAccount.distinct("platformAccountId", {
    platform: "youtube",
    monitorEnabled: true,
    ...(userId ? { userId } : {}),
  });

  const results = [];
  for (const channelId of channels.filter(Boolean)) {
    try {
      results.push(await subscribeToYouTubeChannel({ channelId }));
    } catch (err) {
      logger.warn("YouTube WebSub renewal failed", {
        channelId,
        error: err.message,
        details: err?.response?.data || null,
      });
      results.push({ channelId, error: err.message });
    }
  }

  return { channels: channels.length, results };
};

export const handleYouTubeWebSubNotification = async ({ xml }) => {
  const xmlBody = String(xml || "");
  if (!xmlBody.trim()) return { ignored: true, reason: "empty payload" };
  if (xmlBody.includes("<at:deleted-entry")) {
    return { ignored: true, reason: "deleted entry" };
  }

  const videoId = extractTag(xmlBody, "yt:videoId");
  const channelId = extractTag(xmlBody, "yt:channelId");
  if (!videoId || !channelId) {
    return { ignored: true, reason: "missing videoId or channelId" };
  }

  const post = {
    id: videoId,
    title: extractTag(xmlBody, "title"),
    text: extractTag(xmlBody, "title"),
    url:
      extractLinkHref(xmlBody) || `https://www.youtube.com/watch?v=${videoId}`,
    publishedAt:
      extractTag(xmlBody, "published") ||
      extractTag(xmlBody, "updated") ||
      new Date().toISOString(),
    media: [
      {
        type: "image",
        url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      },
    ],
    raw: {
      source: "youtube-websub",
      videoId,
      channelId,
    },
  };

  const monitoredAccounts = await SocialMonitoredAccount.find({
    platform: "youtube",
    monitorEnabled: true,
    $or: [
      { platformAccountId: channelId },
      { "metadata.youtubeChannelId": channelId },
    ],
  });

  const ingested = [];
  for (const monitored of monitoredAccounts) {
    const result = await ingestAutomationEvent({
      userId: monitored.userId,
      payload: {
        platform: "youtube",
        monitoredAccountId: monitored._id,
        sourceAccount: sourceAccountPayload(monitored),
        post,
        rawPayload: {
          collector: "youtube-websub",
          videoId,
          channelId,
        },
      },
    });

    ingested.push({
      monitoredAccountId: monitored._id,
      eventId: result.event?._id,
      duplicate: result.duplicate,
      runs: result.runs?.length || 0,
    });
  }

  return {
    ignored: false,
    videoId,
    channelId,
    monitoredAccounts: monitoredAccounts.length,
    ingested,
  };
};

const pollTwitterRecentSearch = async (monitored, options = {}) => {
  const bearerToken = config.TWITTER_BEARER_TOKEN;
  if (!bearerToken) {
    throw new Error(
      "TWITTER_BEARER_TOKEN is required for X Recent Search monitoring",
    );
  }

  const rawHandle = monitored.username || monitored.platformAccountId || "";
  const handleMatch = String(rawHandle).match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})/i);
  const username = (handleMatch ? handleMatch[1] : rawHandle).replace(/^@/, "").trim();

  if (!username)
    throw new Error(
      "X monitored account requires username or platformAccountId",
    );

  const params = {
    query: `from:${username} -is:retweet`,
    max_results: Math.min(Math.max(Number(options.maxResults || 10), 10), 100),
    "tweet.fields":
      "id,text,created_at,attachments,author_id,conversation_id,referenced_tweets,public_metrics",
    "media.fields": "media_key,type,url,preview_image_url",
    expansions: "attachments.media_keys,author_id",
  };

  if (monitored.lastSeenPostId && !truthy(options.ignoreSinceId)) {
    params.since_id = monitored.lastSeenPostId;
  }

  // Calculate dynamic Twitter/X request cost and verify credit balance
  const providerCostDetails = await calculateTwitterAnalyticsApiCost(1);
  const creditAmount = Number(providerCostDetails.credits.toFixed(4));
  await assertDynamicSocialAnalyticsCredit({
    userId: monitored.userId,
    creditAmount,
    label: "X auto poll",
  });

  const response = await axios.get(`${X_API_BASE}/tweets/search/recent`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
    params,
  });

  // Deduct credits after successful API response
  if (creditAmount > 0) {
    await deductDynamicCredit({
      userId: monitored.userId,
      creditAmount,
      serviceName: "X Analytics",
      referenceId: monitored._id,
      referenceModel: "SocialMonitoredAccount",
      description: `X auto poll recent search query for @${username}`,
      idempotencyKey: `twitter-auto-poll-${monitored._id}-${Date.now()}`,
      metadata: {
        platform: "twitter",
        monitoredAccountId: monitored._id,
        username,
        source: "social-automation-poll",
      },
    });
  }

  const mediaByKey = new Map(
    (response.data?.includes?.media || []).map((item) => [
      item.media_key,
      item,
    ]),
  );

  return (response.data?.data || []).map((tweet) => ({
    id: tweet.id,
    text: tweet.text || "",
    url: `https://x.com/${username}/status/${tweet.id}`,
    publishedAt: tweet.created_at,
    media: (tweet.attachments?.media_keys || [])
      .map((key) => mediaByKey.get(key))
      .filter(Boolean)
      .map((item) => {
        const mediaUrl = item.url || item.preview_image_url || "";
        return {
          type:
            item.type === "video" || item.type === "animated_gif"
              ? "video"
              : "image",
          url: mediaUrl,
          thumbnailUrl: item.preview_image_url || mediaUrl || "",
        };
      })
      .filter((item) => item.url),
    raw: tweet,
  }));
};

const findPinterestReaderAccount = async (monitored) => {
  const accountId =
    monitored.sourceConnectedAccountId ||
    monitored.metadata?.connectedAccountId ||
    monitored.metadata?.readerAccountId;

  if (accountId) {
    const isIdValid = /^[0-9a-fA-F]{24}$/.test(accountId);
    return PinterestAccount.findOne({
      userId: monitored.userId,
      ...(isIdValid
        ? { $or: [{ pinterestId: accountId }, { _id: accountId }] }
        : { pinterestId: accountId }),
    });
  }

  return PinterestAccount.findOne({ userId: monitored.userId }).sort({
    createdAt: -1,
  });
};

const pollPinterestBoard = async (monitored, options = {}) => {
  const boardId = normalizeId(
    monitored.metadata?.boardId || monitored.metadata?.pinterestBoardId,
  );
  if (!boardId) {
    throw new Error(
      "Pinterest monitoring requires metadata.boardId for official API polling",
    );
  }

  const account = await findPinterestReaderAccount(monitored);
  if (!account)
    throw new Error(
      "Pinterest monitoring requires a connected Pinterest account",
    );

  const accessToken =
    process.env.PINTEREST_ENV === "sandbox"
      ? process.env.PINTEREST_ACCESS_TOKEN
      : decrypt(account.accessToken);

  const response = await axios.get(
    `${PINTEREST_API_BASE}/boards/${boardId}/pins`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        page_size: Math.min(Math.max(Number(options.maxResults || 10), 1), 100),
      },
    },
  );

  return (response.data?.items || []).map((pin) => ({
    id: pin.id,
    title: pin.title || "",
    text: pin.description || pin.title || "",
    url: pin.link || `https://www.pinterest.com/pin/${pin.id}/`,
    publishedAt: pin.created_at || pin.createdAt || new Date().toISOString(),
    media:
      pin.media?.images?.["1200x"]?.url || pin.media?.images?.originals?.url
        ? [
            {
              type: "image",
              url:
                pin.media?.images?.["1200x"]?.url ||
                pin.media?.images?.originals?.url,
            },
          ]
        : [],
    raw: pin,
  }));
};

const resolveThreadsRepostFacade = async (thread, accessToken) => {
  const repostedId = thread.reposted_post?.id;
  if (!repostedId) return thread;

  try {
    const res = await axios.get(
      `${THREADS_API_BASE}/${repostedId}`,
      {
        params: {
          fields: "id,text,media_type,media_url,permalink,timestamp,username,thumbnail_url",
          access_token: accessToken,
        },
      }
    );

    const original = res.data;
    if (original) {
      return {
        ...thread,
        text: `[Reposted from @${original.username || "unknown"}]: ${original.text || ""}`,
        media_type: original.media_type || thread.media_type,
        media_url: original.media_url || thread.media_url,
        thumbnail_url: original.thumbnail_url || thread.thumbnail_url,
        raw: {
          ...thread,
          reposted_post_details: original,
        }
      };
    }
  } catch (err) {
    logger.warn("Failed to fetch original post for Threads repost facade", {
      repostedId,
      error: err.message,
    });
  }

  return {
    ...thread,
    text: `[Reposted a post (ID: ${repostedId})]`,
  };
};

const pollThreadsConnectedAccount = async (monitored, options = {}) => {
  const accountId =
    monitored.sourceConnectedAccountId || monitored.platformAccountId;
  const cleanUsername = accountId.startsWith("@") ? accountId.substring(1) : accountId;
  const usernameRegex = new RegExp(`^${cleanUsername}$`, "i");
  const isIdValid = /^[0-9a-fA-F]{24}$/.test(accountId);
  const account = await ThreadsAccount.findOne({
    userId: monitored.userId,
    ...(isIdValid
      ? { $or: [{ threadsUserId: accountId }, { _id: accountId }, { username: usernameRegex }] }
      : { $or: [{ threadsUserId: accountId }, { username: usernameRegex }] }),
  });

  if (!account) {
    throw new Error(
      "Threads monitoring currently requires the source Threads account to be connected",
    );
  }

  let response;
  try {
    response = await axios.get(
      `${THREADS_API_BASE}/${account.threadsUserId}/threads`,
      {
        params: {
          fields: "id,text,media_type,media_url,permalink,timestamp,username,is_quote_post,quoted_post,reposted_post,thumbnail_url",
          limit: Math.min(Math.max(Number(options.maxResults || 10), 1), 100),
          access_token: decrypt(account.accessToken),
        },
      },
    );
  } catch (apiErr) {
    const metaError = apiErr.response?.data?.error;
    const msg = metaError?.message || apiErr.message;
    throw new Error(
      `Meta API Error: ${msg}. If your Meta App is in Live Mode, this is likely because your app has not passed App Review for Threads permissions.`
    );
  }

  const accessToken = decrypt(account.accessToken);
  const rawThreads = response.data?.data || [];

  const resolvedThreads = await Promise.all(
    rawThreads.map(async (thread) => {
      if (String(thread.media_type).toUpperCase() === "REPOST_FACADE" || thread.reposted_post) {
        return resolveThreadsRepostFacade(thread, accessToken);
      }
      return thread;
    })
  );
  return resolvedThreads.map((thread) => {
    const isRepost = String(thread.media_type).toUpperCase() === "REPOST_FACADE" || !!thread.reposted_post;
    const isQuote = String(thread.media_type).toUpperCase() === "QUOTE_POST" || !!thread.quoted_post || !!thread.is_quote_post;
    return {
      id: thread.id,
      text: thread.text || "",
      url: thread.permalink || "",
      publishedAt: thread.timestamp,
      isRepost,
      isQuote,
      eventType: isRepost ? "repost" : isQuote ? "quote" : "post",
      media: thread.media_url
        ? [
            {
              type:
                String(thread.media_type || "").toLowerCase() === "video"
                  ? "video"
                  : "image",
              url: thread.media_url,
              thumbnailUrl: thread.thumbnail_url || thread.media_url,
            },
          ]
        : [],
      raw: thread.raw || thread,
    };
  });
};

// const findLinkedInReaderAccount = async (monitored) => {
//   const accountId =
//     monitored.sourceConnectedAccountId ||
//     monitored.metadata?.connectedAccountId ||
//     monitored.metadata?.readerAccountId;

//   // 1. If a specific connected account is designated, check user first, then globally
//   if (accountId) {
//     let acc = await LinkedinModel.findOne({
//       userId: monitored.userId,
//       $or: [{ linkedInId: accountId }, { _id: accountId }],
//     });
//     if (acc) return acc;

//     acc = await LinkedinModel.findOne({
//       $or: [{ linkedInId: accountId }, { _id: accountId }],
//     });
//     if (acc) return acc;
//   }

//   // 2. If the monitored account platformAccountId is connected anywhere, use its token to poll
//   let cleanId = monitored.platformAccountId;
//   if (cleanId.startsWith("urn:li:person:")) {
//     cleanId = cleanId.replace("urn:li:person:", "");
//   } else if (cleanId.startsWith("urn:li:organization:")) {
//     cleanId = cleanId.replace("urn:li:organization:", "");
//   }

//   let acc = await LinkedinModel.findOne({
//     $or: [
//       { linkedInId: cleanId },
//       { organizationId: cleanId },
//       { organizationId: `urn:li:organization:${cleanId}` },
//     ],
//   });
//   if (acc) return acc;

//   // 3. Fallback to current user's last connected account
//   return LinkedinModel.findOne({ userId: monitored.userId }).sort({
//     createdAt: -1,
//   });
// };

const findLinkedInReaderAccount = async (monitored) => {
  // 🚨 THE FIX: Hard-block ALL Personal Profiles from the official API poller
  if (String(monitored.platformAccountId).includes("urn:li:person")) {
      throw new Error("Not allowed for personal accounts.");
  }

  const accountId =
    monitored.sourceConnectedAccountId ||
    monitored.metadata?.connectedAccountId ||
    monitored.metadata?.readerAccountId;

  // 1. Check for specifically designated account
  if (accountId) {
    const isIdValid = /^[0-9a-fA-F]{24}$/.test(accountId);
    let acc = await LinkedinModel.findOne({
      userId: monitored.userId,
      ...(isIdValid
        ? { $or: [{ linkedInId: accountId }, { _id: accountId }] }
        : { linkedInId: accountId }),
    });
    if (acc) return acc;

    acc = await LinkedinModel.findOne({
      ...(isIdValid
        ? { $or: [{ linkedInId: accountId }, { _id: accountId }] }
        : { linkedInId: accountId }),
    });
    if (acc) return acc;
  }

  // 2. Try to find the exact token for this profile under current user first
  let cleanId = monitored.platformAccountId;
  if (cleanId.startsWith("urn:li:person:")) {
    cleanId = cleanId.replace("urn:li:person:", "");
  } else if (cleanId.startsWith("urn:li:organization:")) {
    cleanId = cleanId.replace("urn:li:organization:", "");
  }

  let acc = await LinkedinModel.findOne({
    userId: monitored.userId,
    $or: [
      { linkedInId: cleanId },
      { organizationId: cleanId },
      { organizationId: `urn:li:organization:${cleanId}` },
    ],
  });
  if (acc) return acc;

  // 3. Try to find globally if not found under current user
  acc = await LinkedinModel.findOne({
    $or: [
      { linkedInId: cleanId },
      { organizationId: cleanId },
      { organizationId: `urn:li:organization:${cleanId}` },
    ],
  });
  if (acc) return acc;

  // 4. Safe Fallback for Company Pages (Uses the admin's connected token)
  return LinkedinModel.findOne({ userId: monitored.userId }).sort({
    createdAt: -1,
  });
};


const pollLinkedInAuthor = async (monitored, options = {}) => {
  let authorUrn = normalizeId(
    monitored.metadata?.authorUrn || monitored.platformAccountId,
  );
  if (!authorUrn.startsWith("urn:li:")) {
    if (/^\d+$/.test(authorUrn)) {
      authorUrn = `urn:li:organization:${authorUrn}`;
    } else {
      authorUrn = `urn:li:person:${authorUrn}`;
    }
  }

  const account = await findLinkedInReaderAccount(monitored);
  if (!account)
    throw new Error(
      "LinkedIn monitoring requires a connected LinkedIn reader account",
    );

  const params = {
    q: "author",
    author: authorUrn,
    count: String(Math.min(Math.max(Number(options.maxResults || 10), 1), 100)),
  };

  if (authorUrn.startsWith("urn:li:person:")) {
    params.viewContext = "AUTHOR";
  }
console.log("Polling LinkedIn author:", authorUrn, "using account:", account.linkedInId,"accessToken:",account.accessToken);
  const validToken = await getValidLinkedInToken(account);
  const response = await axios.get("https://api.linkedin.com/rest/posts", {
    headers: {
      Authorization: `Bearer ${validToken}`,
      "LinkedIn-Version": monitored.metadata?.linkedInVersion || "202605",
      "X-Restli-Protocol-Version": "2.0.0",
    },
    params: new URLSearchParams(params),
  });

  return (response.data?.elements || []).map((post) => {
    const media = [];
    if (post.content) {
      const c = post.content;
      // Multi image
      if (c.multiImage && Array.isArray(c.multiImage.images)) {
        c.multiImage.images.forEach((img) => {
          const u = img.url || img.thumbnail;
          if (u) {
            media.push({ type: "image", url: u, thumbnailUrl: u });
          }
        });
      }
      // Single image
      const imageUrl = c.media?.url || c.media?.thumbnail || c.image?.url || c.image?.thumbnail;
      if (imageUrl && !media.some((m) => m.url === imageUrl)) {
        media.push({ type: "image", url: imageUrl, thumbnailUrl: imageUrl });
      }
      // Article thumbnail
      const articleThumbnail = c.article?.thumbnail || c.article?.url;
      if (articleThumbnail && !media.some((m) => m.url === articleThumbnail)) {
        if (c.article?.thumbnail) {
          media.push({ type: "image", url: c.article.thumbnail, thumbnailUrl: c.article.thumbnail });
        }
      }
      // Video
      const videoUrl = c.video?.url || c.video?.thumbnail;
      if (videoUrl && !media.some((m) => m.url === videoUrl)) {
        media.push({
          type: "video",
          url: c.video?.url || videoUrl,
          thumbnailUrl: c.video?.thumbnail || videoUrl,
        });
      }
    }

    return {
      id: post.id || post.urn,
      text: post.commentary || post.text || "",
      url: post.content?.article?.source || post.content?.media?.url || "",
      publishedAt: post.publishedAt
        ? new Date(Number(post.publishedAt)).toISOString()
        : new Date().toISOString(),
      media,
      raw: post,
    };
  });
};

export const pollMonitoredAccount = async ({
  monitoredAccountId,
  userId = null,
  options = {},
}) => {
  const monitored = await SocialMonitoredAccount.findOne({
    _id: monitoredAccountId,
    ...(userId ? { userId } : {}),
    monitorEnabled: true,
  });
  if (!monitored) throw new Error("Enabled monitored account not found");

  let posts = [];
  switch (monitored.platform) {
    case "twitter":
      posts = await pollTwitterRecentSearch(monitored, options);
      break;
    case "youtube":
      await subscribeToYouTubeChannel({
        channelId: monitored.platformAccountId,
      });
      return {
        monitoredAccountId: monitored._id,
        platform: monitored.platform,
        found: 0,
        ingested: 0,
        mode: "websub",
        message:
          "YouTube monitoring uses WebSub push notifications; subscription requested.",
      };
    case "pinterest":
      posts = await pollPinterestBoard(monitored, options);
      break;
    case "threads":
      posts = await pollThreadsConnectedAccount(monitored, options);
      break;
    case "linkedin":
      posts = await pollLinkedInAuthor(monitored, options);
      break;
    case "facebook":
    case "instagram":
      throw new Error(
        `${monitored.platform} monitoring is waiting for approved Meta permissions`,
      );
    default:
      throw new Error(`Unsupported monitoring platform ${monitored.platform}`);
  }

  const lastSeen = normalizeId(monitored.lastSeenPostId);
  const freshPosts = lastSeen
    ? posts.filter((post) => normalizeId(post.id) !== lastSeen)
    : posts;

  const ingested = await ingestPostsForMonitoredAccount({
    monitored,
    posts: freshPosts,
  });

  return {
    monitoredAccountId: monitored._id,
    platform: monitored.platform,
    found: posts.length,
    ingested: ingested.length,
    results: ingested,
  };
};

export const pollAllMonitoredAccounts = async ({
  platform = null,
  userId = null,
  options = {},
} = {}) => {
  const accounts = await SocialMonitoredAccount.find({
    monitorEnabled: true,
    ...(platform ? { platform } : {}),
    ...(userId ? { userId } : {}),
  }).sort({ updatedAt: 1 });

  const filteredAccounts = accounts.filter((account) => {
    if (account.platform === "linkedin") {
      const isLinkedInPerson =
        String(account.platformAccountId).startsWith("urn:li:person:") ||
        String(account.metadata?.authorUrn || "").startsWith("urn:li:person:") ||
        String(account.profileUrl || "").includes("/in/") ||
        String(account.profileUrl || "").includes("linkedin.com/in/");
      return !isLinkedInPerson;
    }
    return true;
  });

  const results = [];
  for (const account of filteredAccounts) {
    try {
      results.push(
        await pollMonitoredAccount({
          monitoredAccountId: account._id,
          userId: account.userId,
          options,
        }),
      );
    } catch (err) {
      logger.warn("Social automation monitored account poll failed", {
        monitoredAccountId: String(account._id),
        platform: account.platform,
        error: err.message,
        details: err?.response?.data || null,
      });
      results.push({
        monitoredAccountId: account._id,
        platform: account.platform,
        found: 0,
        ingested: 0,
        error: err.message,
      });
    }
  }

  return {
    scanned: filteredAccounts.length,
    results,
  };
};

export { AUTOMATION_SOURCE_POLL_JOB, YOUTUBE_WEBSUB_RENEW_JOB };
