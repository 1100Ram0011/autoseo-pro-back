import logger from "../../config/logger.js";
import MetaGraphClient from "./metaFbWhatsapp.client.js";
import Campaign from "../models/metaWhatsappCampaignSchema.js";
import ContactList from "../models/metaWhatsappCampaignContactListSchema.js";
import Contact from "../models/metaWhatsappCampaignContactsSchema.js";
import LogService from "./metaWhatsappLog.service.js";
import { resolveMessagePrice, convertPriceToCredits, calculateCampaignCost, getUserAvailableCredits } from "./metaWhatsappPricing.service.js";
import { deductDynamicCredit, refundDynamicCredit } from "../../utils/creditTracker.js";
import { syncWithMetaGraph } from "../utils/metaSync.util.js";

// ─── CONFIG ───────────────────────────────────────────────────────────────────

// Delay between each message send to avoid rate limiting (5 seconds per recipient)
const SEND_DELAY_MS = 5000;

// ─── HELPERS ──────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build the Meta Graph API message payload for a single recipient.
 * Uses recipient.variables (Map or plain object) to resolve dynamically.
 * Keys in recipient.variables match: 'header_text', 'header_url', 'body_1', 'body_2', 'button_1', etc.
 */
const buildMessagePayload = (
  phoneNumberId,
  recipient,
  template,
  variableMapping = {},
) => {
  // Convert recipient variables (Map or object) into plain key-value object
  let recipientVars = recipient.variables;
  if (recipientVars && typeof recipientVars.toObject === 'function') {
    recipientVars = recipientVars.toObject();
  } else if (recipientVars && typeof recipientVars.entries === 'function') {
    recipientVars = Object.fromEntries(recipientVars.entries());
  }
  if (!recipientVars || typeof recipientVars !== 'object') {
    recipientVars = {};
  }

  // Delegate component parameter construction directly to template schema method
  let components = [];
  if (typeof template.buildSendComponents === "function") {
    components = template.buildSendComponents(recipientVars);
  } else {
    // Fallback: build components manually if Mongoose instance method is not present
    const getVar = (key) => recipientVars[key] || "";

    // 1. Header Handling
    if (template.header?.format && template.header.format !== "NONE") {
      const headerFormat = template.header.format.toUpperCase();
      const headerParams = [];

      if (headerFormat === "TEXT") {
        if (template.header.text?.includes("{{1}}")) {
          const val = getVar("header_text") || getVar("header_1");
          if (val) headerParams.push({ type: "text", text: String(val) });
        }
      } else if (["IMAGE", "VIDEO", "DOCUMENT"].includes(headerFormat)) {
        const url = getVar("header_url") || template.header?.mediaUrl;
        if (url) {
          headerParams.push({
            type: headerFormat.toLowerCase(),
            [headerFormat.toLowerCase()]: { link: url }
          });
        }
      }

      if (headerParams.length > 0) {
        components.push({
          type: "header",
          parameters: headerParams
        });
      }
    }

    // 2. Body Handling
    if (template.body) {
      const matches = [...template.body.matchAll(/\{\{(\d+)\}\}/g)];
      const uniqueNums = [...new Set(matches.map((m) => parseInt(m[1], 10)))].sort((a, b) => a - b);
      if (uniqueNums.length > 0) {
        const bodyParams = uniqueNums.map(n => ({
          type: "text",
          text: String(getVar(`body_${n}`) || getVar(String(n)) || "")
        }));
        if (bodyParams.length > 0) {
          components.push({
            type: "body",
            parameters: bodyParams
          });
        }
      }
    }

    // 3. Button Handling
    if (template.buttons && template.buttons.length > 0) {
      template.buttons.forEach((btn, idx) => {
        const btnNum = idx + 1;
        let paramObj = null;
        if (btn.type === "URL" && btn.url?.includes("{{1}}")) {
          const val = getVar(`button_${btnNum}`) || getVar("button_1");
          if (val) paramObj = { type: "text", text: String(val) };
        } else if (btn.type === "COPY_CODE") {
          const val = getVar(`button_${btnNum}`) || getVar("coupon_code") || btn.example?.[0] || "PROMO";
          paramObj = { type: "coupon_code", coupon_code: String(val) };
        }
        if (paramObj) {
          components.push({
            type: "button",
            sub_type: btn.type.toLowerCase(),
            index: String(idx),
            parameters: [paramObj]
          });
        }
      });
    }
  }

  let phone = String(recipient.phoneNumber || "").replace(/\D/g, "").replace(/^0+/, "");
  if (phone.length === 10) {
    phone = "91" + phone;
  }

  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language || "en" },
      ...(components.length > 0 && { components }),
    },
  };
};

/**
 * Send a single WhatsApp template message via Meta Graph API.
 * Routes to MM Lite API if template requires it.
 */
const sendWhatsAppMessage = async (phoneNumberId, accessToken, payload, useMMLite = false) => {
  const fullPayload = {
      recipient_type: "individual",
      ...payload,
  };

  let response;
  // if (useMMLite) {
  //     const MetaMarketingMessagesService = (await import('./metaMarketingMessages.service.js')).default;
  //     response = await MetaMarketingMessagesService.sendMMLite(phoneNumberId, accessToken, fullPayload);
  // } else {
  //     response = await MetaGraphClient.sendMessage(phoneNumberId, accessToken, fullPayload);
  //   }
  response = await MetaGraphClient.sendMessage(phoneNumberId, accessToken, fullPayload);

  return { metaMessageId: response?.messages?.[0]?.id || null, fullPayload };
};

// ─── EXPAND RECIPIENTS ────────────────────────────────────────────────────────
/**
 * If campaign uses a contactListId, expand the list into recipient objects
 * and write them into campaign.recipients before sending.
 * Skips opted-out and soft-deleted contacts.
 */
const expandRecipientsFromList = async (campaign) => {
  if (!campaign.contactListId) return;

  // Already expanded in a previous (paused) run — don't re-expand
  if (campaign.recipients && campaign.recipients.length > 0) return;

  const list = await ContactList.findById(campaign.contactListId).lean();
  if (!list) throw new Error("Contact list not found during expansion");

  const contacts = await Contact.find({
    _id: { $in: list.contactIds },
    optedOut: false,
    isDeleted: false,
  }).lean();

  campaign.recipients = contacts.map((c) => {
    // 1. Gather all available fields for this contact
    const availableFields = {
        name: c.name || "",
        phone: c.phone || "",
        email: c.email || "",
        ...(c.customFields || {})
    };

    // 2. Resolve variableMapping into recipient.variables
    const resolvedVariables = {};
    if (campaign.variableMapping) {
        // campaign.variableMapping is a Map, but sometimes it might be a plain object
        const mappingEntries = typeof campaign.variableMapping.entries === 'function' 
            ? Array.from(campaign.variableMapping.entries()) 
            : Object.entries(campaign.variableMapping);

        for (const [varKey, mappedValue] of mappingEntries) {
            if (mappedValue.startsWith("__STATIC__: ")) {
                resolvedVariables[varKey] = mappedValue.replace("__STATIC__: ", "");
            } else if (mappedValue.startsWith("__STATIC__:url:")) { // Specifically for uploads if needed
                resolvedVariables[varKey] = mappedValue.replace("__STATIC__:url:", "");
            } else {
                resolvedVariables[varKey] = availableFields[mappedValue] || "";
            }
        }
    }

    // Fallback: If no mapping was provided, just put all customFields inside (legacy behavior)
    if (Object.keys(resolvedVariables).length === 0) {
        Object.assign(resolvedVariables, c.customFields || {});
    }

    return {
      phoneNumber: c.phone,
      name: c.name || "",
      variables: resolvedVariables,
      status: "PENDING",
      sentAt: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
      errorCode: null,
      errorMessage: null,
      metaMessageId: null,
    };
  });

  campaign.stats.total = campaign.recipients.length;
  await campaign.save();

  logger.info(
    `[Campaign] Expanded ${campaign.recipients.length} recipients for campaign ${campaign._id}`,
  );
};

// ─── RUN CAMPAIGN ─────────────────────────────────────────────────────────────
/**
 * Called after launch. Processes all PENDING recipients sequentially.
 * Designed to be resumable — skips non-PENDING recipients so a paused
 * campaign can be resumed without re-sending.
 */
export const runCampaign = async (campaignId) => {
  const campaign = await Campaign.findById(campaignId)
    .populate("templateId")
    .populate({
      path: "numberId",
      select: "+accessToken phoneNumberId wabaId",
    });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  console.log("campaign - ", campaign);

  // ── Mark as RUNNING ───────────────────────────────────────────────────────
  campaign.status = "RUNNING";
  campaign.startedAt = campaign.startedAt || new Date();
  await campaign.save();

  logger.info(`[Campaign] Started: ${campaign.name} (${campaign._id})`);

  try {
    // ── Expand contact list → recipients (idempotent) ─────────────────────
    await expandRecipientsFromList(campaign);

    const template = campaign.templateId;
    const waNumber = campaign.numberId;
    const accessToken = waNumber?.accessToken;
    const phoneNumberId = waNumber?.phoneNumberId;

    if (!template) {
      throw new Error("Campaign has no valid template attached");
    }

    if (!accessToken || !phoneNumberId) {
      throw new Error(
        "WhatsApp number is missing accessToken or phoneNumberId",
      );
    }

    // ── Re-fetch to get up-to-date recipients after expansion ─────────────
    const freshCampaign = await Campaign.findById(campaignId);

    // ── Just-In-Time Number Status Sync ────────────────────────────────────────
    try {
        await syncWithMetaGraph({
            document: waNumber,
            phoneNumberId,
            accessToken,
            fetchFromMetaFn: () => MetaGraphClient.getPhoneNumberDetails(phoneNumberId, accessToken),
            extractLiveStateFn: (res) => res,
            compareAndUpdateFn: (doc, liveData) => {
                let needsSave = false;
                if (liveData.quality_rating && doc.qualityRating !== liveData.quality_rating.toUpperCase()) {
                    doc.qualityRating = liveData.quality_rating.toUpperCase();
                    needsSave = true;
                }
                if (liveData.messaging_limit_tier && doc.messagingLimit !== liveData.messaging_limit_tier) {
                    doc.messagingLimit = liveData.messaging_limit_tier;
                    needsSave = true;
                }
                if (liveData.status && doc.status !== liveData.status) {
                    doc.status = liveData.status;
                    needsSave = true;
                }
                return needsSave;
            }
        });
        logger.info(`[Campaign] JIT sync completed for ${phoneNumberId} before launching campaign ${campaignId}`);
    } catch (syncErr) {
        logger.warn(`[Campaign] Failed to run JIT status sync for ${campaignId}: ${syncErr.message}`);
    }

    // ── Pre-Flight Template Quality Protection Check ────────────────────────
    if (waNumber?.autoTemplateDisable?.enabled) {
      if (template.status === "PAUSED" || template.status === "DISABLED" || template.qualityScore === "RED") {
        logger.warn(`[Campaign] Stopping execution of ${campaignId}: Template '${template.name}' is ${template.status || 'RED quality'}. Auto-paused by Template Protection.`);
        freshCampaign.status = "PAUSED";
        freshCampaign.pausedAt = new Date();
        freshCampaign.autoPausedByTemplateProtection = true;
        freshCampaign.failureReason = `Auto-paused: Template '${template.name}' status is ${template.status} with ${template.qualityScore || 'RED'} quality rating (Template Protection enabled).`;
        await freshCampaign.save();
        return;
      }
    }

    // ── Total Remaining Cost & Credit Pre-Check ────────────────────────────
    const costInfo = await calculateCampaignCost({
      template,
      recipients: freshCampaign.recipients,
      userId: campaign.userId
    });

    const availableCredits = await getUserAvailableCredits(campaign.userId);
    const requiredCredits = costInfo.totalEstimatedCredits || 0;

    if (requiredCredits > availableCredits) {
      logger.warn(
        `[Campaign] Stopping execution of ${campaignId}: Insufficient credit balance (Required: ${requiredCredits}, Available: ${availableCredits})`
      );

      freshCampaign.status = "PAUSED";
      freshCampaign.pausedAt = new Date();
      freshCampaign.failureReason = `Scheduled/background run stopped due to insufficient credit balance (Required: ${requiredCredits}, Available: ${availableCredits})`;
      await freshCampaign.save();
      return; // Stop execution cleanly!
    }

    // ── Send loop ─────────────────────────────────────────────────────────
    for (let i = 0; i < freshCampaign.recipients.length; i++) {
      // Check if campaign was paused or cancelled between iterations
      const current = await Campaign.findById(campaignId)
        .select("status")
        .lean();
      if (current.status === "PAUSED") {
        logger.info(`[Campaign] Paused at recipient ${i} — stopping loop`);
        return;
      }
      if (current.status === "CANCELLED") {
        logger.info(`[Campaign] Cancelled — stopping loop`);
        return;
      }

      const recipient = freshCampaign.recipients[i];

      // Skip already-processed recipients (for resumed campaigns)
      if (recipient.status !== "PENDING") continue;

      // ── Credit Pre-check and Deduction ──
      let resolvedCategory = String(template.category || "marketing").toLowerCase().trim();
      let creditAmount = 0;
      let priceInfo = null;

      try {
        priceInfo = await resolveMessagePrice(recipient.phoneNumber, resolvedCategory, true);
        creditAmount = await convertPriceToCredits(priceInfo.price, priceInfo.currency);
      } catch (priceErr) {
        logger.error(`[Campaign] Price resolution failed for ${recipient.phoneNumber}: ${priceErr.message}`);
        // Default fallback to Indian marketing template price (0.9631 credits)
        priceInfo = { price: 0.9631, currency: "INR" }; 
        creditAmount = 0.9631;
      }

      if (creditAmount > 0 && campaign.userId) {
        try {
          await deductDynamicCredit({
            userId: campaign.userId,
            creditAmount: creditAmount,
            serviceName: "whatsappCampaign",
            referenceId: campaign._id,
            referenceModel: "MetaWhatsappCampaign",
            description: `WhatsApp Campaign message to ${recipient.phoneNumber} (Category: ${resolvedCategory})`,
            metadata: {
              referenceId: campaign._id,
              referenceModel: "MetaWhatsappCampaign",
              title: `WhatsApp Campaign Message`,
              extra: {
                price: priceInfo.price,
                currency: priceInfo.currency,
                category: resolvedCategory,
                recipient: recipient.phoneNumber
              }
            }
          });
        } catch (deductErr) {
          logger.warn(`[Campaign] Insufficient credits or wallet deduction failed for recipient ${recipient.phoneNumber}: ${deductErr.message}`);
          
          // Instead of failing and losing the recipient, set status back to PENDING so they can top-up and resume
          freshCampaign.recipients[i].status = "PENDING";
          freshCampaign.markModified("recipients");
          
          // Transition campaign status to PAUSED automatically
          freshCampaign.status = "PAUSED";
          freshCampaign.pausedAt = new Date();
          freshCampaign.markModified("stats");
          await freshCampaign.save();

          logger.info(`[Campaign] Automatically paused campaign ${campaignId} due to wallet balance limitations.`);
          return; // Exit campaign run loop!
        }
      }

      try {
        const payload = buildMessagePayload(
          phoneNumberId,
          recipient,
          template,
          campaign.variableMapping,
        );
        const { metaMessageId, fullPayload } = await sendWhatsAppMessage(
          phoneNumberId,
          accessToken,
          payload,
          template.useMMLite
        );

        freshCampaign.recipients[i].status = "SENT";
        freshCampaign.recipients[i].sentAt = new Date();
        freshCampaign.recipients[i].metaMessageId = metaMessageId;
        freshCampaign.stats.sent = (freshCampaign.stats.sent || 0) + 1;

        logger.info(`[Campaign] ✅ Sent to ${recipient.phoneNumber} (MMLite: ${!!template.useMMLite})`);

        // --- NEW LOGGING SYSTEM ---
        const logDoc = await LogService.logOutboundMessage({
            userId: campaign.userId,
            numberId: campaign.numberId?._id,
            wabaId: campaign.numberId?.wabaId,
            phoneNumberId: phoneNumberId,
            whatsappNumber: campaign.numberId?.phoneNumber || campaign.numberId?.displayName,
            to: recipient.phoneNumber,
            metaMessageId: metaMessageId,
            messageType: "template",
            templateName: template.name,
            category: resolvedCategory, // Use the correct template category!
            campaignId: campaign._id,
            campaignName: campaign.name,
            content: `Template: ${template.name}`,
            originalPayload: fullPayload,
            origin: "campaign"
        });

        if (logDoc && logDoc._id) {
            freshCampaign.recipients[i].logId = logDoc._id;
        }
      } catch (err) {
        console.error("Meta API Error:", err.message);

        // Refund the deducted credits on send failure
        if (creditAmount > 0 && campaign.userId) {
          try {
            await refundDynamicCredit({
              userId: campaign.userId,
              creditAmount: creditAmount,
              serviceName: "whatsappCampaign",
              referenceId: campaign._id,
              referenceModel: "MetaWhatsappCampaign",
              description: `Refund for failed WhatsApp Campaign message to ${recipient.phoneNumber}`,
              metadata: {
                referenceId: campaign._id,
                referenceModel: "MetaWhatsappCampaign",
                title: `WhatsApp Campaign message refund`,
                extra: {
                  price: priceInfo?.price,
                  currency: priceInfo?.currency,
                  category: resolvedCategory,
                  recipient: recipient.phoneNumber,
                  reason: err.message
                }
              }
            });
          } catch (refundErr) {
            logger.error(`[Campaign] Credit refund failed for ${recipient.phoneNumber}: ${refundErr.message}`);
          }
        }

        const isEcosystemLimit =
          err.metaCode === 131049 ||
          err.metaCode === 131056 ||
          err.message?.includes("ecosystem engagement") ||
          err.message?.includes("per-user") ||
          err.message?.includes("frequency limit");

        if (isEcosystemLimit) {
          freshCampaign.recipients[i].status = "SCHEDULED_RETRY";
          freshCampaign.recipients[i].failedAt = new Date();
          freshCampaign.recipients[i].scheduledRetryAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
          freshCampaign.recipients[i].errorCode = err.metaCode?.toString() || "131049";
          freshCampaign.recipients[i].errorMessage =
            err.message || "In order to maintain a healthy ecosystem engagement, the message failed to be delivered.";

          logger.info(
            `[Campaign] ⏱ Auto-scheduled 24h retry for ${recipient.phoneNumber}: Ecosystem Limit (131049)`
          );
        } else {
          freshCampaign.recipients[i].status = "FAILED";
          freshCampaign.recipients[i].failedAt = new Date();
          freshCampaign.recipients[i].errorCode =
            err.metaCode?.toString() || "UNKNOWN";
          freshCampaign.recipients[i].errorMessage = err.message;
          freshCampaign.stats.failed = (freshCampaign.stats.failed || 0) + 1;

          logger.warn(
            `[Campaign] ❌ Failed for ${recipient.phoneNumber}: ${err.message}`
          );
        }
      }

      // Persist progress every 10 sends to avoid losing state on crash
      if (i % 10 === 0) {
        freshCampaign.markModified("recipients");
        freshCampaign.markModified("stats");
        await freshCampaign.save();
      }

      await sleep(SEND_DELAY_MS);
    }

    // ── Final save ────────────────────────────────────────────────────────
    freshCampaign.markModified("recipients");
    freshCampaign.markModified("stats");

    freshCampaign.status = "COMPLETED";
    freshCampaign.completedAt = new Date();
    await freshCampaign.save();

    logger.info(
      `[Campaign] ✅ Completed: ${campaign.name} — sent: ${freshCampaign.stats.sent}, failed: ${freshCampaign.stats.failed}`,
    );
  } catch (err) {
    // ── Mark as FAILED on fatal error ─────────────────────────────────────
    await Campaign.findByIdAndUpdate(campaignId, {
      status: "FAILED",
      failedAt: new Date(),
      failureReason: err.message,
    });
    console.log("err - ", err);

    logger.error(`[Campaign] ❌ Fatal error for ${campaignId}: ${err.message}`);
    throw err;
  }
};

// ─── PAUSE CAMPAIGN ───────────────────────────────────────────────────────────
/**
 * Sets status to PAUSED. The run loop checks this flag between sends
 * and will stop naturally after the current message completes.
 * Returns null if campaign is not in RUNNING state.
 */
export const pauseCampaign = async (campaignId, userId) => {
  const campaign = await Campaign.findOneAndUpdate(
    {
      _id: campaignId,
      userId,
      status: "RUNNING",
      isDeleted: false,
    },
    {
      status: "PAUSED",
      pausedAt: new Date(),
    },
    { new: true },
  );

  if (!campaign) {
    logger.warn(
      `[Campaign] Pause requested but campaign ${campaignId} is not running`,
    );
    return null;
  }

  logger.info(`[Campaign] Paused: ${campaign.name} (${campaign._id})`);
  return campaign;
};

// ─── RESUME CAMPAIGN ──────────────────────────────────────────────────────────
/**
 * Re-queues a PAUSED campaign by calling runCampaign again.
 * runCampaign skips non-PENDING recipients so no double-sends occur.
 */
export const resumeCampaign = async (campaignId) => {
  const campaign = await Campaign.findByIdAndUpdate(
    campaignId,
    {
      status: "RUNNING",
      resumedAt: new Date(),
    },
    { new: true },
  );

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  logger.info(`[Campaign] Resuming: ${campaign.name} (${campaign._id})`);

  // Fire and forget — same pattern as the initial launch
  runCampaign(campaignId).catch((err) =>
    logger.error(`[Campaign] Resume error for ${campaignId}: ${err.message}`),
  );
};
