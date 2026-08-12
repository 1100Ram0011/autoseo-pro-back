import axios from "axios";
import mongoose from "mongoose";
import { google } from "googleapis";
import { TwitterApi } from "twitter-api-v2";
import config from "../config/config.js";
import logger from "../config/logger.js";
import { socialAutomationQueue } from "../queue/index.js";
import { decrypt, encrypt } from "../utils/crypto.js";
import socketService from "../socket.js";
import SocialMonitoredAccount from "../models/SocialMonitoredAccount.js";
import SocialAutomationRule from "../models/SocialAutomationRule.js";
import SocialAutomationEvent from "../models/SocialAutomationEvent.js";
import SocialAutomationDraft from "../models/SocialAutomationDraft.js";
import SocialAutomationRun from "../models/SocialAutomationRun.js";
import YoutubeModal from "../models/YoutubeModal.js";
import TwitterModal from "../models/TwitterModal.js";
import ThreadsAccount from "../models/ThreadsAccount.js";
import PinterestModal from "../models/PinterestModal.js";
import LinkedinModel from "../models/LinkedinModel.js";
import FacebookAccount from "../models/FacebookAccount.js";
import InstagramAccount from "../models/InstagramAccount.js";
import { createTextPost as createLinkedInTextPost } from "./linkedin.service.js";
import { getValidLinkedInToken } from "../controllers/SocialMedia/linkedin.controller.js";
import { runClaudePostContentGeneration } from "./claude.service.js";
import { resolveYouTubeChannelIdentifier } from "./youtubeChannelResolver.service.js";
import userModel from "../models/userModel.js";
import BusinessSummaryProfileSchema from "../models/BusinessSummaryProfile.js";
import IndividualAnalysisSchema from "../models/IndividualAnalysisProfile.js";
import { deductDynamicCredit } from "../utils/creditTracker.js";
import { ServiceCostConfig } from "../models/credits/index.js";
import { assertDynamicSocialAnalyticsCredit } from "../utils/socialAnalyticsCredit.js";

const resolveLinkedInIdentifier = async (userId, rawId) => {
  if (rawId.startsWith("urn:li:")) return rawId;
  if (/^\d+$/.test(rawId)) return `urn:li:organization:${rawId}`;

  let cleanId = rawId.trim();
  const companyMatch = cleanId.match(/linkedin\.com\/company\/([^/?]+)/);
  const profileMatch = cleanId.match(/linkedin\.com\/in\/([^/?]+)/);

  if (profileMatch) {
    cleanId = profileMatch[1];
  }

  if (companyMatch) {
    cleanId = companyMatch[1];
  }

  if (/^\d+$/.test(cleanId)) {
    return `urn:li:organization:${cleanId}`;
  }

  // 1. Try to find a matching connected account under current user
  let connected = await LinkedinModel.findOne({
    userId,
    $or: [
      { linkedInId: cleanId },
      { name: new RegExp(`^${cleanId.replace(/[-_]/g, " ")}$`, "i") },
      { name: new RegExp(`^${cleanId}$`, "i") },
      { organizationId: cleanId },
      { organizationVanityName: new RegExp(`^${cleanId}$`, "i") },
    ],
  });

  // 2. Try to search globally across all connected accounts if not found under current user
  if (!connected) {
    connected = await LinkedinModel.findOne({
      $or: [
        { linkedInId: cleanId },
        { name: new RegExp(`^${cleanId.replace(/[-_]/g, " ")}$`, "i") },
        { name: new RegExp(`^${cleanId}$`, "i") },
        { organizationId: cleanId },
        { organizationVanityName: new RegExp(`^${cleanId}$`, "i") },
      ],
    });
  }

  // 3. Try stripping trailing alphanumeric suffix (e.g. -7b7a5...) from vanity name and search under current user
  if (!connected && (profileMatch || companyMatch)) {
    const cleanVanity = cleanId.replace(/-[a-fA-F0-9]+$/, "");
    const nameQuery = cleanVanity.replace(/[-_]/g, " ");

    connected = await LinkedinModel.findOne({
      userId,
      $or: [
        { name: new RegExp(`^${nameQuery}$`, "i") },
        { organizationName: new RegExp(`^${nameQuery}$`, "i") },
        { organizationVanityName: new RegExp(`^${cleanVanity}$`, "i") },
      ],
    });
  }

  // 4. Try stripping trailing alphanumeric suffix (e.g. -7b7a5...) from vanity name and search globally
  if (!connected && (profileMatch || companyMatch)) {
    const cleanVanity = cleanId.replace(/-[a-fA-F0-9]+$/, "");
    const nameQuery = cleanVanity.replace(/[-_]/g, " ");

    connected = await LinkedinModel.findOne({
      $or: [
        { name: new RegExp(`^${nameQuery}$`, "i") },
        { organizationName: new RegExp(`^${nameQuery}$`, "i") },
        { organizationVanityName: new RegExp(`^${cleanVanity}$`, "i") },
      ],
    });
  }

  if (connected) {
    if (connected.accountType === "organization") {
      return connected.organizationId.startsWith("urn:li:")
        ? connected.organizationId
        : `urn:li:organization:${connected.organizationId}`;
    } else {
      return connected.linkedInId.startsWith("urn:li:")
        ? connected.linkedInId
        : `urn:li:person:${connected.linkedInId}`;
    }
  }

  // 2. If it was a company URL and not connected, resolve via LinkedIn API
  if (companyMatch) {
    const vanityName = companyMatch[1];
    const account = await LinkedinModel.findOne({ userId, accountType: "profile" }).sort({
      createdAt: -1,
    });
    if (!account) {
      throw new Error(
        "Please connect a LinkedIn account first to resolve company URLs.",
      );
    }

    try {
      const validToken = await getValidLinkedInToken(account);
      const response = await axios.get(
        "https://api.linkedin.com/rest/organizations",
        {
          params: { q: "vanityName", vanityName },
          headers: {
            Authorization: `Bearer ${validToken}`,
            "LinkedIn-Version": "202605",
            "X-Restli-Protocol-Version": "2.0.0",
          },
        },
      );

      const elements = response.data?.elements || [];
      if (elements.length > 0) {
        const id = elements[0].id || elements[0].urn;
        return String(id).startsWith("urn:li:")
          ? id
          : `urn:li:organization:${id}`;
      }
      throw new Error(
        `LinkedIn company page not found for vanity name: ${vanityName}`,
      );
    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        throw new Error(
          "Your connected LinkedIn account does not have permission to resolve this company page. Please provide the exact numeric ID.",
        );
      }
      throw new Error(
        `Failed to resolve LinkedIn company URL: ${error.response?.data?.message || error.message}`,
      );
    }
  }

  // 3. Fallback: If personal profile URL was entered but could not be matched
  if (profileMatch) {
    throw new Error(
      "This LinkedIn personal profile is not connected to your account. Personal profile URLs can only be resolved if the account is connected, or by entering the exact numeric ID/URN.",
    );
  }

  // 4. Try to resolve raw alphanumeric cleanId as a company vanity name via API
  if (!cleanId.startsWith("urn:li:") && /^[a-zA-Z0-9-_]+$/.test(cleanId)) {
    const account = await LinkedinModel.findOne({ userId, accountType: "profile" }).sort({
      createdAt: -1,
    });
    if (account) {
      try {
        const validToken = await getValidLinkedInToken(account);
        const response = await axios.get(
          "https://api.linkedin.com/rest/organizations",
          {
            params: { q: "vanityName", vanityName: cleanId },
            headers: {
              Authorization: `Bearer ${validToken}`,
              "LinkedIn-Version": "202605",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          },
        );

        const elements = response.data?.elements || [];
        if (elements.length > 0) {
          const id = elements[0].id || elements[0].urn;
          return String(id).startsWith("urn:li:")
            ? id
            : `urn:li:organization:${id}`;
        }
      } catch (e) {
        // ignore and let it fallback/error below
      }
    }
  }

  // 5. Enforce URN validation
  if (!cleanId.startsWith("urn:li:")) {
    throw new Error(
      `Could not resolve "${rawId}" to a valid LinkedIn URN. Please enter a valid company URL (e.g. linkedin.com/company/name), a valid URN (e.g. urn:li:organization:123), or numeric ID.`
    );
  }

  return cleanId;
};

const X_OAUTH2_TOKEN_URL = "https://api.x.com/2/oauth2/token";
const THREADS_API_BASE = "https://graph.threads.net/v1.0";
const PINTEREST_API_BASE =
  process.env.PINTEREST_ENV === "sandbox"
    ? "https://api-sandbox.pinterest.com/v5"
    : "https://api.pinterest.com/v5";

const TWITTER_OAUTH2_CLIENT_ID =
  config.TWITTER_OAUTH2_CLIENT_ID || config.TWITTER_API_KEY;
const TWITTER_OAUTH2_CLIENT_SECRET =
  config.TWITTER_OAUTH2_CLIENT_SECRET || config.TWITTER_API_SECRET;

const normalizePlatform = (platform) =>
  String(platform || "")
    .trim()
    .toLowerCase();
const normalizeId = (value) => String(value || "").trim();
const isObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(String(value || ""));

const humanDelay = () =>
  new Promise((resolve) =>
    setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000),
  );

const emitToUser = (userId, event, payload) => {
  try {
    socketService.emitToUser(String(userId), event, payload);
  } catch (err) {
    logger.warn("social automation socket emit failed", {
      userId: String(userId),
      event,
      error: err.message,
    });
  }
};

const buildAccountQuery = ({ userId, platform, accountId }) => {
  const id = normalizeId(accountId);
  const objectIdMatcher = isObjectId(id) ? { _id: id } : null;

  const platformMatchers = {
    youtube: [{ channelId: id }],
    twitter: [{ twitterId: id }],
    threads: [{ threadsUserId: id }, { threadsId: id }],
    pinterest: [{ pinterestId: id }],
    linkedin: [{ linkedInId: id }],
    facebook: [{ pageId: id }],
    instagram: [{ instagramId: id }],
  };

  const matchers = platformMatchers[platform] || [];
  if (objectIdMatcher) matchers.push(objectIdMatcher);

  return { userId, $or: matchers };
};

const getAccountModel = (platform) => {
  switch (platform) {
    case "youtube":
      return YoutubeModal;
    case "twitter":
      return TwitterModal;
    case "threads":
      return ThreadsAccount;
    case "pinterest":
      return PinterestModal;
    case "linkedin":
      return LinkedinModel;
    case "facebook":
      return FacebookAccount;
    case "instagram":
      return InstagramAccount;
    default:
      return null;
  }
};

export const findConnectedSocialAccount = async ({
  userId,
  platform,
  accountId,
}) => {
  const normalizedPlatform = normalizePlatform(platform);
  const Model = getAccountModel(normalizedPlatform);
  if (!Model) return null;

  return Model.findOne(
    buildAccountQuery({
      userId,
      platform: normalizedPlatform,
      accountId,
    }),
  );
};

export const assertConnectedDestinationAccount = async ({
  userId,
  destination,
}) => {
  const platform = normalizePlatform(destination?.platform);
  const accountId = normalizeId(destination?.accountId);

  if (!platform || !accountId) {
    throw new Error(
      "destination.platform and destination.accountId are required",
    );
  }

  const account = await findConnectedSocialAccount({
    userId,
    platform,
    accountId,
  });
  if (!account) {
    throw new Error(`Destination ${platform} account is not connected`);
  }

  return account;
};

export const listMonitoredAccounts = async ({ userId, query = {} }) => {
  const filter = { userId };
  if (query.platform) filter.platform = normalizePlatform(query.platform);
  if (query.monitorEnabled !== undefined) {
    filter.monitorEnabled = String(query.monitorEnabled) === "true";
  }
  const accounts = await SocialMonitoredAccount.find(filter).sort({ createdAt: -1 });

  const populated = [];
  for (const account of accounts) {
    const doc = account.toObject();
    if (doc.platform === "linkedin" && (!doc.displayName || doc.displayName.startsWith("urn:li:"))) {
      let cleanId = doc.platformAccountId.replace("urn:li:person:", "").replace("urn:li:organization:", "");
      const connectedAcc = await LinkedinModel.findOne({
        $or: [
          { linkedInId: cleanId },
          { organizationId: cleanId },
          { linkedInId: doc.platformAccountId },
          { organizationId: doc.platformAccountId }
        ]
      });
      if (connectedAcc) {
        if (connectedAcc.accountType === "organization") {
          doc.displayName = connectedAcc.organizationName || connectedAcc.name || doc.displayName;
          doc.username = connectedAcc.organizationVanityName || doc.username;
        } else {
          doc.displayName = connectedAcc.name || doc.displayName;
        }
      }
    }
    populated.push(doc);
  }
  return populated;
};

export const upsertMonitoredAccount = async ({ userId, payload }) => {
  const platform = normalizePlatform(payload.platform);
  const rawPlatformAccountId = normalizeId(
    payload.platformAccountId || payload.accountId || payload.username,
  );

  if (!platform || !rawPlatformAccountId) {
    throw new Error("platform and platformAccountId are required");
  }

  let platformAccountId = rawPlatformAccountId;
  let youtubeChannel = null;
  let platformMetadata = {};

  if (platform === "youtube") {
    youtubeChannel =
      await resolveYouTubeChannelIdentifier(rawPlatformAccountId);
    platformAccountId = youtubeChannel.channelId;
    platformMetadata = youtubeChannel.metadata || {};
  } else if (platform === "linkedin") {
    platformAccountId = await resolveLinkedInIdentifier(
      userId,
      rawPlatformAccountId,
    );
    platformMetadata = { authorUrn: platformAccountId };
  } else if (platform === "twitter") {
    const handleMatch = String(rawPlatformAccountId).match(/(?:twitter|x)\.com\/([a-zA-Z0-9_]{1,15})/i);
    platformAccountId = (handleMatch ? handleMatch[1] : rawPlatformAccountId).replace(/^@/, "").trim();
  }

  const isConnectedAccount =
    Boolean(payload.isConnectedAccount) ||
    payload.sourceType === "connected_account";

  let username = payload.username || "";
  let profileUrl = payload.profileUrl || "";
  let displayName = payload.displayName || payload.name || "";

  if (platform === "twitter") {
    username = platformAccountId;
    profileUrl = `https://x.com/${platformAccountId}`;
    displayName = displayName || platformAccountId;

    const bearerToken = config.TWITTER_BEARER_TOKEN;
    if (bearerToken) {
      try {
        const checkRes = await axios.get(`https://api.x.com/2/users/by/username/${platformAccountId}`, {
          headers: { Authorization: `Bearer ${bearerToken}` },
        });
        if (checkRes.data?.errors || !checkRes.data?.data) {
          throw new Error(`Twitter/X account "@${platformAccountId}" not found.`);
        }
        displayName = checkRes.data.data.name || displayName;
        username = checkRes.data.data.username || platformAccountId;
        profileUrl = `https://x.com/${username}`;
      } catch (err) {
        if (err.response?.status === 400 || err.response?.status === 404 || err.message?.includes("not found")) {
          throw new Error(`Twitter/X account "@${platformAccountId}" does not exist.`);
        }
        logger.warn("X user validation lookup failed, proceeding without lookup:", err.message);
      }
    }
  } else if (platform === "youtube") {
    username = youtubeChannel?.handle || username;
    profileUrl = youtubeChannel?.profileUrl || profileUrl;
    displayName = displayName || youtubeChannel?.title || username;
  }

  const update = {
    userId,
    platform,
    platformAccountId,
    username: normalizeId(username),
    displayName: normalizeId(displayName),
    profileUrl: normalizeId(profileUrl),
    avatarUrl: normalizeId(
      payload.avatarUrl || payload.picture || youtubeChannel?.avatarUrl,
    ),
    sourceType:
      payload.sourceType ||
      (isConnectedAccount ? "connected_account" : "favorite"),
    sourceConnectedAccountId: normalizeId(payload.sourceConnectedAccountId),
    isConnectedAccount,
    monitorEnabled: payload.monitorEnabled !== false,
    metadata: {
      ...(payload.metadata || {}),
      ...(youtubeChannel?.metadata || {}),
      ...platformMetadata,
      ...(youtubeChannel?.description
        ? { youtubeDescription: youtubeChannel.description }
        : {}),
      ...(rawPlatformAccountId !== platformAccountId
        ? { originalPlatformAccountId: rawPlatformAccountId }
        : {}),
    },
  };

  if (platform === "linkedin") {
    let cleanId = platformAccountId.replace("urn:li:person:", "").replace("urn:li:organization:", "");
    const connectedAcc = await LinkedinModel.findOne({
      $or: [
        { linkedInId: cleanId },
        { organizationId: cleanId },
        { linkedInId: platformAccountId },
        { organizationId: platformAccountId }
      ]
    });
    if (connectedAcc) {
      if (connectedAcc.accountType === "organization") {
        update.displayName = update.displayName || connectedAcc.organizationName || connectedAcc.name;
        update.username = update.username || connectedAcc.organizationVanityName;
      } else {
        update.displayName = update.displayName || connectedAcc.name;
      }
    }
  }

  const existing =
    (await SocialMonitoredAccount.findOne({
      userId,
      platform,
      platformAccountId,
    })) ||
    (rawPlatformAccountId !== platformAccountId
      ? await SocialMonitoredAccount.findOne({
          userId,
          platform,
          platformAccountId: rawPlatformAccountId,
        })
      : null);

  if (existing) {
    await SocialMonitoredAccount.updateOne(
      { _id: existing._id },
      { $set: update },
    );
    return SocialMonitoredAccount.findById(existing._id);
  }

  return SocialMonitoredAccount.findOneAndUpdate(
    { userId, platform, platformAccountId },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
};

export const updateMonitoredAccount = async ({
  userId,
  monitoredAccountId,
  payload,
}) => {
  const update = {};
  [
    "username",
    "displayName",
    "profileUrl",
    "avatarUrl",
    "sourceType",
    "sourceConnectedAccountId",
    "isConnectedAccount",
    "monitorEnabled",
    "metadata",
  ].forEach((key) => {
    if (payload[key] !== undefined) update[key] = payload[key];
  });

  return SocialMonitoredAccount.findOneAndUpdate(
    { _id: monitoredAccountId, userId },
    { $set: update },
    { new: true },
  );
};

export const deleteMonitoredAccount = async ({
  userId,
  monitoredAccountId,
}) => {
  await SocialAutomationRule.updateMany(
    { userId, monitoredAccountId },
    { $set: { enabled: false } },
  );
  return SocialMonitoredAccount.deleteOne({ _id: monitoredAccountId, userId });
};

export const listAutomationRules = ({ userId, query = {} }) => {
  const filter = { userId };
  if (query.monitoredAccountId)
    filter.monitoredAccountId = query.monitoredAccountId;
  if (query.enabled !== undefined)
    filter.enabled = String(query.enabled) === "true";

  return SocialAutomationRule.find(filter)
    .populate("monitoredAccountId")
    .sort({ createdAt: -1 });
};

const validateAutomationRuleConfig = ({
  monitored,
  action,
  destination = {},
  autoLike = false,
}) => {
  const sourcePlatform = normalizePlatform(monitored?.platform);
  const destinationPlatform = normalizePlatform(
    destination.platform || sourcePlatform,
  );

  if (action === "notify_only") return;

  if (action === "auto_like" || autoLike) {
    if (
      ["threads", "pinterest", "facebook", "instagram"].includes(
        destinationPlatform,
      )
    ) {
      throw new Error(
        `The ${destinationPlatform} API does not support automated 'Like' actions.`,
      );
    }
  }

  if (destinationPlatform === "youtube") {
    if (
      sourcePlatform !== "youtube" ||
      !["auto_comment", "auto_like"].includes(action)
    ) {
      throw new Error(
        "YouTube destinations only support auto_comment or auto_like on YouTube source videos",
      );
    }
    return;
  }

  if (sourcePlatform === "youtube") {
    if (action === "auto_comment" || action === "auto_like") {
      throw new Error(
        `YouTube video ${action.replace("auto_", "")}s must use a connected YouTube destination account`,
      );
    }

    if (action === "create_draft") {
      const draftDestinations = ["twitter", "linkedin", "threads"];
      if (!draftDestinations.includes(destinationPlatform)) {
        throw new Error(
          "YouTube source drafts can only be sent to Twitter, LinkedIn, or Threads",
        );
      }
      return;
    }

    throw new Error(
      "YouTube sources support notify_only, auto_comment/auto_like to YouTube, or create_draft to Twitter/LinkedIn/Threads",
    );
  }
};

export const createAutomationRule = async ({ userId, payload }) => {
  const monitored = await SocialMonitoredAccount.findOne({
    _id: payload.monitoredAccountId,
    userId,
  });

  if (!monitored) {
    throw new Error("Monitored account not found");
  }

  const action = payload.action;
  const destination = {
    platform: normalizePlatform(
      payload.destination?.platform || monitored.platform,
    ),
    accountId: normalizeId(
      payload.destination?.accountId ||
        (action === "notify_only" ? monitored.platformAccountId : ""),
    ),
    connectionId: normalizeId(payload.destination?.connectionId),
    boardId: normalizeId(payload.destination?.boardId),
  };

  validateAutomationRuleConfig({
    monitored,
    action,
    destination,
    autoLike: payload.autoLike,
  });

  if (payload.action !== "notify_only") {
    await assertConnectedDestinationAccount({
      userId,
      destination,
    });
  }

  return SocialAutomationRule.create({
    userId,
    monitoredAccountId: monitored._id,
    name: payload.name || "",
    destination,
    action,
    requireApproval: payload.requireApproval !== false,
    enabled: payload.enabled !== false,
    autoLike: Boolean(payload.autoLike),
    aiCaptionEnabled: Boolean(payload.aiCaptionEnabled),
    commentTemplate: payload.commentTemplate || "",
    quoteTemplate: payload.quoteTemplate || "",
    filters: payload.filters || undefined,
    limits: payload.limits || undefined,
    metadata: payload.metadata || {},
  });
};

export const updateAutomationRule = async ({ userId, ruleId, payload }) => {
  const existingRule = await SocialAutomationRule.findOne({
    _id: ruleId,
    userId,
  });
  if (!existingRule) return null;

  const monitored = await SocialMonitoredAccount.findOne({
    _id: existingRule.monitoredAccountId,
    userId,
  });
  if (!monitored) throw new Error("Monitored account not found");

  const allowed = [
    "name",
    "destination",
    "action",
    "requireApproval",
    "enabled",
    "autoLike",
    "aiCaptionEnabled",
    "commentTemplate",
    "quoteTemplate",
    "filters",
    "limits",
    "metadata",
  ];
  const update = {};
  allowed.forEach((key) => {
    if (payload[key] !== undefined) update[key] = payload[key];
  });
  if (update.destination?.platform) {
    update.destination.platform = normalizePlatform(
      update.destination.platform,
    );
  }

  const nextAction = update.action || existingRule.action;
  const nextDestination = {
    ...(existingRule.destination?.toObject?.() ||
      existingRule.destination ||
      {}),
    ...(update.destination || {}),
  };
  nextDestination.platform = normalizePlatform(
    nextDestination.platform || monitored.platform,
  );
  nextDestination.accountId = normalizeId(
    nextDestination.accountId ||
      (nextAction === "notify_only" ? monitored.platformAccountId : ""),
  );
  const nextEnabled =
    update.enabled !== undefined ? update.enabled : existingRule.enabled;
  const nextAutoLike =
    update.autoLike !== undefined ? update.autoLike : existingRule.autoLike;

  if (nextEnabled !== false) {
    validateAutomationRuleConfig({
      monitored,
      action: nextAction,
      destination: nextDestination,
      autoLike: nextAutoLike,
    });

    if (nextAction !== "notify_only") {
      await assertConnectedDestinationAccount({
        userId,
        destination: nextDestination,
      });
    }
  }

  return SocialAutomationRule.findOneAndUpdate(
    { _id: ruleId, userId },
    { $set: update },
    { new: true },
  );
};

const normalizeEventMedia = (media = []) =>
  (Array.isArray(media) ? media : [])
    .map((item) => {
      const isStr = typeof item === "string";
      const itemUrl = isStr ? item : item?.url;
      const itemThumb = isStr ? item : (item?.thumbnailUrl || item?.url);
      return {
        type: ["image", "video", "link"].includes(
          String(item?.type || "").toLowerCase(),
        )
          ? String(item.type).toLowerCase()
          : "image",
        url: normalizeId(itemUrl),
        thumbnailUrl: normalizeId(itemThumb),
      };
    })
    .filter((item) => item.url);

const shouldSkipByRuleFilter = ({ rule, event }) => {
  const text = String(event.text || "").toLowerCase();
  const filters = rule.filters || {};

  if (filters.ignoreReplies && event.rawPayload?.isReply) {
    return "reply event ignored by rule filter";
  }

  if (filters.ignoreReposts && event.rawPayload?.isRepost) {
    return "repost event ignored by rule filter";
  }

  const keywords = (filters.keywords || [])
    .map((item) => String(item).toLowerCase())
    .filter(Boolean);
  if (keywords.length && !keywords.some((keyword) => text.includes(keyword))) {
    return "event does not match required keywords";
  }

  const excluded = (filters.excludedKeywords || [])
    .map((item) => String(item).toLowerCase())
    .filter(Boolean);
  if (excluded.some((keyword) => text.includes(keyword))) {
    return "event contains an excluded keyword";
  }

  return null;
};

const enqueueRuleRun = async ({ rule, event }) => {
  const skipReason = shouldSkipByRuleFilter({ rule, event });
  const run = await SocialAutomationRun.findOneAndUpdate(
    { eventId: event._id, ruleId: rule._id },
    {
      $setOnInsert: {
        userId: event.userId,
        ruleId: rule._id,
        eventId: event._id,
        action: rule.action,
        destination: rule.destination,
        status: skipReason ? "skipped" : "pending",
        error: skipReason || "",
        finishedAt: skipReason ? new Date() : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  if (!skipReason && run.status === "pending") {
    await socialAutomationQueue.add(
      "execute-rule",
      { runId: run._id.toString() },
      { jobId: `social-automation-${run._id}` },
    );
  }

  return run;
};

export const processAutomationEvent = async ({ eventId, userId = null }) => {
  const event = await SocialAutomationEvent.findOne({
    _id: eventId,
    ...(userId ? { userId } : {}),
  });
  if (!event) throw new Error("Automation event not found");

  const monitored = await SocialMonitoredAccount.findOne({
    _id: event.monitoredAccountId,
    userId: event.userId,
    monitorEnabled: true,
  });

  if (!monitored) {
    event.status = "skipped";
    event.error = "Monitored account disabled or not found";
    await event.save();
    return [];
  }

  const rules = await SocialAutomationRule.find({
    userId: event.userId,
    monitoredAccountId: event.monitoredAccountId,
    enabled: true,
  });

  if (!rules.length) {
    event.status = "skipped";
    event.error = "No enabled automation rules matched this source";
    await event.save();
    return [];
  }

  const runs = [];
  for (const rule of rules) {
    runs.push(await enqueueRuleRun({ rule, event }));
  }

  event.status = "queued";
  await event.save();

  return runs;
};

export const ingestAutomationEvent = async ({
  userId,
  payload,
  autoProcess = true,
}) => {
  const platform = normalizePlatform(payload.platform);
  const source = payload.sourceAccount || {};
  const post = payload.post || payload;

  const sourcePlatformAccountId = normalizeId(
    payload.sourcePlatformAccountId ||
      source.platformAccountId ||
      source.accountId ||
      source.id ||
      source.username,
  );
  const externalPostId = normalizeId(
    post.externalPostId || post.postId || post.id,
  );

  if (!platform || !sourcePlatformAccountId || !externalPostId) {
    throw new Error("platform, source account id, and post id are required");
  }

  let monitored;
  if (payload.monitoredAccountId) {
    monitored = await SocialMonitoredAccount.findOne({
      _id: payload.monitoredAccountId,
      userId,
    });
    if (!monitored) throw new Error("Monitored account not found");
  } else {
    monitored = await upsertMonitoredAccount({
      userId,
      payload: {
        platform,
        platformAccountId: sourcePlatformAccountId,
        username: source.username,
        displayName: source.displayName || source.name,
        profileUrl: source.profileUrl,
        avatarUrl: source.avatarUrl || source.picture,
        sourceType: source.sourceType || payload.sourceType || "following",
        sourceConnectedAccountId: source.sourceConnectedAccountId || "",
        isConnectedAccount: Boolean(source.isConnectedAccount),
        monitorEnabled: true,
        metadata: source.metadata || {},
      },
    });
  }

  const existing = await SocialAutomationEvent.findOne({
    userId,
    platform,
    sourcePlatformAccountId,
    externalPostId,
  });

  if (existing) {
    return { event: existing, duplicate: true, runs: [] };
  }

  const event = await SocialAutomationEvent.create({
    userId,
    monitoredAccountId: monitored._id,
    platform,
    sourcePlatformAccountId,
    sourceUsername: source.username || monitored.username || "",
    externalPostId,
    postUrl: normalizeId(post.postUrl || post.url || post.permalink),
    text: post.text || post.caption || post.title || "",
    media: normalizeEventMedia(post.media || post.mediaUrls),
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : new Date(),
    isReply: Boolean(payload.isReply || post.isReply),
    isRepost: Boolean(payload.isRepost || post.isRepost),
    eventType: payload.eventType || post.eventType || (payload.isReply || post.isReply ? "comment" : (payload.isRepost || post.isRepost ? "repost" : "post")),
    rawPayload: payload.rawPayload || payload,
  });

  await SocialMonitoredAccount.updateOne(
    { _id: monitored._id },
    {
      $set: {
        lastSeenPostId: externalPostId,
        lastSeenAt: event.publishedAt || new Date(),
      },
    },
  );

  const runs = autoProcess
    ? await processAutomationEvent({ eventId: event._id })
    : [];
  return { event, duplicate: false, runs };
};

const renderTemplate = (template, { event, monitored }) => {
  const sourceName =
    monitored?.displayName ||
    monitored?.username ||
    event.sourceUsername ||
    "this account";
  return String(template || "")
    .replaceAll("{{sourceName}}", sourceName)
    .replaceAll(
      "{{sourceUsername}}",
      monitored?.username || event.sourceUsername || "",
    )
    .replaceAll("{{postText}}", event.text || "")
    .replaceAll("{{postUrl}}", event.postUrl || "")
    .trim();
};

export const appendPostUrlIfNeeded = (text, postUrl) => {
  if (!postUrl) return text || "";
  const cleanText = String(text || "").trim();
  if (!cleanText) return postUrl;
  if (cleanText.includes(postUrl)) return cleanText;
  return `${cleanText}\n\n${postUrl}`;
};

const defaultAutomationText = ({ rule, event, monitored }) => {
  const sourceName =
    monitored?.displayName ||
    monitored?.username ||
    event.sourceUsername ||
    "this account";
  const postUrl = event.postUrl ? `\n\nOriginal: ${event.postUrl}` : "";

  if (rule.action === "auto_repost") {
    return event.text || "";
  }

  if (rule.action === "auto_comment") {
    return (
      renderTemplate(rule.commentTemplate, { event, monitored }) ||
      "Great update. Thanks for sharing."
    );
  }

  if (["auto_quote", "create_draft"].includes(rule.action)) {
    return (
      renderTemplate(rule.quoteTemplate || rule.commentTemplate, { event, monitored }) ||
      `Useful update from ${sourceName}.${postUrl}`
    );
  }

  return event.postUrl || "";
};

const generateAutomationText = async ({ rule, event, monitored }) => {
  const fallback = defaultAutomationText({ rule, event, monitored });

  if (
    !rule.aiCaptionEnabled ||
    !["auto_quote", "create_draft", "auto_repost"].includes(rule.action) ||
    (rule.action === "auto_repost" && rule.destination?.platform === "threads")
  ) {
    return fallback;
  }

  try {
    const result = await runClaudePostContentGeneration({
      userPrompt:
        "Write a short professional social media caption that references the original post without copying it. Include the original link when available.",
      mediaType: "image",
      businessContext: {
        sourceName:
          monitored?.displayName || monitored?.username || event.sourceUsername,
        platform: event.platform,
      },
      businessURL: event.postUrl || "",
      businessData: {
        originalPostText: event.text || "",
        originalPostUrl: event.postUrl || "",
      },
    });

    return result?.description || fallback;
  } catch (err) {
    logger.warn(
      "AI caption generation failed, using fallback automation text",
      {
        ruleId: String(rule._id),
        eventId: String(event._id),
        error: err.message,
      },
    );
    return fallback;
  }
};

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

const refreshTwitterOAuth2AccessToken = async (account) => {
  const response = await axios.post(
    X_OAUTH2_TOKEN_URL,
    new URLSearchParams({
      client_id: TWITTER_OAUTH2_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: decrypt(account.oauth2RefreshToken),
    }),
    { headers: getTwitterOAuth2TokenHeaders() },
  );

  const tokenData = response.data;
  const update = {
    oauth2AccessToken: encrypt(tokenData.access_token),
    oauth2ExpiresAt: tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : account.oauth2ExpiresAt,
  };
  if (tokenData.refresh_token)
    update.oauth2RefreshToken = encrypt(tokenData.refresh_token);
  if (tokenData.scope)
    update.oauth2Scopes = String(tokenData.scope).split(/\s+/).filter(Boolean);

  await TwitterModal.updateOne({ _id: account._id }, { $set: update });
  return tokenData.access_token;
};

const getTwitterAccessToken = async (account) => {
  if (!account.oauth2AccessToken) return null;
  const expiresAt = account.oauth2ExpiresAt
    ? new Date(account.oauth2ExpiresAt).getTime()
    : 0;
  const shouldRefresh = expiresAt && expiresAt < Date.now() + 2 * 60 * 1000;
  if (!shouldRefresh || !account.oauth2RefreshToken)
    return decrypt(account.oauth2AccessToken);
  return refreshTwitterOAuth2AccessToken(account);
};

const buildTwitterClient = async (account) => {
  if (account.oauth2AccessToken) {
    const oauth2AccessToken = await getTwitterAccessToken(account);
    if (oauth2AccessToken) {
      return {
        client: new TwitterApi(oauth2AccessToken),
        bearer: oauth2AccessToken,
      };
    }
  }

  if (account.accessToken && account.accessSecret) {
    return {
      client: new TwitterApi({
        appKey: config.TWITTER_API_KEY,
        appSecret: config.TWITTER_API_SECRET,
        accessToken: decrypt(account.accessToken),
        accessSecret: decrypt(account.accessSecret),
      }),
      bearer: null,
    };
  }

  throw new Error("Twitter account is missing usable OAuth tokens");
};

const executeTwitterAction = async ({ account, rule, event, text }) => {
  const { client, bearer } = await buildTwitterClient(account);

  if (rule.action === "auto_like") {
    const like = await client.v2.like(
      account.twitterId,
      String(event.externalPostId),
    );
    return { externalPostId: event.externalPostId, raw: like?.data };
  }

  if (rule.action === "auto_comment") {
    const tweet = await client.v2.tweet({
      text,
      reply: { in_reply_to_tweet_id: String(event.externalPostId) },
    });

    if (rule.autoLike) {
      await humanDelay();
      await client.v2
        .like(account.twitterId, String(event.externalPostId))
        .catch((err) => {
          logger.warn("Twitter autoLike failed after comment", {
            error: err.message,
            eventId: event._id,
          });
        });
    }

    return { externalPostId: tweet?.data?.id, raw: tweet?.data };
  }

  if (rule.action === "auto_repost") {
    if (event.platform !== "twitter") {
      throw new Error(
        "Native X repost requires the source post to also be on X",
      );
    }

    if (client.v2.retweet) {
      const result = await client.v2.retweet(
        account.twitterId,
        String(event.externalPostId),
      );
      if (rule.autoLike) {
        await humanDelay();
        await client.v2
          .like(account.twitterId, String(event.externalPostId))
          .catch((err) => {
            logger.warn("Twitter autoLike failed after repost", {
              error: err.message,
              eventId: event._id,
            });
          });
      }
      return {
        externalPostId: event.externalPostId,
        raw: result?.data || result,
      };
    }

    if (!bearer) {
      throw new Error("X repost requires OAuth2 tweet.write access");
    }

    const result = await axios.post(
      `https://api.x.com/2/users/${account.twitterId}/retweets`,
      { tweet_id: String(event.externalPostId) },
      { headers: { Authorization: `Bearer ${bearer}` } },
    );
    if (rule.autoLike) {
      await humanDelay();
      await client.v2
        .like(account.twitterId, String(event.externalPostId))
        .catch((err) => {
          logger.warn("Twitter autoLike failed after repost", {
            error: err.message,
            eventId: event._id,
          });
        });
    }
    return { externalPostId: event.externalPostId, raw: result.data };
  }

  if (rule.action === "auto_quote") {
    const payload =
      event.platform === "twitter"
        ? { text, quote_tweet_id: String(event.externalPostId) }
        : { text: [text, event.postUrl].filter(Boolean).join("\n\n") };

    try {
      const tweet = await client.v2.tweet(payload);
      if (rule.autoLike) {
        await humanDelay();
        await client.v2
          .like(account.twitterId, String(event.externalPostId))
          .catch((err) => {
            logger.warn("Twitter autoLike failed after quote", {
              error: err.message,
              eventId: event._id,
            });
          });
      }
      return { externalPostId: tweet?.data?.id, raw: tweet?.data };
    } catch (err) {
      if (event.platform === "twitter") throw err;
      const tweet = await client.v2.tweet({
        text: [text, event.postUrl].filter(Boolean).join("\n\n").slice(0, 280),
      });
      if (rule.autoLike) {
        await humanDelay();
        await client.v2
          .like(account.twitterId, String(event.externalPostId))
          .catch((err) => {
            logger.warn("Twitter autoLike failed after quote fallback", {
              error: err.message,
              eventId: event._id,
            });
          });
      }
      return { externalPostId: tweet?.data?.id, raw: tweet?.data };
    }
  }

  throw new Error(`X does not support automation action ${rule.action}`);
};

const getYouTubeClient = async ({ userId, accountId }) => {
  const account = await findConnectedSocialAccount({
    userId,
    platform: "youtube",
    accountId,
  });
  if (!account) throw new Error("YouTube account not connected");

  const oauth2Client = new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.YOUTUBE_CALLBACK_URL,
  );

  oauth2Client.setCredentials({
    access_token: decrypt(account.accessToken),
    refresh_token: account.refreshToken
      ? decrypt(account.refreshToken)
      : undefined,
    expiry_date: account.tokenExpiry
      ? new Date(account.tokenExpiry).getTime()
      : undefined,
  });

  oauth2Client.on("tokens", async (tokens) => {
    const update = {};
    if (tokens.access_token) update.accessToken = encrypt(tokens.access_token);
    if (tokens.refresh_token)
      update.refreshToken = encrypt(tokens.refresh_token);
    if (tokens.expiry_date) update.tokenExpiry = new Date(tokens.expiry_date);
    if (Object.keys(update).length) {
      await YoutubeModal.updateOne({ _id: account._id }, { $set: update });
    }
  });

  return google.youtube({ version: "v3", auth: oauth2Client });
};

const executeYouTubeAction = async ({ userId, rule, event, text }) => {
  if (!["auto_comment", "auto_like"].includes(rule.action)) {
    throw new Error(
      "YouTube automation supports comments or likes. Repost/quote should be configured as a draft or cross-platform post.",
    );
  }

  const youtube = await getYouTubeClient({
    userId,
    accountId: rule.destination.accountId,
  });

  if (rule.action === "auto_like") {
    const response = await youtube.videos.rate({
      id: String(event.externalPostId),
      rating: "like",
    });
    return { externalPostId: event.externalPostId, raw: response.data };
  }

  const response = await youtube.commentThreads.insert({
    part: ["snippet"],
    requestBody: {
      snippet: {
        videoId: String(event.externalPostId),
        topLevelComment: {
          snippet: {
            textOriginal: text,
          },
        },
      },
    },
  });

  if (rule.autoLike) {
    await humanDelay();
    await youtube.videos
      .rate({
        id: String(event.externalPostId),
        rating: "like",
      })
      .catch((err) => {
        logger.warn("YouTube autoLike failed after comment", {
          error: err.message,
          eventId: event._id,
        });
      });
  }

  return { externalPostId: response.data?.id, raw: response.data };
};

const getThreadsAccessToken = (account) => {
  if (!account?.accessToken) return null;
  return decrypt(account.accessToken);
};

const executeThreadsTextPost = async ({ account, text, replyToId = "", quotePostId = "" }) => {
  const accessToken = getThreadsAccessToken(account);
  if (!accessToken) throw new Error("Threads account is missing access token");

  console.log("=== THREADS API: CREATING CONTAINER ===");
  console.log("Endpoint:", `${THREADS_API_BASE}/${account.threadsUserId}/threads`);
  console.log("Params:", {
    media_type: "TEXT",
    text,
    reply_to_id: replyToId || undefined,
    quote_post_id: quotePostId || undefined,
  });

  const containerRes = await axios.post(
    `${THREADS_API_BASE}/${account.threadsUserId}/threads`,
    null,
    {
      params: {
        media_type: "TEXT",
        text,
        ...(replyToId ? { reply_to_id: replyToId } : {}),
        ...(quotePostId ? { quote_post_id: quotePostId } : {}),
        access_token: accessToken,
      },
    },
  );

  const creationId = containerRes.data?.id;
  console.log("Response Creation ID:", creationId);
  if (!creationId) throw new Error("Threads did not return a creation id");

  console.log("=== THREADS API: PUBLISHING CONTAINER ===");
  console.log("Endpoint:", `${THREADS_API_BASE}/${account.threadsUserId}/threads_publish`);
  console.log("Creation ID:", creationId);

  const publishRes = await axios.post(
    `${THREADS_API_BASE}/${account.threadsUserId}/threads_publish`,
    null,
    {
      params: {
        creation_id: creationId,
        access_token: accessToken,
      },
    },
  );

  console.log("Response Publish:", JSON.stringify(publishRes.data, null, 2));

  return {
    externalPostId: publishRes.data?.id || creationId,
    raw: publishRes.data,
  };
};

const executeThreadsAction = async ({ account, rule, event, text }) => {
  if (rule.action === "auto_comment") {
    try {
      return await executeThreadsTextPost({
        account,
        text,
        replyToId: String(event.externalPostId),
      });
    } catch (err) {
      logger.warn("Threads native reply/comment failed due to missing permissions or API constraints; falling back to a text post with reference link", {
        error: err.response?.data || err.message,
        eventId: event._id,
        threadsPostId: event.externalPostId,
      });

      return executeThreadsTextPost({
        account,
        text: appendPostUrlIfNeeded(text, event.postUrl),
      });
    }
  }

  if (rule.action === "auto_repost") {
    if (event.platform === "threads" && event.externalPostId) {
      try {
        console.log("accessToken:", account.threadsUserId, account.accessToken, event.externalPostId);
        const accessToken = getThreadsAccessToken(account);
        if (!accessToken) throw new Error("Threads account is missing access token");

        const response = await axios.post(
          `${THREADS_API_BASE}/${event.externalPostId}/repost`,
          null,
          {
            params: {
              access_token: accessToken,
            },
          },
        );
        console.log("Threads repost response:", JSON.stringify(response.data, event.externalPostId, null, 2));
        return {
          externalPostId: response.data?.id || event.externalPostId,
          raw: response.data,
        };
      } catch (err) {
        logger.warn("Native Threads repost failed due to missing permissions or API constraints; falling back to text post with link", {
          error: err.response?.data || err.message,
          eventId: event._id,
          threadsPostId: event.externalPostId,
        });
      }
    }

    return executeThreadsTextPost({
      account,
      text: appendPostUrlIfNeeded(text, event.postUrl),
    });
  }

  if (rule.action === "auto_quote") {
    if (event.platform === "threads" && event.externalPostId) {
      try {
        return await executeThreadsTextPost({
          account,
          text,
          quotePostId: String(event.externalPostId),
        });
      } catch (err) {
        logger.warn("Native Threads quote post failed due to missing permissions or API constraints; falling back to text post with link", {
          error: err.response?.data || err.message,
          eventId: event._id,
          threadsPostId: event.externalPostId,
        });
      }
    }

    return executeThreadsTextPost({
      account,
      text: appendPostUrlIfNeeded(text, event.postUrl),
    });
  }

  throw new Error(
    `Threads does not support automation action ${rule.action}. Use auto_comment, auto_quote, or auto_repost.`,
  );
};

const executeLinkedInAction = async ({ account, rule, event, text }) => {
  const actorUrn = String(account.linkedInId).startsWith("urn:li:")
    ? account.linkedInId
    : `urn:li:person:${account.linkedInId}`;

  if (rule.action === "auto_like") {
    const response = await axios.post(
      `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(actorUrn)}`,
      { root: String(event.externalPostId), reactionType: "LIKE" },
      {
        headers: {
          Authorization: `Bearer ${decrypt(account.accessToken)}`,
          "LinkedIn-Version": "202605",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );
    return { externalPostId: event.externalPostId, raw: response.data };
  }

  if (rule.action === "auto_comment") {
    const response = await axios.post(
      `https://api.linkedin.com/rest/socialActions/${encodeURIComponent(String(event.externalPostId))}/comments`,
      {
        actor: actorUrn,
        object: String(event.externalPostId),
        message: { text },
      },
      {
        headers: {
          Authorization: `Bearer ${decrypt(account.accessToken)}`,
          "LinkedIn-Version": "202605",
          "X-Restli-Protocol-Version": "2.0.0",
        },
      },
    );

    if (rule.autoLike) {
      await humanDelay();
      await axios
        .post(
          `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(actorUrn)}`,
          { root: String(event.externalPostId), reactionType: "LIKE" },
          {
            headers: {
              Authorization: `Bearer ${decrypt(account.accessToken)}`,
              "LinkedIn-Version": "202605",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          },
        )
        .catch((err) => {
          logger.warn("LinkedIn autoLike failed after comment", {
            error: err.message,
            eventId: event._id,
          });
        });
    }

    return {
      externalPostId: response.headers?.["x-restli-id"] || "",
      raw: response.data,
    };
  }

  if (!["auto_quote", "auto_repost"].includes(rule.action)) {
    throw new Error(
      "LinkedIn automation currently supports auto_comment, auto_like, auto_quote, and auto_repost.",
    );
  }

  const parentUrn = String(event.externalPostId);

  const payload = {
    author: actorUrn,
    lifecycleState: "PUBLISHED",
    visibility: "PUBLIC",
    reshareContext: {
      parent: parentUrn,
    },
    distribution: {
      feedDistribution: "MAIN_FEED",
    },
  };

  const finalCommentary = appendPostUrlIfNeeded(text, event.postUrl);
  payload.commentary = (rule.action === "auto_quote" && finalCommentary) ? finalCommentary : "";

  const response = await axios.post(
    "https://api.linkedin.com/rest/posts",
    payload,
    {
      headers: {
        Authorization: `Bearer ${decrypt(account.accessToken)}`,
        "LinkedIn-Version": "202605",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
      },
    }
  );

  if (rule.autoLike) {
    await humanDelay();
    // 1. Like the original post
    await axios
      .post(
        `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(actorUrn)}`,
        { root: parentUrn, reactionType: "LIKE" },
        {
          headers: {
            Authorization: `Bearer ${decrypt(account.accessToken)}`,
            "LinkedIn-Version": "202605",
            "X-Restli-Protocol-Version": "2.0.0",
          },
        }
      )
      .catch((err) => {
        logger.warn("LinkedIn autoLike failed for original post after repost", {
          error: err.message,
          eventId: event._id,
        });
      });

    // 2. Like the newly created repost itself
    const newPostUrn = response.headers?.["x-restli-id"];
    if (newPostUrn) {
      await humanDelay();
      await axios
        .post(
          `https://api.linkedin.com/rest/reactions?actor=${encodeURIComponent(actorUrn)}`,
          { root: newPostUrn, reactionType: "LIKE" },
          {
            headers: {
              Authorization: `Bearer ${decrypt(account.accessToken)}`,
              "LinkedIn-Version": "202605",
              "X-Restli-Protocol-Version": "2.0.0",
            },
          }
        )
        .catch((err) => {
          logger.warn("LinkedIn autoLike failed for newly created repost", {
            error: err.message,
            eventId: event._id,
          });
        });
    }
  }

  return {
    externalPostId: response.headers?.["x-restli-id"] || "",
    raw: response.data,
  };
};

const executePinterestAction = async ({ account, rule, event, text }) => {
  if (!["auto_quote", "auto_repost"].includes(rule.action)) {
    throw new Error(
      "Pinterest automation supports pin creation from source media only.",
    );
  }

  const image = event.media.find((item) => item.type === "image" && item.url);
  if (!image)
    throw new Error(
      "Pinterest pin automation requires an image in the source event",
    );
  if (!rule.destination.boardId)
    throw new Error("Pinterest destination.boardId is required");

  const accessToken = decrypt(account.accessToken);
  const response = await axios.post(
    `${PINTEREST_API_BASE}/pins`,
    {
      board_id: rule.destination.boardId,
      title: text.slice(0, 100),
      description: text,
      link: event.postUrl || "",
      media_source: {
        source_type: "image_url",
        url: image.url,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    },
  );

  return {
    externalPostId: response.data?.id,
    raw: response.data,
  };
};

export const executeAutomationAction = async ({ run, draft = null }) => {
  const [rule, event] = await Promise.all([
    SocialAutomationRule.findOne({ _id: run.ruleId, userId: run.userId }),
    SocialAutomationEvent.findOne({ _id: run.eventId, userId: run.userId }),
  ]);

  if (!rule || !event) throw new Error("Automation rule or event not found");
  if (!rule.enabled) throw new Error("Automation rule is disabled");

  const account = await assertConnectedDestinationAccount({
    userId: run.userId,
    destination: rule.destination,
  });

  const monitored = await SocialMonitoredAccount.findById(
    event.monitoredAccountId,
  );
  const text =
    draft && draft.commentText !== undefined
      ? draft.commentText
      : (draft && draft.caption !== undefined
          ? draft.caption
          : await generateAutomationText({ rule, event, monitored }));
  const executionRule =
    rule.action === "create_draft"
      ? {
          ...rule.toObject(),
          action: "auto_quote",
          destination: rule.destination,
        }
      : rule;

  switch (executionRule.destination.platform) {
    case "twitter":
      return executeTwitterAction({
        account,
        rule: executionRule,
        event,
        text,
      });
    case "youtube":
      return executeYouTubeAction({
        userId: run.userId,
        rule: executionRule,
        event,
        text,
      });
    case "threads":
      return executeThreadsAction({
        account,
        rule: executionRule,
        event,
        text,
      });
    case "linkedin":
      return executeLinkedInAction({
        account,
        rule: executionRule,
        event,
        text,
      });
    case "pinterest":
      return executePinterestAction({
        account,
        rule: executionRule,
        event,
        text,
      });
    case "facebook":
    case "instagram":
      throw new Error(
        `${executionRule.destination.platform} automation is ready for rules/drafts but native actions are not enabled yet`,
      );
    default:
      throw new Error(
        `Unsupported destination platform ${executionRule.destination.platform}`,
      );
  }
};

export const executeAutomationRun = async ({ runId }) => {
  const run = await SocialAutomationRun.findById(runId);
  if (!run) throw new Error("Automation run not found");

  if (!["pending", "processing"].includes(run.status)) {
    return run;
  }

  run.status = "processing";
  run.startedAt = run.startedAt || new Date();
  run.error = "";
  await run.save();

  const [rule, event] = await Promise.all([
    SocialAutomationRule.findById(run.ruleId),
    SocialAutomationEvent.findById(run.eventId),
  ]);

  if (!rule || !event) {
    run.status = "failed";
    run.error = "Automation rule or event not found";
    run.finishedAt = new Date();
    await run.save();
    return run;
  }

  const monitored = await SocialMonitoredAccount.findById(
    event.monitoredAccountId,
  );

  if (rule.action === "notify_only") {
    run.status = "success";
    run.result = {
      notification: true,
      message: `${monitored?.displayName || monitored?.username || event.sourceUsername || "A monitored account"} posted new content`,
    };
    run.finishedAt = new Date();
    await run.save();
    emitToUser(run.userId, "socialAutomation:notification", {
      runId: run._id,
      eventId: event._id,
      ruleId: rule._id,
      event,
    });
    return run;
  }

  const text = await generateAutomationText({ rule, event, monitored });
  const needsApproval = rule.requireApproval || rule.action === "create_draft";

  if (needsApproval) {
    const draft = await SocialAutomationDraft.findOneAndUpdate(
      { eventId: event._id, ruleId: rule._id },
      {
        $setOnInsert: {
          userId: run.userId,
          ruleId: rule._id,
          eventId: event._id,
          action: rule.action,
          destination: rule.destination,
          caption: "",
          commentText: "",
          status: "pending_approval",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    run.status = "pending_approval";
    run.draftId = draft._id;
    run.result = { draftId: draft._id };
    run.finishedAt = new Date();
    await run.save();

    emitToUser(run.userId, "socialAutomation:draftCreated", {
      runId: run._id,
      draftId: draft._id,
      eventId: event._id,
      ruleId: rule._id,
    });

    return run;
  }

  const result = await executeAutomationAction({ run });
  run.status = "success";
  run.result = result;
  run.finishedAt = new Date();
  await run.save();

  await SocialAutomationEvent.updateOne(
    { _id: event._id },
    { $set: { status: "processed", error: "" } },
  );
  await SocialAutomationRule.updateOne(
    { _id: rule._id },
    { $set: { lastTriggeredAt: new Date() } },
  );

  return run;
};

export const approveAutomationDraft = async ({
  userId,
  draftId,
  payload = {},
}) => {
  const draft = await SocialAutomationDraft.findOne({ _id: draftId, userId });
  if (!draft) throw new Error("Draft not found");
  if (draft.status !== "pending_approval" && draft.status !== "failed") {
    throw new Error(`Draft cannot be approved from status ${draft.status}`);
  }

  if (payload.caption !== undefined) draft.caption = payload.caption;
  if (payload.commentText !== undefined)
    draft.commentText = payload.commentText;
  draft.status = "publishing";
  draft.approvedAt = new Date();
  await draft.save();

  const run = await SocialAutomationRun.findOne({
    userId,
    ruleId: draft.ruleId,
    eventId: draft.eventId,
  });
  if (!run) throw new Error("Automation run not found for draft");

  try {
    const result = await executeAutomationAction({ run, draft });
    draft.status = "published";
    draft.externalResult = result;
    draft.error = "";
    await draft.save();

    run.status = "success";
    run.draftId = draft._id;
    run.result = result;
    run.error = "";
    run.finishedAt = new Date();
    await run.save();

    await SocialAutomationEvent.updateOne(
      { _id: draft.eventId },
      { $set: { status: "processed", error: "" } },
    );
    await SocialAutomationRule.updateOne(
      { _id: draft.ruleId },
      { $set: { lastTriggeredAt: new Date() } },
    );

    return { draft, run };
  } catch (err) {
    draft.status = "failed";
    draft.error = err.message;
    await draft.save();

    run.status = "failed";
    run.draftId = draft._id;
    run.error = err.message;
    run.finishedAt = new Date();
    await run.save();

    throw err;
  }
};

export const rejectAutomationDraft = async ({ userId, draftId }) => {
  const draft = await SocialAutomationDraft.findOneAndUpdate(
    { _id: draftId, userId, status: "pending_approval" },
    { $set: { status: "rejected", rejectedAt: new Date() } },
    { new: true },
  );
  if (!draft) throw new Error("Pending draft not found");

  await SocialAutomationRun.updateOne(
    { userId, ruleId: draft.ruleId, eventId: draft.eventId },
    {
      $set: {
        status: "skipped",
        error: "Draft rejected by user",
        finishedAt: new Date(),
      },
    },
  );

  return draft;
};

export const listAutomationDrafts = ({ userId, query = {} }) => {
  const filter = { userId };
  if (query.status) filter.status = query.status;
  return SocialAutomationDraft.find(filter)
    .populate("ruleId")
    .populate("eventId")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(query.limit) || 50, 200));
};

export const listAutomationEvents = ({ userId, query = {} }) => {
  const filter = { userId };
  if (query.status) filter.status = query.status;
  if (query.platform) filter.platform = normalizePlatform(query.platform);
  if (query.monitoredAccountId)
    filter.monitoredAccountId = query.monitoredAccountId;

  return SocialAutomationEvent.find(filter)
    .populate("monitoredAccountId")
    .sort({ publishedAt: -1, createdAt: -1 })
    .limit(Math.min(Number(query.limit) || 50, 200));
};

export const listAutomationRuns = ({ userId, query = {} }) => {
  const filter = { userId };
  if (query.status) filter.status = query.status;
  if (query.ruleId) filter.ruleId = query.ruleId;
  if (query.eventId) filter.eventId = query.eventId;

  return SocialAutomationRun.find(filter)
    .populate("ruleId")
    .populate("eventId")
    .populate("draftId")
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(query.limit) || 50, 200));
};

export const enhanceAutomationDraftText = async ({ userId, draftId }) => {
  const draft = await SocialAutomationDraft.findOne({ _id: draftId, userId });
  if (!draft) throw new Error("Draft not found");

  const event = await SocialAutomationEvent.findOne({ _id: draft.eventId, userId });
  if (!event) throw new Error("Event not found");

  const user = await userModel.findById(userId);

  // Fetch Business/Individual profile details for brand context
  const [BusinessProfile, IndividualProfile] = await Promise.all([
    BusinessSummaryProfileSchema.findOne({
      userId,
      status: "COMPLETED",
    }).lean(),
    IndividualAnalysisSchema.findOne({
      userId,
      analysisStatus: "completed",
      isActive: true,
    }).sort({ createdAt: -1 }).lean(),
  ]);

  const businessContext = {
    brand_name: BusinessProfile?.analysis?.business_overview?.brand_name,
    legal_name: BusinessProfile?.analysis?.business_overview?.legal_name,
    industry: BusinessProfile?.analysis?.business_overview?.industries,
    business_type:
      BusinessProfile?.analysis?.business_overview?.business_type,
    target_audience: {
      primary_segments:
        BusinessProfile?.analysis?.target_market?.primary_customer_segments,
      decision_makers:
        BusinessProfile?.analysis?.target_market?.decision_makers,
      ideal_profiles:
        BusinessProfile?.analysis?.target_market?.ideal_client_profiles,
    },
    competitive_positioning:
      BusinessProfile?.analysis?.competitor_analysis
        ?.competitive_positioning_summary,
    branding_guidelines: {
      colors: BusinessProfile?.analysis?.branding_guidelines?.brand_colors,
      fonts: BusinessProfile?.analysis?.branding_guidelines?.fonts,
      visual_style:
        BusinessProfile?.analysis?.branding_guidelines?.visual_style,
      logo_url: BusinessProfile?.analysis?.branding_guidelines?.logo_url,
    },
  };
  const contactData = BusinessProfile?.analysis?.contact_info || {};

  const individualContext = {
    personal_brand: {
      display_name:
        IndividualProfile?.analysis?.individual_identity?.display_name,
      profession:
        IndividualProfile?.analysis?.individual_identity?.inferred_profession,
      niche: IndividualProfile?.analysis?.individual_identity?.niche,
      who_they_help:
        IndividualProfile?.analysis?.individual_identity?.who_they_help,
      result_they_create:
        IndividualProfile?.analysis?.individual_identity?.result_they_create,
      tone_of_voice:
        IndividualProfile?.analysis?.individual_identity?.tone_of_voice,
      brand_archetype:
        IndividualProfile?.analysis?.individual_identity?.brand_archetype,
      content_personality:
        IndividualProfile?.analysis?.individual_identity
          ?.content_personality_type,
    },

    story: {
      origin: IndividualProfile?.analysis?.story_arc?.origin,
      struggle: IndividualProfile?.analysis?.story_arc?.struggle,
      transformation: IndividualProfile?.analysis?.story_arc?.transformation,
      authority_now: IndividualProfile?.analysis?.story_arc?.authority_now,
      framework:
        IndividualProfile?.analysis?.story_arc?.signature_framework?.name,
    },

    target_audience: {
      primary_audience:
        IndividualProfile?.analysis?.target_audience
          ?.primary_audience_persona,
      secondary_audience:
        IndividualProfile?.analysis?.target_audience
          ?.secondary_audience_persona,
      emotional_triggers:
        IndividualProfile?.analysis?.target_audience
          ?.emotional_buying_triggers,
    },

    platform_strategy:
      IndividualProfile?.analysis?.platform_strategy
        ?.primary_recommended_platform,

    photo_url: IndividualProfile?.photoUrl,
  };

  const context =
    user?.accountType === "business" ? businessContext : individualContext;
  const contact_details = user?.accountType === "business" ? contactData : {};

  // Verify and calculate dynamic cost of AI enhancement
  let creditAmount = 20; // Default fallback
  try {
    const configVal = await ServiceCostConfig.findOne({
      serviceName: "promptGeneration",
      isActive: true,
    });
    if (configVal && Number.isFinite(Number(configVal.creditCost))) {
      creditAmount = Number(configVal.creditCost);
    }
  } catch (err) {
    logger.error("Error fetching promptGeneration config:", err);
  }

  await assertDynamicSocialAnalyticsCredit({
    userId,
    creditAmount,
    label: "AI Enhance",
  });

  // Formulate custom user prompt depending on action
  let userPrompt = "";
  if (draft.action === "auto_comment") {
    userPrompt = `Generate a short, engaging, and professional reply or comment to the following post.
Do not include hashtags. Keep it concise.
Original Post text: "${event.text || ""}"`;
  } else {
    // repost, quote, draft
    userPrompt = `Write a short professional post caption or thoughts that references and summarizes the following post.
Do not copy the original post text directly. Keep it engaging.
Original Post text: "${event.text || ""}"`;
  }

  const ContentHashtagsRes = await runClaudePostContentGeneration({
    userPrompt,
    mediaType: "image", // standard text/image post style
    businessContext: context,
    businessURL: BusinessProfile?.websiteUrl,
    businessData: contact_details,
  });

  const description = ContentHashtagsRes?.description || "";
  const hashtags = (ContentHashtagsRes?.hashtags || []).join(" ");
  const text = [description, hashtags].filter(Boolean).join("\n\n");

  // Deduct credits
  await deductDynamicCredit({
    userId,
    creditAmount,
    serviceName: "AI Enhance",
    referenceId: draftId,
    referenceModel: "SocialAutomationDraft",
    description: `AI Enhancement for draft action: ${draft.action}`,
    idempotencyKey: `draft-enhance-${draftId}-${Date.now()}`,
    metadata: {
      platform: draft.platform,
      action: draft.action,
      draftId,
    },
  });

  // Persist the generated text to the database
  if (draft.action === "auto_comment") {
    draft.commentText = text;
  } else {
    draft.caption = text;
  }
  await draft.save();

  return { text };
};
