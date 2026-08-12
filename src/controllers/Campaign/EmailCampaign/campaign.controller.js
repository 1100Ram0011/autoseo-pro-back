import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../../../utils/s3Client.js";
import config from "../../../config/config.js";
import { parseExcel } from "../../../utils/parseExcel.js";
import campaignSchema from "../../../models/Campaign/EmailCampaign/campaignSchema.js";
import templateSchema from "../../../models/Campaign/EmailCampaign/templateSchema.js";
import BusinessDetail from "../../../models/BusinessSummaryProfile.js";
import logger from "../../../config/logger.js";
import {
  bulkEmailQueue,
  individualAnalysisQueue,
} from "../../../queue/index.js";
import { checkBulkFeatureCapacity } from "../../../utils/creditTracker.js";
import mongoose from "mongoose";
import { uploadToS3 } from "../../../utils/emailTemplateCampaignUpload.js";
import emailTokenSchema from "../../../models/Campaign/EmailCampaign/emailTokenSchema.js";
import IndividualAnalysisProfile from "../../../models/IndividualAnalysisProfile.js";
import CampaignRecipientLog from "../../../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import { agenda } from "../../../jobs/agenda/agenda.js";
import {
  scheduleEmailLimitReset,
  REFILL_WINDOW_MS,
} from "../../../jobs/resetEmailDailyLimits.job.js";
import { emitCampaignUpdated } from "../../../utils/campaignSocketHelper.js";

// export const createCampaign = async (req, res) => {
//   try {
//     const { name, templateId, provider } = req.body;
//     const userId = req.user.id;

//     const file = req.file;

//     if (!name || !templateId)
//       return res.status(400).json({
//         message: "Campaign name and templateId are required",
//       });

//     const existingCampaign = await campaignSchema.findOne({
//       userId,
//       name,
//     });

//     if (existingCampaign) {
//       return res.status(409).json({
//         message: `Campaign name "${name}" already exists. Please choose another name.`,
//       });
//     }

//     if (!file)
//       return res.status(400).json({
//         message: "Excel file is required",
//       });

//     let senderEmail;

//     if (provider) {
//       senderEmail = await emailTokenSchema.findOne({ userId, provider }).select("email");
//     }

//     const template = await templateSchema.findById(templateId);

//     if (!template)
//       return res.status(404).json({
//         message: "Template not found",
//       });

//     const BusinessDetails = await BusinessDetail.findOne({
//       userId: req.user.id,
//       status: "COMPLETED",
//     });

//     const IndividualDetails = await IndividualAnalysisProfile.findOne({
//       userId: req.user.id,
//       analysisStatus: "completed",
//     });

//     const hasBusiness = Boolean(BusinessDetails?.analysisSummary);
//     const hasIndividual = Boolean(IndividualDetails?.description);

//     if (!hasBusiness && !hasIndividual)
//       return res.status(404).json({
//         message: "Business details or Individual details not found",
//       });

//     const { analysis } = hasBusiness ? BusinessDetails : {};

//     const { contact_info, business_overview } = analysis;

//     const companyName = business_overview?.brand_name?.trim();
//     const companyAddress = contact_info?.address?.trim();
//     const companyWebsite = contact_info?.website?.trim();

//     if (!hasIndividual) {
//       if (!companyName || (!companyAddress && !companyWebsite)) {
//         return res.status(400).json({
//           message:
//             "companyName and either companyAddress or companyWebsite are required for compliance",
//         });
//       }
//     }

//     // Upload Excel to S3
//     const fileKey = `${Date.now()}-${file.originalname}`;

//     const { url: fileUrl } = await uploadToS3(
//       file.buffer,
//       fileKey,
//       config.AWS_S3_EMAIL_CAMPAIGN_FOLDER,
//       file.mimetype,
//       "inline",
//     );

//     // Parse Excel
//     const recipients = await parseExcel(file.buffer);

//     console.log("Parsed Recipients:", recipients);

//     if (!Array.isArray(recipients) || !recipients.length)
//       return res.status(400).json({
//         message: "No recipients found in Excel",
//       });

//     const validRecipients = recipients.filter(
//       (r) => r.email && typeof r.email === "string",
//     );

//     if (!validRecipients.length)
//       return res.status(400).json({
//         message: "No valid email addresses found",
//       });

//     // ===========================
//     // 💳 PRE-CHECK: Can user afford this many emails?
//     // ===========================
//     const capacity = await checkBulkFeatureCapacity({
//       userId,
//       featureKey: "email",
//       requiredCount: validRecipients.length,
//     });

//     if (!capacity.canAfford) {
//       return res.status(403).json({
//         message:
//           capacity.message ||
//           `Insufficient email credits. You can send ${capacity.available} emails but this campaign needs ${capacity.required}. Please upgrade your plan or reduce recipients.`,
//         insufficientCredits: true,
//         available: capacity.available,
//         required: capacity.required,
//         freeRemaining: capacity.freeRemaining,
//         walletCapacity: capacity.walletCapacity,
//       });
//     }

//     //  Create campaign
//     const campaign = await campaignSchema.create({
//       name,
//       userId: userId,
//       templateId,
//       provider,
//       companyName: companyName || "",
//       campaignMail: senderEmail,
//       companyAddress: companyAddress || "",
//       totalRecipients: validRecipients.length,
//       sentCount: 0,
//       failedCount: 0,
//       status: "processing",
//       excelFileUrl: fileUrl,
//       excelFileKey: fileKey,
//     });

//     // Add jobs to queue
//     const jobs = validRecipients.map((recipient) => ({
//       name: "send-email",
//       data: {
//         campaignId: campaign._id,
//         templateId,
//         recipientData: recipient,
//         CampaignSenderEmail: senderEmail ? String(senderEmail?.email) : null,
//       },
//       opts: {
//         attempts: 3,
//         backoff: { type: "exponential", delay: 5000 },
//       },
//     }));

//     await bulkEmailQueue.addBulk(jobs);

//     campaign.status = "queued";
//     await campaign.save();

//     return res.status(200).json({
//       message: "Campaign queued successfully",
//       campaignId: campaign._id,
//       totalRecipients: validRecipients.length,
//       excelFileUrl: fileUrl,
//     });
//   } catch (error) {
//     // =========================
//     // 🔥 HANDLE UNIQUE CONSTRAINT ERROR
//     // =========================

//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern || {})[0] || "field";
//       const value = error.keyValue?.[field];

//       return res.status(409).json({
//         message: `${field.charAt(0).toUpperCase() + field.slice(1)} "${value}" already exists.`,
//       });
//     }

//     // =========================
//     // VALIDATION ERROR (Mongoose)
//     // =========================

//     if (error.name === "ValidationError") {
//       const firstError = Object.values(error.errors)[0]?.message;
//       return res.status(400).json({
//         message: firstError || "Validation failed.",
//       });
//     }

//     console.log(error);

//     logger.error(`Campaign creation failed: ${error.message}`);
//     return res.status(500).json({
//       message: "Failed to create campaign",
//       error: error.message,
//     });
//   }
// };

export const createCampaign = async (req, res) => {
  try {
    const { name, templateId, provider } = req.body;
    const userId = req.user?.id;
    const file = req.file;

    // ===============================
    // BASIC & PROVIDER VALIDATION
    // ===============================
    if (!userId) {
      return res.status(401).json({
        message: "Unauthorized request. User identity is missing.",
      });
    }

    if (!name || !name.trim() || !templateId) {
      return res.status(400).json({
        message: "Campaign name and templateId are required.",
      });
    }

    const allowedProviders = [
      "google",
      "microsoft",
      "custom",
      "system",
      "multi",
    ];
    if (provider && !allowedProviders.includes(provider)) {
      return res.status(400).json({
        message: `Invalid provider "${provider}". Allowed providers are: ${allowedProviders.join(", ")}`,
      });
    }

    if (!file) {
      return res.status(400).json({
        message: "Excel file (.xlsx or .xls) is required.",
      });
    }

    // ===============================
    // FILE TYPE VALIDATION
    // ===============================
    const allowedTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];

    const fileNameLower = file.originalname?.toLowerCase() || "";
    const hasValidExt =
      fileNameLower.endsWith(".xlsx") || fileNameLower.endsWith(".xls");

    if (!allowedTypes.includes(file.mimetype) && !hasValidExt) {
      return res.status(400).json({
        message: "Only Excel files (.xlsx, .xls) are allowed.",
      });
    }

    // ===============================
    // DUPLICATE CAMPAIGN NAME CHECK
    // ===============================
    const existingCampaign = await campaignSchema.findOne({
      userId,
      name: name.trim(),
    });

    if (existingCampaign) {
      return res.status(409).json({
        message: `Campaign name "${name.trim()}" already exists. Please choose another name.`,
      });
    }

    // ===============================
    // TEMPLATE CHECK
    // ===============================
    if (!mongoose.Types.ObjectId.isValid(templateId)) {
      return res.status(400).json({
        message: "Invalid templateId format.",
      });
    }

    const template = await templateSchema.findById(templateId);

    if (!template) {
      return res.status(404).json({
        message: "Template not found.",
      });
    }

    // ===============================
    // EMAIL PROVIDER TOKEN CHECK
    // ===============================
    let senderEmail = null;

    if (provider === "multi") {
      const activeCount = await emailTokenSchema.countDocuments({
        userId,
        isActive: true,
        status: "active",
      });

      if (activeCount === 0) {
        return res.status(403).json({
          message:
            "You need to connect at least one active email account before you can start a campaign.",
          code: "NO_ACTIVE_ACCOUNTS",
        });
      }
      senderEmail = "multi-provider";
    } else if (provider === "system") {
      senderEmail = "system";
    } else if (provider) {
      const emailToken = await emailTokenSchema
        .findOne({ userId, provider, isActive: true, status: "active" })
        .select("email status isActive");

      if (!emailToken) {
        return res.status(403).json({
          message: `Your ${provider} account needs to be reconnected before you can start a campaign.`,
          code: "RECONNECT_REQUIRED",
          provider,
        });
      }

      senderEmail = emailToken.email;
    }

    // ===============================
    // USER ANALYSIS & COMPLIANCE CHECK
    // ===============================
    const BusinessDetails = await BusinessDetail.findOne({
      userId,
      status: "COMPLETED",
    });

    const IndividualDetails = await IndividualAnalysisProfile.findOne({
      userId,
      analysisStatus: "completed",
      isActive: true,
    }).sort({ createdAt: -1 });

    const hasBusiness = Boolean(
      BusinessDetails?.analysisSummary || BusinessDetails?.analysis,
    );
    const hasIndividual = Boolean(IndividualDetails?.description);

    if (!hasBusiness && !hasIndividual) {
      return res.status(404).json({
        message:
          "Business details or Individual details not found. Please complete your profile analysis first.",
      });
    }

    // Extraction
    let companyName = "";
    let companyAddress = "";
    let companyWebsite = "";

    if (hasBusiness) {
      const analysis = BusinessDetails?.analysis || {};
      const contact = analysis?.contact_info || {};
      const overview = analysis?.business_overview || {};

      companyName =
        overview?.brand_name?.trim() || overview?.legal_name?.trim() || "";
      companyAddress = contact?.address?.trim() || "";
      companyWebsite = contact?.website?.trim() || "";
    }

    if (!hasIndividual) {
      if (!companyName || (!companyAddress && !companyWebsite)) {
        return res.status(400).json({
          message:
            "Company name and either company address or company website are required for compliance.",
        });
      }
    }

    // ===============================
    // UPLOAD EXCEL TO S3
    // ===============================
    const fileKey = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

    const { url: fileUrl } = await uploadToS3(
      file.buffer,
      fileKey,
      config.AWS_S3_EMAIL_CAMPAIGN_FOLDER,
      file.mimetype,
      "inline",
    );

    // ===============================
    // PARSE EXCEL
    // ===============================
    const recipients = await parseExcel(file.buffer);

    if (!Array.isArray(recipients) || !recipients.length) {
      return res.status(400).json({
        message: "No recipients found in uploaded Excel file.",
      });
    }

    // ===============================
    // VALIDATE & DEDUPLICATE EMAILS
    // ===============================
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seenEmails = new Set();
    const validRecipients = [];
    const skippedRecipients = [];

    for (const r of recipients) {
      const rawEmail =
        r.email || r.Email || r["Email Address"] || r["email address"];
      if (rawEmail && typeof rawEmail === "string") {
        const normalizedEmail = rawEmail.toLowerCase().trim();
        if (emailRegex.test(normalizedEmail)) {
          if (!seenEmails.has(normalizedEmail)) {
            seenEmails.add(normalizedEmail);
            r.email = normalizedEmail;
            validRecipients.push(r);
          } else {
            r.email = normalizedEmail;
            skippedRecipients.push(r);
          }
        } else {
          r.email = normalizedEmail;
          skippedRecipients.push(r);
        }
      }
    }

    if (!validRecipients.length) {
      return res.status(400).json({
        message: "No valid email addresses found in the uploaded file.",
      });
    }

    // ===============================
    // CREDIT CAPACITY CHECK
    // ===============================
    const capacity = await checkBulkFeatureCapacity({
      userId,
      featureKey: "email",
      requiredCount: validRecipients.length,
    });

    if (!capacity.canAfford) {
      return res.status(403).json({
        message:
          capacity.message ||
          `Insufficient email credits. You can send ${capacity.available} emails but this campaign needs ${capacity.required}.`,
        insufficientCredits: true,
        available: capacity.available,
        required: capacity.required,
        freeRemaining: capacity.freeRemaining,
        walletCapacity: capacity.walletCapacity,
      });
    }

    // ===============================
    // CREATE CAMPAIGN
    // ===============================
    const campaign = await campaignSchema.create({
      name: name.trim(),
      userId,
      templateId,
      provider: provider || "multi",
      companyName,
      companyAddress,
      campaignMail: senderEmail,
      totalRecipients: validRecipients.length + skippedRecipients.length,
      sentCount: 0,
      failedCount: 0,
      skipCount: skippedRecipients.length,
      status: "processing",
      excelFileUrl: fileUrl,
      excelFileKey: fileKey,
    });

    // ===============================
    // CREATE QUEUE RECIPIENT LOGS
    // ===============================
    const logEntries = validRecipients.map((recipient) => ({
      campaignId: campaign._id,
      senderUserId: userId,
      recipientEmail: recipient.email,
      recipientName:
        recipient.name ||
        recipient.Name ||
        recipient["First Name"] ||
        recipient["first name"] ||
        recipient.firstName ||
        recipient.FirstName ||
        recipient["Full Name"] ||
        recipient["full name"] ||
        recipient.fullName ||
        recipient.FullName ||
        "",
      companyName:
        recipient.company ||
        recipient["Company"] ||
        recipient.companyName ||
        "",
      status: "queued",
      dataFile: recipient,
    }));

    const skippedLogEntries = skippedRecipients.map((recipient) => ({
      campaignId: campaign._id,
      senderUserId: userId,
      recipientEmail: recipient.email || "invalid@missing.com",
      recipientName:
        recipient.name ||
        recipient.Name ||
        recipient["First Name"] ||
        recipient["first name"] ||
        recipient.firstName ||
        recipient.FirstName ||
        recipient["Full Name"] ||
        recipient["full name"] ||
        recipient.fullName ||
        recipient.FullName ||
        "",
      companyName:
        recipient.company ||
        recipient["Company"] ||
        recipient.companyName ||
        "",
      status: "skipped",
      errorReason: emailRegex.test(recipient.email || "")
        ? "Duplicate email address in uploaded file"
        : "Invalid email format in uploaded file",
      dataFile: recipient,
    }));

    await CampaignRecipientLog.insertMany([
      ...logEntries,
      ...skippedLogEntries,
    ]);

    // ===============================
    // DAILY LIMIT CAPACITY CHECK (BEFORE DISPATCH)
    // ===============================
    let totalRemainingCapacity = 0;
    let earliestRefillTime = null;

    if (provider === "system") {
      totalRemainingCapacity = 500;
    } else {
      const tokenQuery = { userId, isActive: true, status: "active" };
      if (provider !== "multi" && provider) {
        tokenQuery.provider = provider;
        if (
          senderEmail &&
          senderEmail !== "multi-provider" &&
          senderEmail !== "system"
        ) {
          tokenQuery.email = senderEmail.toLowerCase();
        }
      }
      const tokens = await emailTokenSchema.find(tokenQuery);
      for (const token of tokens) {
        const remaining = Math.max(0, token.dailyLimit ?? 0);
        totalRemainingCapacity += remaining;

        // Schedule limit reset for any depleted tokens
        if (remaining === 0) {
          await scheduleEmailLimitReset(token);

          let depletedAt = token.metadata?.limitDepletedAt
            ? new Date(token.metadata.limitDepletedAt)
            : token.metadata?.quotaExceededAt
              ? new Date(token.metadata.quotaExceededAt)
              : new Date();
          let refill = new Date(depletedAt.getTime() + REFILL_WINDOW_MS);
          if (!earliestRefillTime || refill < earliestRefillTime)
            earliestRefillTime = refill;
        }
      }
    }

    let successMessage = "Campaign queued successfully";
    let limitExceeded = false;

    if (totalRemainingCapacity === 0) {
      // All accounts depleted — start campaign as paused
      limitExceeded = true;
      const nextRefillTime =
        earliestRefillTime && earliestRefillTime > new Date()
          ? earliestRefillTime
          : new Date(Date.now() + REFILL_WINDOW_MS);

      campaign.status = "paused";
      campaign.holdReason = `Daily sending limit reached across all connected email accounts (0 available capacity). Remaining emails are scheduled to send when limits refill.`;
      campaign.resumeAt = nextRefillTime;
      await campaign.save();

      successMessage =
        "All email account limits reached 0. Remaining emails will be sent after limits refill.";

      await CampaignRecipientLog.updateMany(
        { campaignId: campaign._id, status: "queued" },
        {
          $set: {
            status: "scheduled",
            errorReason: `Scheduled to send on ${nextRefillTime.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST when limits refill.`,
          },
        },
      );

      logger.info(
        `[Campaign] Campaign ${campaign._id} created as PAUSED — zero daily capacity. Resume at ${nextRefillTime.toISOString()}.`,
      );
    } else {
      // Capacity available — queue campaign and trigger dispatcher
      campaign.status = "queued";
      await campaign.save();

      try {
        await agenda.now("email-campaign-dispatcher");
        logger.info(
          `[Campaign] Triggered email-campaign-dispatcher immediately for campaign ${campaign._id}`,
        );
      } catch (agendaErr) {
        logger.error(
          `[Campaign] Failed to trigger dispatcher: ${agendaErr.message}`,
        );
      }
    }

    // ===============================
    // EMIT REAL-TIME UPDATE
    // ===============================
    emitCampaignUpdated(userId, campaign._id);

    // ===============================
    // SUCCESS RESPONSE
    // ===============================
    return res.status(200).json({
      success: true,
      limitExceeded,
      message: successMessage,
      campaignId: campaign._id,
      totalRecipients: validRecipients.length,
      skippedCount: skippedRecipients.length,
      excelFileUrl: fileUrl,
    });
  } catch (error) {
    // ===============================
    // MONGO UNIQUE INDEX ERROR
    // ===============================
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || "field";
      const value = error.keyValue?.[field];

      return res.status(409).json({
        message: `${field.charAt(0).toUpperCase() + field.slice(1)} "${value}" already exists.`,
      });
    }

    // ===============================
    // MONGOOSE VALIDATION ERROR
    // ===============================
    if (error.name === "ValidationError") {
      const firstError = Object.values(error.errors)[0]?.message;

      return res.status(400).json({
        message: firstError || "Validation failed.",
      });
    }

    logger.error(`Campaign creation failed: ${error.message}`, error);

    return res.status(500).json({
      message: "Failed to create campaign",
      error: error.message,
    });
  }
};

export const getCampaigns = async (req, res) => {
  try {
    const { page = 1, limit = 10, status, search } = req.query;

    const userId = req.user.id;

    const query = { userId };

    //  Filter by status
    if (status) {
      query.status = status;
    }

    //  Search by campaign name
    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const campaigns = await campaignSchema
      .find(query)
      .populate("templateId", "name subject")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await campaignSchema.countDocuments(query);

    //  Add computed fields
    const formatted = await Promise.all(
      campaigns.map(async (c) => {
        const totalRecipients = c.totalRecipients || 0;
        const rawProcessed = (c.sentCount || 0) + (c.failedCount || 0);
        const effectiveProcessed = Math.min(rawProcessed, totalRecipients);

        const progress = totalRecipients
          ? Math.min(
              100,
              Math.max(
                0,
                Number(
                  ((effectiveProcessed / totalRecipients) * 100).toFixed(1),
                ),
              ),
            )
          : 0;

        const successRate = rawProcessed
          ? Number(((c.sentCount / rawProcessed) * 100).toFixed(1))
          : 0;

        const remainingQueued = await CampaignRecipientLog.countDocuments({
          campaignId: c._id,
          status: { $in: ["queued", "scheduled"] },
        });

        return {
          ...c.toObject(),
          progress,
          successRate,
          remainingQueued,
        };
      }),
    );

    return res.status(200).json({
      success: true,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      totalCampaigns: total,
      campaigns: formatted,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaigns",
    });
  }
};

export const getCampaignById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid campaign ID",
      });
    }

    const campaign = await campaignSchema
      .findOne({ _id: id, userId })
      .populate("templateId");

    if (!campaign) {
      return res.status(404).json({
        success: false,
        message: "Campaign not found",
      });
    }

    const totalRecipients = campaign.totalRecipients || 0;
    const rawProcessed =
      (campaign.sentCount || 0) + (campaign.failedCount || 0);
    const effectiveProcessed = Math.min(rawProcessed, totalRecipients);

    const progress = totalRecipients
      ? Math.min(
          100,
          Math.max(
            0,
            Number(((effectiveProcessed / totalRecipients) * 100).toFixed(1)),
          ),
        )
      : 0;

    const successRate = rawProcessed
      ? Number(((campaign.sentCount / rawProcessed) * 100).toFixed(1))
      : 0;

    const remainingQueued = await CampaignRecipientLog.countDocuments({
      campaignId: campaign._id,
      status: { $in: ["queued", "scheduled"] },
    });

    return res.status(200).json({
      success: true,
      campaign: {
        ...campaign.toObject(),
        progress,
        successRate,
        remainingQueued,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaign",
    });
  }
};

export const deleteCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const campaign = await campaignSchema.findOne({ _id: id, userId });

    if (!campaign) {
      return res.status(404).json({ message: "Campaign not found" });
    }

    await campaign.deleteOne();
    await CampaignRecipientLog.deleteMany({ campaignId: id });

    res.json({ message: "Campaign deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete campaign" });
  }
};

export const getCampaignLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const userId = req.user.id;

    // Verify ownership of the campaign first
    const campaign = await campaignSchema.findOne({ _id: id, userId });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    const query = { campaignId: id };
    if (status) {
      query.status = status;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const logs = await CampaignRecipientLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await CampaignRecipientLog.countDocuments(query);

    return res.status(200).json({
      success: true,
      page: Number(page),
      totalPages: Math.ceil(total / limit),
      totalLogs: total,
      logs,
    });
  } catch (error) {
    console.error("Failed to fetch campaign logs:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch campaign logs",
    });
  }
};

export const stopCampaign = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const campaign = await campaignSchema.findOne({ _id: id, userId });
    if (!campaign) {
      return res
        .status(404)
        .json({ success: false, message: "Campaign not found" });
    }

    if (
      campaign.status === "completed" ||
      campaign.status === "failed" ||
      campaign.status === "stopped"
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: `Campaign is already ${campaign.status}`,
        });
    }

    campaign.status = "stopped";
    campaign.holdReason = undefined;
    campaign.resumeAt = undefined;
    await campaign.save();

    // Also update any remaining scheduled logs to "skipped"
    await CampaignRecipientLog.updateMany(
      { campaignId: id, status: { $in: ["queued", "scheduled"] } },
      { $set: { status: "skipped", errorReason: "Campaign has been stopped" } },
    );

    // ===============================
    // EMIT REAL-TIME UPDATE
    // ===============================
    emitCampaignUpdated(userId, id);

    return res
      .status(200)
      .json({ success: true, message: "Campaign stopped successfully" });
  } catch (error) {
    console.error("Failed to stop campaign:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to stop campaign" });
  }
};
