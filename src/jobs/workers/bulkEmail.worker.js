import { Worker, DelayedError } from "bullmq";
import logger from "../../config/logger.js";
import { connection } from "../index.js";
import Handlebars from "handlebars";
import templateSchema from "../../models/Campaign/EmailCampaign/templateSchema.js";
import campaignSchema from "../../models/Campaign/EmailCampaign/campaignSchema.js";
import campaignRecipientLogSchema from "../../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import EmailToken from "../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import redisClient from "../../config/redis.js";
import moment from "moment";
import config from "../../config/config.js";
import { google } from "googleapis";
import { getValidGoogleToken } from "../../controllers/Campaign/EmailConnectors/GoogleauthEmailcontroller.js";
import { getValidMicrosoftToken } from "../../controllers/Campaign/EmailConnectors/Microsoftauthcontroller.js";
import {
  generateUnsubscribeToken,
  isUnsubscribed,
} from "../../controllers/Campaign/EmailConnectors/unsubscribeController.js";
import axios from "axios";
import nodemailer from "nodemailer";
import {
  trackAndDeductFeatureCredit,
  checkBulkFeatureCapacity,
} from "../../utils/creditTracker.js";
import { sendOutlookMailDirect } from "../../config/mailer.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import AdminOutreachProfile from "../../models/AdminOutreachProfile.js";
import MediaStore from "../../models/MediaStore.js";
import Unsubscribe from "../../models/Campaign/EmailCampaign/unsubscribeSchema.js";
import { scheduleEmailLimitReset, REFILL_WINDOW_MS } from "../../jobs/resetEmailDailyLimits.job.js";
import { emitCampaignUpdated } from "../../utils/campaignSocketHelper.js";
import { agenda } from "../../jobs/agenda/agenda.js";
import { EMAIL_CAMPAIGN_DISPATCHER_JOB } from "../../jobs/emailCampaignDispatcher.job.js";

const RATE_DELAY_MS = 2000;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Register Handlebars fallbacks so unknown helpers or variable syntax don't crash execution
Handlebars.registerHelper("helperMissing", function (...args) {
  const options = args[args.length - 1];
  logger.warn(
    `[Handlebars] Missing helper or unresolved variable used as helper: "${options?.name || "unknown"}"`,
  );
  return "";
});

Handlebars.registerHelper("blockHelperMissing", function (context, options) {
  logger.warn(
    `[Handlebars] Missing block helper or block variable: "${options?.name || "unknown"}"`,
  );
  return "";
});

/**
 * Normalizes dynamic template context to ensure case-insensitive, camelCase,
 * snake_case, PascalCase, lowercase, uppercase, and space-removed aliases exist
 * for all variables provided in Excel rows or recipient logs.
 */
export function normalizeTemplateContext(context = {}) {
  if (!context || typeof context !== "object") return {};
  const normalized = { ...context };

  // 1. Derive firstName and lastName from recipientName or name if not explicitly set
  const rawName =
    context.recipientName ||
    context.name ||
    context.Name ||
    context["First Name"] ||
    context["first name"] ||
    context.firstName ||
    context.FirstName ||
    context["Full Name"] ||
    context["full name"] ||
    context.fullName ||
    context.FullName ||
    "";
  if (rawName && typeof rawName === "string") {
    const parts = rawName.trim().split(/\s+/);
    if (
      !normalized.firstName &&
      !normalized.first_name &&
      !normalized.FirstName &&
      !normalized["First Name"]
    ) {
      normalized.firstName = parts[0] || "";
      normalized.first_name = parts[0] || "";
      normalized.FirstName = parts[0] || "";
    }
    if (
      !normalized.lastName &&
      !normalized.last_name &&
      !normalized.LastName &&
      !normalized["Last Name"]
    ) {
      normalized.lastName = parts.slice(1).join(" ") || "";
      normalized.last_name = parts.slice(1).join(" ") || "";
      normalized.LastName = parts.slice(1).join(" ") || "";
    }
  }

  // 2. Iterate through all keys and generate aliases
  for (const [key, value] of Object.entries(context)) {
    if (value === undefined || value === null) continue;

    const cleanKey = String(key).trim();
    if (cleanKey !== key) {
      normalized[cleanKey] = value;
    }

    const lowerKey = cleanKey.toLowerCase();

    if (normalized[lowerKey] === undefined) normalized[lowerKey] = value;
    if (normalized[cleanKey.toUpperCase()] === undefined)
      normalized[cleanKey.toUpperCase()] = value;

    const noSpaces = cleanKey.replace(/\s+/g, "");
    if (normalized[noSpaces] === undefined) normalized[noSpaces] = value;

    const camelKey = cleanKey
      .replace(/[-_ ]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^(.)/, (m) => m.toLowerCase());
    if (normalized[camelKey] === undefined) normalized[camelKey] = value;

    const snakeKey = cleanKey
      .replace(/([a-z])([A-Z])/g, "$1_$2")
      .replace(/[-_ ]+/g, "_")
      .toLowerCase();
    if (normalized[snakeKey] === undefined) normalized[snakeKey] = value;

    const pascalKey = camelKey.replace(/^(.)/, (m) => m.toUpperCase());
    if (normalized[pascalKey] === undefined) normalized[pascalKey] = value;
  }

  return normalized;
}

/**
 * Fetches the campaign owner's business profile, brand profile, and recent media
 * to populate marketing template variables like {{userLogo}}, {{companyName}},
 * {{postImage1}}, {{postDescription1}}, {{postHashtags1}}, etc.
 *
 * Returns a flat object that can be spread into Handlebars context.
 * Recipient-level data (from Excel) always takes priority over this.
 */
export async function buildMarketingTemplateData(
  userId,
  outReachWebsiteId,
  isAdminOutreach = false,
) {
  try {
    let analysis = {};
    let overview = {};
    let branding = {};
    let contactInfo = {};
    let pdfUrl = "";
    let mediaData = {};

    if (isAdminOutreach && outReachWebsiteId) {
      // ── Admin outreach path ──
      // BSP.userId is null for outreach profiles, so we fetch the complete
      // email template data from AdminOutreachProfile.
      // Populate businessSummaryProfileId (for analysis fallback) and mediaUrls (for images/videos).
      const outreachProfile = await AdminOutreachProfile.findOne({
        adminId: userId,
        websiteUrl: outReachWebsiteId,
      })
        .populate("businessSummaryProfileId")
        .populate("mediaUrls")
        .lean();

      if (outreachProfile) {
        // 1. Analysis data — prefer AOP's own analysis, fall back to linked BSP
        analysis =
          outreachProfile.analysis ||
          outreachProfile.businessSummaryProfileId?.analysis ||
          {};
        overview = analysis?.business_overview || {};
        branding = analysis?.branding_guidelines || {};
        contactInfo = analysis?.contact_info || {};

        // 2. PDF URL from outreach profile
        pdfUrl =
          outreachProfile.pdfUrl ||
          outreachProfile.businessSummaryProfileId?.pdfUrl ||
          "";

        // 3. Media data from populated mediaUrls
        const populatedMedia = outreachProfile.mediaUrls || [];
        const populatedImages = populatedMedia.filter(
          (m) => m.mediaType === "image",
        );
        const populatedVideos = populatedMedia.filter(
          (m) => m.mediaType === "video",
        );

        const post1 = populatedImages[0] || {};
        const post2 = populatedImages[1] || {};

        mediaData = {
          postImage1: post1.mediaUrl || "",
          postDescription1: post1.description || "",
          postHashtags1: Array.isArray(post1.hashtags)
            ? post1.hashtags.join(" ")
            : post1.hashtags || "",
          postImage2: post2.mediaUrl || "",
          postDescription2: post2.description || "",
          postHashtags2: Array.isArray(post2.hashtags)
            ? post2.hashtags.join(" ")
            : post2.hashtags || "",
          // All generated images/videos for templates that iterate
          generatedImages: populatedImages.map((m) => ({
            mediaUrl: m.mediaUrl,
            description: m.description,
            hashtags: m.hashtags,
          })),
          generatedVideos: populatedVideos.map((m) => ({
            mediaUrl: m.mediaUrl,
            description: m.description,
          })),
        };

        logger.info(
          `[BulkEmail] Loaded template data from AdminOutreachProfile for website: ${outReachWebsiteId}`,
        );
      } else {
        logger.warn(
          `[BulkEmail] No AdminOutreachProfile found for adminId=${userId}, website=${outReachWebsiteId}`,
        );
      }
    } else {
      // ── Normal user path ──
      // Fetch business analysis profile by the campaign owner's userId
      const businessProfile = await BusinessSummaryProfile.findOne({
        userId,
        status: "COMPLETED",
        isActive: true,
        whoGenerated: "boradeai",
        ...(outReachWebsiteId ? { websiteUrl: outReachWebsiteId } : {}),
      }).lean();

      analysis = businessProfile?.analysis || {};
      overview = analysis?.business_overview || {};
      branding = analysis?.branding_guidelines || {};
      contactInfo = analysis?.contact_info || {};
      pdfUrl = businessProfile?.pdfUrl || "";
    }

    // Determine the best logo URL (branding > empty)
    const userLogo = branding?.logo_url || "";

    // Company name from analysis
    const companyName =
      overview?.brand_name || overview?.legal_name || "Your Company Name";

    const senderFirstName =
      overview?.legal_name || overview?.brand_name || "Team";

    // Dynamic paragraph from analysis summary or core value proposition
    const userDynamicParagraph = overview?.core_value_proposition || "";

    // BoradeAI marketing URL (links to frontend or website)
    const BoradeAiMarketingDynamicWebURL =
      contactInfo?.website || config.FRONTEND_BASE_URL || "https://borade.ai";

    return {
      userLogo,
      companyName,
      senderFirstName,
      userDynamicParagraph,
      BoradeAiMarketingDynamicWebURL,
      pdfUrl,
      // Extra fields templates might use
      brandName: companyName,
      websiteUrl: contactInfo?.website || "",
      phone: contactInfo?.phone || "",
      address: contactInfo?.address || "",
      // Media template variables (populated for admin outreach)
      ...mediaData,
    };
  } catch (err) {
    logger.error(
      `[BulkEmail] Failed to build marketing template data for user ${userId}: ${err.message}`,
    );
    return {};
  }
}

/**
 * Appends a CAN-SPAM / GDPR compliant footer to the HTML email body.
 */
const buildEmailFooter = (unsubscribeUrl, companyName, companyAddress) => `
<div style="margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; font-family: Arial, sans-serif; font-size: 12px; color: #999; text-align: center; line-height: 1.6;">
  ${
    companyName &&
    `
    <p>
    This email was sent by <strong>${companyName}</strong>.
    </p>
    `
  }
  
  ${
    companyName &&
    companyAddress &&
    `
  <p>
    ${companyName} &bull; ${companyAddress}
  </p>
  `
  }

  <p>
    This message was delivered using the <strong>BoradeAI</strong> marketing automation platform on behalf of ${companyName}.
  </p>

  <p>
    If you no longer wish to receive communications from ${companyName},
    <a href="${unsubscribeUrl}" style="color: #999; text-decoration: underline;">
      you may unsubscribe here
    </a>.
  </p>

</div>
`;

const buildMicrosoftAttachments = async (attachments) => {
  const results = [];

  for (const att of attachments) {
    try {
      const response = await axios.get(att.url, {
        responseType: "arraybuffer",
      });
      const base64 = Buffer.from(response.data).toString("base64");

      results.push({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: att.filename,
        contentType: att.contentType,
        contentBytes: base64,
      });
    } catch (err) {
      logger.error(
        `Failed to fetch attachment ${att.filename} from ${att.url}: ${err.message}`,
      );
    }
  }

  return results;
};

/**
 * Builds a base64url encoded RFC822 message for Gmail API using nodemailer.
 */
const buildRawGmailMessage = async (
  from,
  to,
  ccEmail,
  subject,
  html,
  attachments,
  unsubscribeUrl,
) => {
  const mailOptions = {
    from,
    to,
    cc: ccEmail,
    subject,
    html,
    attachments: attachments.map((att) => ({
      filename: att.filename,
      path: att.url,
      contentType: att.contentType,
    })),
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };

  const transporter = nodemailer.createTransport({
    streamTransport: true,
    newline: "unix",
    buffer: true,
  });

  const info = await transporter.sendMail(mailOptions);
  return info.message
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const worker = new Worker(
  "bulk-email-queue",
  async (job) => {
    const {
      campaignId,
      templateId,
      recipientData,
      isAdminOutreach = false,
      outReachWebsiteId = null,
    } = job.data;

    const start = Date.now();

    if (!recipientData?.email) throw new Error("Recipient email missing");

    logger.info(`[JOB:${job.id}] Processing ${recipientData.email}`);

    let campaign = null;
    let emailToken = null;
    let senderEmail = null;
    let senderProvider = null;
    let logEntry = null;

    try {
      campaign = await campaignSchema.findById(campaignId);
      if (!campaign) throw new Error("Campaign not found");

      senderEmail = job.data.senderEmail || campaign.campaignMail;
      senderProvider = job.data.senderProvider || campaign.provider;
      const senderTokenId = job.data.senderTokenId;

      if (senderTokenId) {
        emailToken = await EmailToken.findById(senderTokenId);
      } else if (senderEmail && senderProvider && senderProvider !== "system") {
        emailToken = await EmailToken.findOne({
          userId: campaign.userId,
          email: senderEmail.toLowerCase(),
          provider: senderProvider,
        });
      }

      // Self-healing: if token was suspended mid-execution, re-queue recipient log and exit gracefully
      if (
        senderTokenId &&
        (!emailToken || !emailToken.isActive || emailToken.status !== "active")
      ) {
        logger.warn(
          `[JOB:${job.id}] Sender token ${senderTokenId} is no longer active. Re-queueing recipient.`,
        );
        await campaignRecipientLogSchema.updateOne(
          { campaignId, recipientEmail: recipientData.email },
          {
            $set: { status: "queued" },
            $unset: { senderEmail: 1, senderTokenId: 1 },
          },
        );
        return { success: false, reason: "sender_token_inactive" };
      }

      /* ─────────────────────────────────────────────
         PRE-CHECK — FREE LIMITS / CREDITS
      ───────────────────────────────────────────── */
      const capacityCheck = await checkBulkFeatureCapacity({
        userId: campaign.userId,
        featureKey: "email",
        requiredCount: 1,
      });

      if (!capacityCheck.canAfford) {
        throw new Error(
          capacityCheck.message || "Insufficient email sending limits.",
        );
      }

      // ===========================
      // RECIPIENT LOG INIT
      // ===========================
      logEntry = await campaignRecipientLogSchema.findOne({
        campaignId: campaignId,
        recipientEmail: recipientData.email,
      });

      if (!logEntry) {
        logEntry = await campaignRecipientLogSchema.findOneAndUpdate(
          { campaignId: campaignId, recipientEmail: recipientData.email },
          {
            senderUserId: campaign.userId,
            recipientName:
              recipientData.name ||
              recipientData.Name ||
              recipientData["First Name"] ||
              recipientData["first name"] ||
              recipientData.firstName ||
              recipientData.FirstName ||
              recipientData["Full Name"] ||
              recipientData["full name"] ||
              recipientData.fullName ||
              recipientData.FullName ||
              "",
            companyName: recipientData.companyName || "",
            status: "dispatching",
            senderEmail,
            senderTokenId,
          },
          { new: true, upsert: true },
        );
      } else {
        logEntry.senderEmail = senderEmail;
        if (emailToken) {
          logEntry.senderTokenId = emailToken._id;
        }
        await logEntry.save();
      }

      // ===========================
      // UNSUBSCRIBE CHECK
      // ===========================
      const alreadyOptedOut = await isUnsubscribed(
        recipientData.email,
        campaign.userId,
        campaignId,
      );

      if (alreadyOptedOut) {
        logger.info(
          `[JOB:${job.id}] Skipping ${recipientData.email} — unsubscribed`,
        );

        await campaignRecipientLogSchema.updateOne(
          { _id: logEntry._id },
          { status: "unsubscribed" },
        );

        const updated = await campaignSchema.findByIdAndUpdate(
          campaignId,
          { $inc: { skipCount: 1 } },
          { new: true },
        );

        emitCampaignUpdated(campaign.userId, campaignId);

        if (
          updated.sentCount + updated.failedCount + updated.skipCount >=
          updated.totalRecipients
        ) {
          await campaignSchema.updateOne(
            { _id: campaignId, status: { $ne: "completed" } },
            {
              status: "completed",
              completedAt: new Date(),
              campaignMail: senderEmail || campaign.campaignMail,
            },
          );

          logger.info(`Campaign ${campaignId} marked COMPLETED (with skips)`);
          emitCampaignUpdated(campaign.userId, campaignId);
        }

        return { success: true, skipped: true };
      }

      // ===========================
      // GENERATE UNSUBSCRIBE TOKEN
      // ===========================
      const token = await generateUnsubscribeToken(
        recipientData.email,
        campaign.userId,
        campaignId,
      );

      const unsubscribeUrl = `${config.BACKEND_BASE_URL}/campaign/unsubscribe?token=${token}`;

      await campaignSchema.updateOne(
        {
          _id: campaignId,
          status: { $in: ["queued", "processing"] },
        },
        {
          $set: { status: "sending", startedAt: new Date() },
          $unset: { holdReason: 1, resumeAt: 1 },
        },
      );

      await sleep(RATE_DELAY_MS);

      const template = await templateSchema.findById(templateId);
      if (!template) throw new Error("Template not found");

      /* ─────────────────────────────────────────────
         ENRICH with business profile + media data
         so marketing template variables are populated
      ───────────────────────────────────────────── */
      const marketingData = await buildMarketingTemplateData(
        campaign.userId,
        outReachWebsiteId,
        isAdminOutreach,
      );
      const rawContext = { ...marketingData, ...recipientData };
      const templateContext = normalizeTemplateContext(rawContext);

      let subject = "";
      let html = "";
      try {
        subject = Handlebars.compile(template.subject || "")(templateContext);
        html = Handlebars.compile(template.html || "")(templateContext);
      } catch (tmplErr) {
        logger.error(
          `[JOB:${job.id}] Template compilation error for ${recipientData.email}: ${tmplErr.message}`,
        );
        throw new Error(`Template Error: ${tmplErr.message}`);
      }

      const footer = buildEmailFooter(
        unsubscribeUrl,
        campaign.companyName,
        campaign.companyAddress,
      );

      html = `${html}${footer}`;

      // ===========================
      // OPEN & CLICK TRACKING INJECTION
      // ===========================
      if (logEntry && logEntry._id) {
        const openPixelUrl = `${config.BACKEND_BASE_URL}/campaign/track/open/${logEntry._id}`;
        html += `\n<img src="${openPixelUrl}" width="1" height="1" style="display:none; visibility:hidden; width:1px; height:1px;" alt="" />`;

        // Rewrite links for click tracking
        html = html.replace(/href="([^"]+)"/gi, (match, url) => {
          // Skip mailto:, tel:, anchor links, and the unsubscribe link
          if (
            url.startsWith("mailto:") ||
            url.startsWith("tel:") ||
            url.startsWith("#") ||
            url.includes("/campaign/unsubscribe") ||
            url.includes("/api/unsubscribe")
          ) {
            return match;
          }

          const clickTrackingUrl = `${config.BACKEND_BASE_URL}/campaign/track/click/${logEntry._id}?url=${encodeURIComponent(url)}`;
          return `href="${clickTrackingUrl}"`;
        });
      }

      let formattedAttachments = [];

      if (template.attachments?.length) {
        formattedAttachments = template.attachments.map((att) => ({
          filename: att.originalName,
          url: att.url,
          contentType: att.contentType,
        }));
      }

      if (job.data.dynamicAttachments?.length) {
        formattedAttachments.push(
          ...job.data.dynamicAttachments.map((att) => ({
            filename: att.filename || att.originalName,
            url: att.url,
            contentType: att.contentType,
          })),
        );
      }

      // ===========================
      // PRE-SEND: DAILY LIMIT GUARD (race condition protection)
      // ===========================
      if (emailToken) {
        // Re-fetch token from DB to get the latest dailyLimit value
        const freshToken = await EmailToken.findById(emailToken._id);
        if (!freshToken || freshToken.dailyLimit <= 0) {
          logger.warn(
            `[JOB:${job.id}] Daily limit depleted for ${emailToken.email} before send. Re-queueing ${recipientData.email}.`,
          );
          await campaignRecipientLogSchema.updateOne(
            { campaignId, recipientEmail: recipientData.email },
            {
              $set: { status: "queued" },
              $unset: { senderEmail: 1, senderTokenId: 1 },
            },
          );
          if (freshToken) {
            await scheduleEmailLimitReset(freshToken);
          }
          try {
            await agenda.now(EMAIL_CAMPAIGN_DISPATCHER_JOB);
          } catch (e) {
            logger.error(
              `[JOB:${job.id}] Failed to trigger dispatcher after pre-send limit check: ${e.message}`,
            );
          }
          return { success: false, reason: "daily_limit_depleted_before_send" };
        }
      }

      // ===========================
      // PROVIDER SEND & MESSAGE ID CAPTURE
      // ===========================
      const ccEmail = isAdminOutreach ? "mahesh@mytek.in" : undefined;
      let providerMessageId = null;

      if (senderProvider === "microsoft") {
        const { accessToken } = await getValidMicrosoftToken(
          campaign.userId,
          senderEmail,
        );

        const msAttachments = formattedAttachments.length
          ? await buildMicrosoftAttachments(formattedAttachments)
          : [];

        const msRes = await axios.post(
          "https://graph.microsoft.com/v1.0/me/sendMail",
          {
            message: {
              subject,
              body: { contentType: "HTML", content: html },
              toRecipients: [
                { emailAddress: { address: recipientData.email } },
              ],
              ...(ccEmail && {
                ccRecipients: [{ emailAddress: { address: ccEmail } }],
              }),
              attachments: msAttachments,
            },
            saveToSentItems: true,
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              Prefer: 'IdType="ImmutableId"',
            },
          },
        );

        providerMessageId =
          msRes.headers?.["client-request-id"] ||
          msRes.headers?.["request-id"] ||
          `ms-${Date.now()}`;
      } else if (senderProvider === "google") {
        const googleToken = await getValidGoogleToken(
          campaign.userId,
          senderEmail,
        );
        const oauth2Client = googleToken.oauth2Client;

        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        const encodedMessage = await buildRawGmailMessage(
          senderEmail,
          recipientData.email,
          ccEmail,
          subject,
          html,
          formattedAttachments,
          unsubscribeUrl,
        );

        const gmailRes = await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encodedMessage },
        });

        providerMessageId = gmailRes?.data?.id || `gmail-${Date.now()}`;
      } else if (
        senderProvider === "custom" ||
        senderProvider === "imap_smtp"
      ) {
        if (!emailToken) throw new Error("Custom token connection is missing");

        const { decrypt } = await import("../../utils/encryptionForMail.js");
        const decryptedPassword = decrypt(emailToken.appPassword);

        const smtpPortNum = Number(emailToken.metadata.smtpPort);
        const transporter = nodemailer.createTransport({
          host: emailToken.metadata.smtpHost,
          port: smtpPortNum,
          secure: smtpPortNum === 465,
          ...(smtpPortNum === 587 && { requireTLS: true }),
          auth: {
            user: emailToken.email,
            pass: decryptedPassword,
          },
          tls: {
            rejectUnauthorized: false,
          },
        });

        const smtpInfo = await transporter.sendMail({
          from: `"${campaign.companyName || emailToken.email}" <${emailToken.email}>`,
          to: recipientData.email,
          cc: ccEmail,
          subject,
          html,
          attachments: formattedAttachments.map((a) => ({
            filename: a.filename,
            path: a.url,
            contentType: a.contentType,
          })),
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });

        providerMessageId = smtpInfo?.messageId || `smtp-${Date.now()}`;
      } else if (senderProvider === "system") {
        const systemInfo = await sendOutlookMailDirect({
          to: recipientData.email,
          cc: ccEmail,
          subject,
          htmlBody: html,
          attachments: formattedAttachments.map((a) => ({
            filename: a.filename,
            path: a.url,
            contentType: a.contentType,
          })),
        });

        providerMessageId =
          systemInfo?.messageId || systemInfo?.id || `sys-${Date.now()}`;
      } else {
        throw new Error(`Unsupported provider: ${senderProvider}`);
      }

      // ===========================
      // DECREMENT DAILY LIMIT & UPDATE TOKEN STATS (ATOMIC)
      // ===========================
      if (emailToken) {
        const todayStr = moment().utcOffset("+05:30").format("YYYY-MM-DD");

        // Atomic decrement: only decrement if dailyLimit > 0 to prevent going negative
        const updatedToken = await EmailToken.findOneAndUpdate(
          { _id: emailToken._id, dailyLimit: { $gt: 0 } },
          {
            $inc: { dailyLimit: -1, lifetimeSent: 1 },
            $set: { lastUsedAt: new Date() },
          },
          { new: true },
        );

        if (!updatedToken) {
          // dailyLimit was already 0 — email was sent but limit tracking missed
          // Just increment lifetimeSent without decrementing further
          await EmailToken.findByIdAndUpdate(emailToken._id, {
            $inc: { lifetimeSent: 1 },
            $set: { lastUsedAt: new Date() },
          });
          logger.warn(
            `[JOB:${job.id}] dailyLimit was already 0 for ${emailToken.email} at decrement time. Email was sent but limit was not decremented.`,
          );
        } else if (updatedToken.dailyLimit <= 0) {
          // Limit just hit 0 — schedule reset
          await EmailToken.updateOne(
            { _id: emailToken._id },
            {
              $set: {
                dailyLimit: 0,
                "metadata.limitDepletedAt": new Date(),
              },
            },
          );
          const finalToken = await EmailToken.findById(emailToken._id);
          await scheduleEmailLimitReset(finalToken);
        }

        // Record historical usage log
        const EmailDailyUsageLog = (
          await import(
            "../../models/Campaign/EmailCampaign/emailDailyUsageLogSchema.js"
          )
        ).default;
        await EmailDailyUsageLog.updateOne(
          { tokenId: emailToken._id, date: todayStr },
          {
            $setOnInsert: { email: emailToken.email },
            $inc: { sentCount: 1 },
          },
          { upsert: true },
        );

        const EmailRollingUsage = (
          await import(
            "../../models/Campaign/EmailCampaign/emailRollingUsageSchema.js"
          )
        ).default;
        await EmailRollingUsage.create({
          tokenId: emailToken._id,
          expiresAt: new Date(Date.now() + REFILL_WINDOW_MS),
          count: 1,
          restored: false,
        });
      }

      // ===========================
      // UPDATE SENT COUNT, MESSAGE ID & RECIPIENT LOG
      // ===========================
      const updatedLog = await campaignRecipientLogSchema.findOneAndUpdate(
        {
          _id: logEntry._id,
          status: { $ne: "sent" },
        },
        {
          $set: {
            status: "sent",
            messageId: providerMessageId,
            sentAt: new Date(),
          },
        },
        { new: true },
      );

      let updated = null;
      if (updatedLog) {
        updated = await campaignSchema.findByIdAndUpdate(
          campaignId,
          { $inc: { sentCount: 1 } },
          { new: true },
        );
        emitCampaignUpdated(campaign.userId, campaignId);
      } else {
        updated = await campaignSchema.findById(campaignId);
      }

      // ===========================
      // CREDIT TRACKING
      // ===========================
      try {
        const creditResult = await trackAndDeductFeatureCredit({
          userId: campaign.userId,
          featureKey: "email",
          usageCount: 1,
          referenceId: campaignId,
          referenceModel: "EmailCampaign",
          description: `Sent email to ${recipientData.email}`,
          metadata: {
            referenceId: campaignId,
            referenceModel: "Email",
            title: `Email Campaign — ${subject?.substring(0, 60) || "Untitled"}`,
            extra: {
              recipientEmail: recipientData.email,
              templateId: templateId,
              subject: subject || null,
            },
          },
        });

        logger.info(
          `[JOB:${job.id}] Credit deducted | via ${creditResult.via}`,
        );
      } catch (creditErr) {
        logger.error(
          `[JOB:${job.id}] Credit deduction failed: ${creditErr.message}`,
        );
      }

      logger.info(
        `[JOB:${job.id}] Sent to ${recipientData.email} in ${
          Date.now() - start
        }ms`,
      );

      // ===========================
      // COMPLETION CHECK
      // ===========================
      if (
        updated.sentCount + updated.failedCount + updated.skipCount >=
        updated.totalRecipients
      ) {
        await campaignSchema.updateOne(
          { _id: campaignId, status: { $ne: "completed" } },
          {
            status: "completed",
            completedAt: new Date(),
            campaignMail: senderEmail || campaign.campaignMail,
          },
        );

        logger.info(`Campaign ${campaignId} marked COMPLETED`);
        emitCampaignUpdated(campaign.userId, campaignId);
      }

      return { success: true };
    } catch (error) {
      // Check if it's a fatal token/auth error (e.g. invalid grant or SMTP auth failed)
      const isAuthError =
        error.message === "RECONNECT_REQUIRED" ||
        (error.message &&
          (error.message.toLowerCase().includes("invalid_grant") ||
            error.message.toLowerCase().includes("authentication failed") ||
            error.message
              .toLowerCase()
              .includes("invalid authentication token") ||
            error.message
              .toLowerCase()
              .includes("insufficient authentication scopes") ||
            error.message.toLowerCase().includes("insufficient permissions") ||
            error.message.toLowerCase().includes("insufficient_scope") ||
            error.message.toLowerCase().includes("eauth") ||
            error.message.toLowerCase().includes("unauthorized_client") ||
            error.message.includes("535")));

      if (isAuthError && emailToken) {
        logger.error(
          `[JOB:${job.id}] Fatal auth error for connection ${emailToken.email}. Suspending token and re-queueing recipient.`,
        );
        try {
          emailToken.isActive = false;
          emailToken.status = "expired";
          await emailToken.save();

          await campaignRecipientLogSchema.updateOne(
            { campaignId, recipientEmail: recipientData.email },
            {
              $set: { status: "queued" },
              $unset: { senderEmail: 1, senderTokenId: 1 },
            },
          );
        } catch (dbErr) {
          logger.error(
            `[JOB:${job.id}] DB error in fatal auth cleanup: ${dbErr.message}`,
          );
        }
        return { success: false, reason: "fatal_auth_suspended" };
      }

      // Check if real-time daily sending quota was exceeded from provider (Google / Microsoft / SMTP)
      const isQuotaError =
        error.message &&
        (error.message.toLowerCase().includes("daily sending quota exceeded") ||
          error.message.toLowerCase().includes("daily limit reached") ||
          error.message.toLowerCase().includes("daily quota exceeded") ||
          error.message.toLowerCase().includes("submission quota exceeded") ||
          error.message.toLowerCase().includes("sending limit reached") ||
          error.message.toLowerCase().includes("maximum daily send limit") ||
          error.message.toLowerCase().includes("quotaexceeded") ||
          error.message.includes("550 5.4.5") ||
          error.message.includes("554 5.2.2"));

      if (isQuotaError && emailToken) {
        logger.warn(
          `\n======================================================================\n` +
            `[REAL-TIME QUOTA EXCEEDED] Provider Daily Limit Reached for ${emailToken.email}\n` +
            `👉 Marking ${emailToken.email} as maxed out in Redis for today.\n` +
            `👉 Re-queueing recipient ${recipientData.email} to automatically switch to next account!\n` +
            `======================================================================\n`,
        );
        try {
          // Set quotaExceededAt timestamp in MongoDB so Dispatcher pauses this account for 24h
          await EmailToken.findByIdAndUpdate(emailToken._id, {
            $set: {
              limitConfidence: "high",
              limitSource: "discovered_429",
              "metadata.quotaExceededAt": new Date(),
              "metadata.limitDiscoveredAt": new Date(),
            },
          });

          logger.info(
            `[LIMIT DISCOVERY] ${emailToken.email}: Provider limit reached! Set quotaExceededAt timestamp.`,
          );

          const finalToken = await EmailToken.findById(emailToken._id);
          await scheduleEmailLimitReset(finalToken);

          // Re-queue the recipient so the 2nd account (or next day) picks it up
          await campaignRecipientLogSchema.updateOne(
            { campaignId, recipientEmail: recipientData.email },
            {
              $set: { status: "queued" },
              $unset: { senderEmail: 1, senderTokenId: 1 },
            },
          );

          try {
            await agenda.now(EMAIL_CAMPAIGN_DISPATCHER_JOB);
          } catch (e) {
            logger.error(
              `[JOB:${job.id}] Failed to trigger dispatcher after 429 quota error: ${e.message}`,
            );
          }
        } catch (dbErr) {
          logger.error(
            `[JOB:${job.id}] DB/Redis error in quota limit cleanup: ${dbErr.message}`,
          );
        }
        return {
          success: false,
          reason: "daily_quota_limit_exceeded_requeued",
        };
      }

      if (
        error.message &&
        error.message.toLowerCase().includes("address not found")
      ) {
        try {
          const token = await generateUnsubscribeToken(
            recipientData.email,
            campaign.userId,
            campaignId,
          );
          await Unsubscribe.findOneAndUpdate(
            { token },
            { unsubscribedAt: new Date() },
          );
          logger.info(
            `[JOB:${job.id}] Auto-unsubscribed ${recipientData.email} due to Address Not Found.`,
          );
        } catch (unsubErr) {
          logger.error(
            `[JOB:${job.id}] Failed to auto-unsubscribe: ${unsubErr.message}`,
          );
        }
      }

      const isRateLimit =
        error.message &&
        (error.message.toLowerCase().includes("user-rate limit exceeded") ||
          error.message.toLowerCase().includes("too many requests") ||
          error.message.toLowerCase().includes("rate limit") ||
          error.message.includes("429"));

      if (isRateLimit) {
        let delayMs = 15 * 60 * 1000; // 15 mins default
        const retryMatch = error.message.match(/Retry after\s+([^\s\(\)]+)/i);
        if (retryMatch && retryMatch[1]) {
          const retryDate = new Date(retryMatch[1]);
          if (!isNaN(retryDate.getTime())) {
            delayMs = Math.max(retryDate.getTime() - Date.now(), 60000); // at least 1 min
          }
        }

        logger.warn(
          `[JOB:${job.id}] Rate limit hit for ${recipientData.email}. Delaying job by ${delayMs}ms. Error: ${error.message}`,
        );

        await campaignSchema.findByIdAndUpdate(campaignId, {
          status: "paused",
          holdReason:
            "Email Provider Rate Limit Exceeded. Pausing temporarily to avoid account restrictions.",
          resumeAt: new Date(Date.now() + delayMs),
        });

        const maxAttempts = job.opts.attempts || 3;
        const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

        if (!isFinalAttempt) {
          throw new DelayedError(delayMs);
        } else {
          logger.error(
            `[JOB:${job.id}] Rate limit hit and all retries exhausted for ${recipientData.email}.`,
          );
        }
      }

      if (emailToken) {
        await EmailToken.updateOne(
          { _id: emailToken._id },
          { $inc: { lifetimeFailed: 1 } },
        );

        const todayStr = moment().utcOffset("+05:30").format("YYYY-MM-DD");
        const EmailDailyUsageLog = (
          await import(
            "../../models/Campaign/EmailCampaign/emailDailyUsageLogSchema.js"
          )
        ).default;
        await EmailDailyUsageLog.updateOne(
          { tokenId: emailToken._id, date: todayStr },
          {
            $setOnInsert: { email: emailToken.email },
            $inc: { failedCount: 1 },
          },
          { upsert: true },
        );
      }

      const isBounceError =
        error.message &&
        (error.message.toLowerCase().includes("address not found") ||
          error.message.toLowerCase().includes("user unknown") ||
          error.message.toLowerCase().includes("mailbox unavailable") ||
          error.message.toLowerCase().includes("recipient rejected") ||
          error.message.toLowerCase().includes("does not exist") ||
          error.message.toLowerCase().includes("invalid recipient") ||
          error.message.includes("550") ||
          error.message.includes("554"));

      const isTemplateError =
        error.message &&
        (error.message.includes("Template Error") ||
          error.message.includes("Missing helper"));

      const isPermanentError = isBounceError || isTemplateError;

      const maxAttempts = job.opts.attempts || 3;
      const isFinalAttempt = job.attemptsMade >= maxAttempts - 1;

      // If it's a transient error and not the final attempt, let BullMQ retry WITHOUT polluting the DB
      if (!isPermanentError && !isFinalAttempt) {
        logger.warn(
          `[JOB:${job.id}] Transient error for ${recipientData.email}: ${error.message}. Retrying (Attempt ${job.attemptsMade + 1}/${maxAttempts})...`,
        );
        throw error;
      }

      // If it's a permanent error OR the final attempt, update DB
      const failureStatus = isBounceError ? "bounced" : "rejected";

      let updatedLog = null;
      if (logEntry) {
        updatedLog = await campaignRecipientLogSchema
          .findOneAndUpdate(
            {
              _id: logEntry._id,
              status: { $nin: ["sent", "rejected", "bounced", "skipped"] },
            },
            {
              $set: {
                status: failureStatus,
                errorReason: error.message || "Email dispatch failed",
              },
            },
            { new: true },
          )
          .catch(() => null);
      }

      let updated = null;
      if (updatedLog) {
        updated = await campaignSchema.findByIdAndUpdate(
          campaignId,
          { $inc: { failedCount: 1 } },
          { new: true },
        );
        emitCampaignUpdated(campaign.userId, campaignId);
      } else {
        updated = await campaignSchema.findById(campaignId);
      }

      logger.error(
        `[JOB:${job.id}] Failed permanently for ${recipientData.email}: ${error.message}`,
      );

      if (
        updated &&
        updated.sentCount + updated.failedCount + updated.skipCount >=
          updated.totalRecipients
      ) {
        await campaignSchema.updateOne(
          { _id: campaignId, status: { $ne: "completed" } },
          {
            status: "completed",
            completedAt: new Date(),
            campaignMail: senderEmail || campaign.campaignMail,
          },
        );

        logger.info(`Campaign ${campaignId} marked COMPLETED (after failure)`);
        emitCampaignUpdated(campaign.userId, campaignId);
      }

      return {
        success: false,
        reason: isTemplateError ? "template_compile_error" : failureStatus,
        error: error.message,
      };
    }
  },
  {
    connection,
    concurrency: 1,
    lockDuration: 60000 * 3,
  },
);

export default worker;
