import axios from "axios";
import mongoose from "mongoose";
import config from "../../../../config/config.js";
import logger from "../../../../config/logger.js";
import Template from "../../../../models/Campaign/WhatsappCampaign/Msg91/WhatsappTemplateSchema.js";
import WhatsAppToken from "../../../../models/Campaign/WhatsappCampaign/Msg91/Msg91WhatsappCampaignTokenSchema.js";
import CampaignLog from "../../../../models/Campaign/WhatsappCampaign/Msg91/whatsappCampaignLogSchema.js";
import { whatsappCampaignQueue } from "../../../../queue/index.js";
import { checkBulkFeatureCapacity } from "../../../../utils/creditTracker.js";
import Msg91WhatsappLogsSchema from "../../../../models/Campaign/WhatsappCampaign/Msg91/Msg91WhatsappLogs.schema.js";

const extractVariableIndices = (body) => {
  if (!body) return [];
  const matches = [...body.matchAll(/\{\{(\d+)\}\}/g)];
  return [...new Set(matches.map((m) => parseInt(m[1])))].sort((a, b) => a - b);
};

const isValidPhone = (phone) => {
  const cleaned = String(phone).replace(/\s+/g, "").replace(/^\+/, "");
  return /^[1-9]\d{9,14}$/.test(cleaned);
};

const getUserId = (req) => req.user?._id || req.user?.id || null;

const normalizePhone = (phone) => {
  // Strip whitespace, leading +, and any non-digit chars
  let num = String(phone).replace(/\s+/g, "").replace(/^\+/, "").replace(/\D/g, "");

  // Handle leading 0 (e.g. 09876543210 → 9876543210)
  if (num.startsWith("0")) {
    num = num.slice(1);
  }

  // Indian numbers:
  //  - 10 digits  → local, prepend 91
  //  - 12 digits starting with 91 → already has country code, keep as is
  //  - anything else (international) → keep as is
  if (num.length === 10) {
    num = "91" + num;
  }

  return num;
};

// ── Send Campaign ─────────────────────────────────────────────────────────────
export const sendCampaign = async (req, res) => {
  const { fromNumber, templateId, recipients } = req.body;

  const userId = getUserId(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "User Not Found"
    });
  }

  try {
    // ── 1. Input Validation ───────────────────────────────────────────────
    const errors = [];
    if (!fromNumber) errors.push("fromNumber is required");
    if (!templateId?.trim()) errors.push("templateId is required");
    if (!Array.isArray(recipients) || recipients.length === 0)
      errors.push("recipients must be a non-empty array");

    if (errors.length) {
      return res.status(400).json({ success: false, message: errors.join(", ") });
    }

    // ── 2. Fetch & Validate Template ──────────────────────────────────────
    const template = await Template.findOne({ _id: templateId, userId, isDeleted: false }).lean();

    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found" });
    }

    if (template.status !== "APPROVED") {
      return res.status(400).json({
        success: false,
        message: `Template is not approved. Current status: ${template.status}`,
      });
    }

    // ── 3. Validate Recipients ────────────────────────────────────────────
    const requiredVars = extractVariableIndices(template.body);
    const invalidPhones = [];
    const missingVars = [];

    recipients.forEach((r, idx) => {
      if (!isValidPhone(r.phone)) invalidPhones.push(`[${idx}] "${r.phone}"`);
      requiredVars.forEach((n) => {
        const key = `body_${n}`;
        if (!r.variables?.[key]?.toString().trim())
          missingVars.push(`[${idx}] missing ${key}`);
      });
    });

    const validationErrors = [];
    if (invalidPhones.length)
      validationErrors.push(`Invalid phones: ${invalidPhones.slice(0, 5).join(", ")}`);
    if (missingVars.length)
      validationErrors.push(`Missing variables: ${missingVars.slice(0, 5).join(", ")}`);

    if (validationErrors.length) {
      return res.status(400).json({ success: false, message: validationErrors.join(" | ") });
    }

    const normalizedRecipients = recipients.map((r) => ({
      phone: normalizePhone(r.phone),
      variables: r.variables,

    }));

    // ── 4. Check Capacity (whatsappMessage) ───────────────────────────────
    const capacity = await checkBulkFeatureCapacity({
      userId: req.user?._id || req.user?.id,
      featureKey: "whatsappMessage",
      requiredCount: normalizedRecipients.length,
    });

    if (!capacity.canAfford) {
      return res.status(403).json({
        success: false,
        message:
          capacity.message ||
          `whatsapp message not send due to you have free plan limits`,
      });
    }

    // ── 5. Create Campaign Log (QUEUED) ───────────────────────────────────
    const campaignLog = await CampaignLog.create({
      templateId: template._id,
      templateName: template.name,
      fromNumber: normalizePhone(fromNumber),
      totalCount: normalizedRecipients.length,
      recipients: normalizedRecipients.map((r) => ({
        phone: r.phone,
        variables: r.variables,
        status: "QUEUED",
        initiatedBy: userId
      })),
      status: "QUEUED",
      initiatedBy: userId,
    });

    // ── 5. Enqueue single job for entire campaign ─────────────────────────
    await whatsappCampaignQueue.add(
      "send-whatsapp",
      {
        campaignId: campaignLog._id.toString(),
        template,
        fromNumber: normalizePhone(fromNumber),
        recipients: normalizedRecipients,
      },
      {
        jobId: `campaign-${campaignLog._id}`,
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      }
    );

    logger.info(`[Controller] Campaign ${campaignLog._id} — 1 bulk job queued for ${normalizedRecipients.length} recipients`);

    // ── 6. Respond immediately ────────────────────────────────────────────
    return res.status(202).json({
      success: true,
      message: `Campaign queued. Sending to ${normalizedRecipients.length} recipients in background.`,
      campaignId: campaignLog._id,
      status: "QUEUED",
    });

  } catch (error) {
    logger.error("[Campaign Controller] Unhandled error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// ── Get Campaign Status ───────────────────────────────────────────────────────
export const getCampaignStatus = async (req, res) => {
  try {

    const userId = getUserId(req);

    const campaign = await CampaignLog.findOne({ _id: req.params.campaignId, initiatedBy: userId })
      .populate("templateId")
      .lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    // ── Fetch MSG91 Logs and Merge ────────────────────────────────────────────
    if (campaign.msg91RequestId) {
      const msg91Logs = await Msg91WhatsappLogsSchema.find({
        userId,
        requestId: campaign.msg91RequestId,
      }).lean();

      // Create a map by normalized phone number
      const logsMap = {};
      msg91Logs.forEach((log) => {
        const normalizedPhone = String(log.customerNumber).replace(/\D/g, "");
        logsMap[normalizedPhone] = log;
      });

      let deliveredCount = 0;
      let readCount = 0;
      let actualFailedCount = campaign.failedCount || 0;

      campaign.recipients = campaign.recipients.map((r) => {
        const normalizedPhone = String(r.phone).replace(/\D/g, "");
        const providerLog = logsMap[normalizedPhone];

        if (providerLog) {
          const pStatus = providerLog.status ? providerLog.status.toUpperCase() : "SENT";

          if (pStatus === "DELIVERED") deliveredCount++;
          if (pStatus === "READ") {
            readCount++;
            deliveredCount++; // Read implies delivered
          }
          if (pStatus === "FAILED" || pStatus === "REJECTED") {
             // Only increment if we hadn't already failed it locally
             if (r.status !== "FAILED") actualFailedCount++;
          }

          return {
            ...r,
            status: pStatus, // Override our local 'SENT' with real MSG91 status
            msg91Log: providerLog,
          };
        }
        return r;
      });

      // Override counts with real live data
      campaign.deliveredCount = deliveredCount;
      campaign.readCount = readCount;
      campaign.failedCount = actualFailedCount;
    }

    // Compute final live KPIs
    const totalCount = campaign.totalCount || campaign.recipients?.length || 0;
    const sentCount = campaign.sentCount || 0;
    const deliveredCount = campaign.deliveredCount || 0;
    const readCount = campaign.readCount || 0;
    const failedCount = campaign.failedCount || 0;

    return res.status(200).json({
      success: true,
      campaign: {
        ...campaign,
        totalCount,
        sentCount,
        deliveredCount,
        readCount,
        failedCount,
        successRate: totalCount ? Math.round((sentCount / totalCount) * 100) : 0,
        deliveryRate: totalCount ? Math.round((deliveredCount / totalCount) * 100) : 0,
        readRate: totalCount ? Math.round((readCount / totalCount) * 100) : 0,
      },
    });
  } catch (error) {
    logger.error("[getCampaignStatus] Error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ── Get All Campaigns ─────────────────────────────────────────────────────────
export const getAllCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query; // ← default limit added

    const userId = getUserId(req);

    const skip = (Number(page) - 1) * Number(limit);

    const [campaigns, total] = await Promise.all([
      CampaignLog.find({ initiatedBy: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),

      CampaignLog.countDocuments({ initiatedBy: userId }),
    ]);

    const formatted = campaigns.map((c) => ({
      ...c,
      successRate: c.totalCount
        ? Math.round((c.sentCount / c.totalCount) * 100)
        : 0,
    }));

    return res.status(200).json({
      success: true,
      pagination: {
        totalRecords: total,
        currentPage: Number(page),
        totalPages: Math.ceil(total / Number(limit)),
        pageSize: Number(limit),
      },
      campaigns: formatted,
    });

  } catch (error) {
    logger.error("[getAllCampaigns] Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};


// ── Get MSG91 WhatsApp Report Logs ────────────────────────────────────────────

export const getMsg91WhatsappLogs = async (req, res) => {
  try {
    const { startDate, endDate, limit, fields, requestId, integratedNumber } = req.query;
    const userId = getUserId(req);

    if (!config.MSG91_AUTHKEY) {
      logger.error("[getMsg91WhatsappLogs] MSG91_AUTHKEY not configured");
      return res.status(500).json({
        success: false,
        message: "MSG91 auth key is not configured on the server",
      });
    }

    // Build URL
    const params = new URLSearchParams({ startDate, endDate });

    if (limit) params.append("limit", limit);
    if (fields) params.append("fields", fields);
    if (requestId) params.append("requestId", requestId);

    const msg91Url = `https://control.msg91.com/api/v5/report/logs/wa?${params.toString()}`;

    logger.info(
      `[getMsg91WhatsappLogs] Fetching MSG91 logs | userId: ${userId} | startDate: ${startDate} | endDate: ${endDate}`
    );

    // Call MSG91 API
    const msg91Response = await fetch(msg91Url, {
      method: "GET",
      headers: {
        accept: "application/json",
        authkey: config.MSG91_AUTHKEY,
      },
    });

    const data = await msg91Response.json();

    if (!msg91Response.ok) {
      logger.error("[getMsg91WhatsappLogs] MSG91 API error:", data);
      return res.status(msg91Response.status).json({
        success: false,
        message: "Failed to fetch logs from MSG91",
        error: data,
      });
    }

    const logs = Array.isArray(data?.data) ? data.data : [];

    if (logs.length > 0) {
      const operations = logs.map((log) => {
        // Safe date parsing
        let requestedAt = null;
        let sentTime = null;
        let deliveryTime = null;

        if (log.requestedAt) {
          const d = new Date(log.requestedAt);
          if (!isNaN(d)) requestedAt = d;
        }

        if (log.sentTime?.value) {
          const d = new Date(log.sentTime.value);
          if (!isNaN(d)) sentTime = d;
        }

        if (log.deliveryTime?.value) {
          const d = new Date(log.deliveryTime.value);
          if (!isNaN(d)) deliveryTime = d;
        }

        return {
          updateOne: {
            filter: {
              userId,
              requestId: log.requestId,
              customerNumber: log.customerNumber,
            },
            update: {
              $set: {
                uuid: log.uuid,
                CRQID: log.CRQID,
                integratedNumber: log.integratedNumber,
                messageType: log.messageType,
                direction: log.direction,
                content: log.content,
                templateName: log.templateName,
                campaignName: log.campaignName,
                origin: log.origin,
                status: log.status,
                failureReason: log.failureReason,
                requestedAt,
                sentTime,
                deliveryTime,
                totalClicked: log.totalClicked ?? 0,
                price: log.price ?? 0,
                providerData: log,
                providerResponse: data,
              },
            },
            upsert: true,
          },
        };
      });

      const result = await Msg91WhatsappLogsSchema.bulkWrite(operations);

      logger.info(
        `[getMsg91WhatsappLogs] Logs synced | inserted: ${result.upsertedCount} | updated: ${result.modifiedCount}`
      );
    } else {
      logger.info("[getMsg91WhatsappLogs] No logs returned from MSG91");
    }

    let resultLogs = logs;
    if (integratedNumber) {
      resultLogs = logs.filter(log => log.integratedNumber === integratedNumber);
    }

    return res.status(200).json({
      success: true,
      data: resultLogs,
    });
  } catch (error) {
    logger.error("[getMsg91WhatsappLogs] Unhandled error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// ── Get MSG91 WhatsApp Report Logs ────────────────────────────────────────────
export const addWhatsappClient = async (req, res) => {
  const {
    user_full_name,
    user_mobile_number,
    user_company_name,
    user_industry,
    services,
    user_name,
    user_email,
  } = req.body;

  try {
    const params = new URLSearchParams({
      authkey: config.MSG91_AUTHKEY,
      user_full_name,
      user_mobile_number,
      user_company_name,
      user_industry,
      services: services || 'SMS',
      user_name,
      user_email,
    });

    const response = await axios.get(
      `http://control.msg91.com/api/add_client.php?${params.toString()}`
    );

    console.log(`http://control.msg91.com/api/add_client.php?${params.toString()}`)

    res.status(200).json({ success: true, data: response.data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Embedded Signup — Connect WhatsApp instantly ──────────────────────────────
//
// WHY we accept wabaId from the client:
//   The code-exchanged user token only carries whatsapp_business_management
//   scope — NOT business_management. Calling /me/businesses with it returns
//   (#100) Missing Permission. Meta's Embedded Signup sends the waba_id
//   directly in the WA_EMBEDDED_SIGNUP postMessage FINISH event, so we pass
//   it through from the client and hit /{wabaId}/phone_numbers directly,
//   which the user token IS permitted to call.
// ──────────────────────────────────────────────────────────────────────────────

export const connectEmbeddedWhatsapp = async (req, res) => {
  const { code, wabaId } = req.body;
  const userId = getUserId(req);

  if (!userId) return res.status(401).json({ success: false, message: "User Not Found" });
  if (!code) return res.status(400).json({ success: false, message: "code is required" });
  if (!wabaId) return res.status(400).json({ success: false, message: "wabaId is required" });

  const FB_GRAPH = "https://graph.facebook.com/v19.0";

  try {
    // ─── Step 1: Exchange code → short-lived user access token ───────────────
    const { data: tokenData } = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id: config.META_APP_ID,
        client_secret: config.META_APP_SECRET,
        code,
      },
    });
    const shortLivedToken = tokenData.access_token;

    // ─── Step 2: Exchange short-lived → long-lived user token ────────────────
    //    Store this per-user so you can act on their WABA later if needed.
    const { data: longLivedData } = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: config.META_APP_ID,
        client_secret: config.META_APP_SECRET,
        fb_exchange_token: shortLivedToken,
      },
    });
    const longLivedToken = longLivedData.access_token;

    // Optionally persist longLivedToken tied to userId + wabaId in your DB here.
    logger.info(`[connectEmbeddedWhatsapp] Long-lived token obtained for user ${userId}`);

    // ─── Step 3: Subscribe WABA to your app ──────────────────────────────────
    //    Use System User Token — it has the app-level permission to subscribe.
    //    Do NOT silently ignore failures here; a failed subscription means
    //    your system user won't receive webhooks for this WABA.
    try {
      await axios.post(
        `${FB_GRAPH}/${wabaId}/subscribed_apps`,
        {},
        { params: { access_token: config.META_WHATSAPP_SYSTEM_USER_TOKEN } }
      );
      logger.info(`[connectEmbeddedWhatsapp] WABA ${wabaId} subscribed to app`);
    } catch (subErr) {
      // Log but don't abort — subscription may already exist
      logger.warn(
        "[connectEmbeddedWhatsapp] Subscribe warning (may already be subscribed):",
        subErr.response?.data
      );
    }

    // ─── Step 4: Fetch phone numbers ─────────────────────────────────────────
    //    ✅ FIX: Use System User Token, NOT the short-lived user token.
    //    The user token from code-exchange lacks whatsapp_business_management scope.
    const { data: phoneData } = await axios.get(`${FB_GRAPH}/${wabaId}/phone_numbers`, {
      params: {
        access_token: config.META_WHATSAPP_SYSTEM_USER_TOKEN, // <-- KEY FIX
        fields: "id,display_phone_number,verified_name,code_verification_status",
      },
    });

    if (!phoneData.data?.length) {
      return res.status(200).json({
        success: true,
        message: "WABA connected but no phone numbers found",
        connected_numbers: [],
      });
    }

    // ─── Step 5: Register each number with MSG91 ─────────────────────────────
    const registered = [];

    for (const phone of phoneData.data) {
      try {
        // MSG91 expects waba_id + phone_number_id in the body
        const msg91Response = await axios.post(
          "https://api.msg91.com/api/v5/whatsapp/add-number",
          {
            waba_id: wabaId,
            phone_number_id: phone.id,
          },
          {
            headers: {
              authkey: config.MSG91_AUTHKEY,
              "Content-Type": "application/json",
            },
          }
        );

        // Also save to WhatsAppToken to make it available for Conversational Automation and Interactive Builder
        await WhatsAppToken.findOneAndUpdate(
          { phoneNumberId: phone.id },
          {
            $set: {
              userId: new mongoose.Types.ObjectId(userId),
              phoneNumberId: phone.id,
              wabaId: wabaId,
              displayName: phone.verified_name || phone.display_phone_number,
              phoneNumber: phone.display_phone_number,
              accessToken: longLivedToken,
              status: "active",
              qualityRating: "UNKNOWN",
              messagingLimit: "TIER_1K",
            }
          },
          { upsert: true, new: true }
        );

        registered.push({
          waba_id: wabaId,
          phone_number_id: phone.id,
          display_phone_number: phone.display_phone_number,
          verified_name: phone.verified_name,
          status: "connected",
          msg91: msg91Response.data,
        });

        logger.info(
          `[connectEmbeddedWhatsapp] Registered & Token Saved for ${phone.display_phone_number} (${phone.id}) for user ${userId}`
        );
      } catch (msg91Err) {
        const errDetail = msg91Err.response?.data;
        logger.error(
          `[connectEmbeddedWhatsapp] MSG91 failed for ${phone.display_phone_number}:`,
          errDetail
        );
        registered.push({
          waba_id: wabaId,
          phone_number_id: phone.id,
          display_phone_number: phone.display_phone_number,
          verified_name: phone.verified_name,
          status: "failed",
          error: errDetail,
        });
      }
    }

    return res.status(200).json({ success: true, connected_numbers: registered });

  } catch (error) {
    const errData = error.response?.data || error.message;
    logger.error("[connectEmbeddedWhatsapp] Error:", errData);
    return res.status(500).json({
      success: false,
      message: "Connection failed",
      error: errData,
    });
  }
};

// ── Explicit Background Sync API ──────────────────────────────────────────────
export const syncMsg91CampaignLogs = async (req, res) => {
  try {
    const userId = getUserId(req);
    const campaign = await CampaignLog.findOne({ _id: req.params.campaignId, initiatedBy: userId }).lean();

    if (!campaign) {
      return res.status(404).json({ success: false, message: "Campaign not found" });
    }

    if (!campaign.msg91RequestId) {
      return res.status(400).json({ success: false, message: "Campaign has no MSG91 Request ID to sync" });
    }

    if (!config.MSG91_AUTHKEY) {
      return res.status(500).json({ success: false, message: "MSG91 auth key missing" });
    }

    const today = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const startDate = campaign.createdAt
      ? new Date(new Date(campaign.createdAt).getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const params = new URLSearchParams({ 
      startDate, 
      endDate: today, 
      limit: 5000, 
      requestId: campaign.msg91RequestId 
    });

    const msg91Url = `https://control.msg91.com/api/v5/report/logs/wa?${params.toString()}`;

    logger.info(`[syncMsg91CampaignLogs] Syncing MSG91 logs | campaignId: ${campaign._id} | reqId: ${campaign.msg91RequestId}`);

    const msg91Response = await fetch(msg91Url, {
      method: "GET",
      headers: { accept: "application/json", authkey: config.MSG91_AUTHKEY },
    });
    const data = await msg91Response.json();

    if (!msg91Response.ok) {
      return res.status(msg91Response.status).json({ success: false, message: "Failed to fetch logs", error: data });
    }

    const logs = Array.isArray(data?.data) ? data.data : [];

    if (logs.length > 0) {
      const operations = logs.map((log) => {
        let requestedAt = null, sentTime = null, deliveryTime = null;
        if (log.requestedAt) { const d = new Date(log.requestedAt); if (!isNaN(d)) requestedAt = d; }
        if (log.sentTime?.value) { const d = new Date(log.sentTime.value); if (!isNaN(d)) sentTime = d; }
        if (log.deliveryTime?.value) { const d = new Date(log.deliveryTime.value); if (!isNaN(d)) deliveryTime = d; }

        return {
          updateOne: {
            filter: { userId, requestId: log.requestId, customerNumber: log.customerNumber },
            update: {
              $set: {
                uuid: log.uuid,
                CRQID: log.CRQID,
                integratedNumber: log.integratedNumber,
                messageType: log.messageType,
                direction: log.direction,
                content: log.content,
                templateName: log.templateName,
                campaignName: log.campaignName,
                origin: log.origin,
                status: log.status,
                failureReason: log.failureReason,
                requestedAt,
                sentTime,
                deliveryTime,
                totalClicked: log.totalClicked ?? 0,
                price: log.price ?? 0,
                providerData: log,
                providerResponse: data,
              },
            },
            upsert: true,
          },
        };
      });

      const result = await Msg91WhatsappLogsSchema.bulkWrite(operations);
      logger.info(`[syncMsg91CampaignLogs] Synced | inserted: ${result.upsertedCount} | updated: ${result.modifiedCount}`);
    }

    return res.status(200).json({ success: true, message: "Campaign logs synced successfully", logsCount: logs.length });
  } catch (error) {
    logger.error("[syncMsg91CampaignLogs] Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
