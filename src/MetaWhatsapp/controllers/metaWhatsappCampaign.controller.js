import Campaign from "../models/metaWhatsappCampaignSchema.js";
import ContactList from "../models/metaWhatsappCampaignContactListSchema.js";
import Template from "../models/metaWhatsappCampaignTemplateSchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import { runCampaign, pauseCampaign, resumeCampaign } from "../services/metaWhatsapp.campaign.service.js";
import logger from "../../config/logger.js";
import { agenda } from "../../jobs/agenda/agenda.js";
import mongoose from "mongoose";
import { resolveMessagePrice, calculateCampaignCost, getUserAvailableCredits } from "../services/metaWhatsappPricing.service.js";

// ─── HELPER ───────────────────────────────────────────────────────────────────

const getPagination = (query) => {
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
    const skip = (page - 1) * limit;
    return { page, limit, skip };
};

// ─── GET ALL CAMPAIGNS ────────────────────────────────────────────────────────
// GET /api/meta-whatsapp/campaigns
// Query: { status, search, page, limit }

export const getCampaigns = async (req, res, next) => {
    try {
        const { status, search } = req.query;
        const { page, limit, skip } = getPagination(req.query);

        const filter = { userId: req.user.id, isDeleted: false };
        if (status) filter.status = status;
        if (search) filter.name = { $regex: search, $options: "i" };

        const [campaigns, total] = await Promise.all([
            Campaign.find(filter)
                .populate("numberId", "displayName phoneNumber")
                .populate("templateId", "name category language")
                .populate("contactListId", "name contactCount")
                .populate("recipients.logId")
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Campaign.countDocuments(filter),
        ]);

        // Enrich with computed performance rates & stats format from live recipient counts & status history
        const enrichedCampaigns = campaigns.map((c) => {
            let stats = c.stats || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, skippedUserLimit: 0 };

            if (Array.isArray(c.recipients) && c.recipients.length > 0) {
                const counts = { total: c.recipients.length, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, skippedUserLimit: 0 };
                for (const r of c.recipients) {
                    const logErr = r.logId?.errors?.[0];
                    const errorCode = r.errorCode || (logErr?.code ? String(logErr.code) : null);
                    const errorMessage = r.errorMessage || logErr?.error_data?.details || logErr?.message || logErr?.title || null;
                    const isFailed = Boolean(errorCode || errorMessage || r.status === "FAILED");

                    const historyStatus = r.logId?.statusHistory?.length 
                        ? r.logId.statusHistory[r.logId.statusHistory.length - 1].status?.toUpperCase()
                        : (r.statusHistory?.length ? r.statusHistory[r.statusHistory.length - 1].status?.toUpperCase() : null);

                    const effectiveStatus = isFailed ? "FAILED" : (historyStatus || (r.status ? String(r.status).toUpperCase() : "PENDING"));

                    if (isFailed) {
                        counts.failed++;
                    } else if (effectiveStatus === "READ") {
                        counts.sent++;
                        counts.delivered++;
                        counts.read++;
                    } else if (effectiveStatus === "DELIVERED") {
                        counts.sent++;
                        counts.delivered++;
                    } else if (effectiveStatus === "SENT") {
                        counts.sent++;
                    } else if (effectiveStatus === "SKIPPED" || effectiveStatus === "SKIPPED_USER_LIMIT") {
                        counts.skipped++;
                        if (effectiveStatus === "SKIPPED_USER_LIMIT") counts.skippedUserLimit++;
                    }
                }
                stats = counts;
            }

            const progressPercent = stats.total ? Math.min(100, Math.round(((stats.sent + stats.failed + (stats.skipped || 0)) / stats.total) * 100)) : 0;
            const deliveryRate = stats.sent ? Math.min(100, Math.round((stats.delivered / stats.sent) * 100)) : 0;
            const readRate = stats.delivered ? Math.min(100, Math.round((stats.read / stats.delivered) * 100)) : 0;

            const campaignCopy = { ...c, stats, progressPercent, deliveryRate, readRate };
            delete campaignCopy.recipients; // Omit large array in list payload
            return campaignCopy;
        });

        // DUMMY DATA INJECTION for flow checking if DB is empty
        if (enrichedCampaigns.length === 0) {
            const dummyCampaigns = [
                {
                    _id: "wa_dummy_1",
                    name: "Diwali Special Offer",
                    status: "RUNNING",
                    numberId: { displayName: "MyTek Support", phoneNumber: "+91 9876543210" },
                    templateId: { name: "diwali_offer", category: "MARKETING", language: "en_US" },
                    createdAt: new Date().toISOString(),
                    stats: { total: 5000, sent: 4800, delivered: 4000, read: 3500, failed: 200 },
                    progressPercent: 100,
                    deliveryRate: 83,
                    readRate: 87
                },
                {
                    _id: "wa_dummy_2",
                    name: "Abandoned Cart Reminder",
                    status: "SCHEDULED",
                    numberId: { displayName: "MyTek Sales", phoneNumber: "+91 9876543210" },
                    templateId: { name: "abandoned_cart", category: "UTILITY", language: "en_US" },
                    scheduledAt: new Date(Date.now() + 86400000).toISOString(),
                    createdAt: new Date().toISOString(),
                    stats: { total: 100, sent: 0, delivered: 0, read: 0, failed: 0 },
                    progressPercent: 0,
                    deliveryRate: 0,
                    readRate: 0
                },
                {
                    _id: "wa_dummy_3",
                    name: "Monthly Newsletter",
                    status: "COMPLETED",
                    numberId: { displayName: "MyTek Updates", phoneNumber: "+91 9876543211" },
                    templateId: { name: "monthly_newsletter", category: "MARKETING", language: "en_US" },
                    createdAt: new Date(Date.now() - 172800000).toISOString(),
                    stats: { total: 12000, sent: 12000, delivered: 11500, read: 9000, failed: 500 },
                    progressPercent: 100,
                    deliveryRate: 95,
                    readRate: 78
                }
            ];

            return res.json({
                success: true,
                data: dummyCampaigns,
                pagination: { page: 1, limit: 20, total: 3, pages: 1 },
            });
        }

        res.json({
            success: true,
            data: enrichedCampaigns,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
    } catch (err) {
        next(err);
    }
};

// ─── GET CAMPAIGN BY ID ───────────────────────────────────────────────────────
// GET /api/meta-whatsapp/campaigns/:id

export const getCampaignById = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            _id: req.params.id,
            userId: req.user.id,
            isDeleted: false,
        })
            .populate("numberId", "displayName phoneNumber")
            .populate("templateId", "name category language body header footer buttons variablesCount")
            .populate("recipients.logId");

        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        let isModified = false;
        const campaignObj = campaign.toObject({ virtuals: true });

        // Ensure recipients array carries live status, error codes, error messages & log metadata
        if (Array.isArray(campaignObj.recipients)) {
            const liveCounts = { total: campaignObj.recipients.length, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, skippedUserLimit: 0 };

            campaignObj.recipients = campaignObj.recipients.map((r, idx) => {
                const logErr = r.logId?.errors?.[0];
                const errorCode = r.errorCode || (logErr?.code ? String(logErr.code) : null);
                const errorMessage = r.errorMessage || logErr?.error_data?.details || logErr?.message || logErr?.title || null;

                const isFailed = Boolean(errorCode || errorMessage || r.status === "FAILED");
                const effectiveStatus = isFailed ? "FAILED" : (r.status || "PENDING");

                if (effectiveStatus !== campaign.recipients[idx]?.status) {
                    campaign.recipients[idx].status = effectiveStatus;
                    isModified = true;
                }

                if (effectiveStatus === "FAILED") {
                    liveCounts.failed++;
                } else if (effectiveStatus === "READ") {
                    liveCounts.sent++;
                    liveCounts.delivered++;
                    liveCounts.read++;
                } else if (effectiveStatus === "DELIVERED") {
                    liveCounts.sent++;
                    liveCounts.delivered++;
                } else if (effectiveStatus === "SENT") {
                    liveCounts.sent++;
                } else if (effectiveStatus === "SKIPPED" || effectiveStatus === "SKIPPED_USER_LIMIT") {
                    liveCounts.skipped++;
                    if (effectiveStatus === "SKIPPED_USER_LIMIT") liveCounts.skippedUserLimit++;
                }

                const deliveredAt = r.deliveredAt || (effectiveStatus === "READ" ? (r.readAt || r.updatedAt) : null);
                const readAt = r.readAt || null;
                const sentAt = r.sentAt || deliveredAt || readAt || (r.createdAt || null);

                const statusHistory = (r.logId && Array.isArray(r.logId.statusHistory)) 
                    ? r.logId.statusHistory 
                    : (Array.isArray(r.statusHistory) ? r.statusHistory : []);

                return {
                    ...r,
                    status: effectiveStatus,
                    sentAt: sentAt,
                    deliveredAt: deliveredAt,
                    readAt: readAt,
                    failedAt: r.failedAt || (isFailed ? (r.updatedAt || new Date()) : null),
                    errorCode: errorCode || null,
                    errorMessage: errorMessage || null,
                    statusHistory: statusHistory,
                };
            });

            campaignObj.stats = liveCounts;
            if (isModified || JSON.stringify(campaign.stats) !== JSON.stringify(liveCounts)) {
                campaign.stats = liveCounts;
                campaign.save().catch(err => logger.error(`[Campaign] Stat sync error: ${err.message}`));
            }
        }

        // Calculate up-to-date summary stats and rates
        const stats = campaignObj.stats || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, skippedUserLimit: 0 };
        campaignObj.progressPercent = stats.total ? Math.min(100, Math.round(((stats.sent + stats.failed + stats.skipped) / stats.total) * 100)) : 0;
        campaignObj.deliveryRate = stats.sent ? Math.min(100, Math.round((stats.delivered / stats.sent) * 100)) : 0;
        campaignObj.readRate = stats.delivered ? Math.min(100, Math.round((stats.read / stats.delivered) * 100)) : 0;

        res.json({ success: true, data: campaignObj });
    } catch (err) {
        next(err);
    }
};

// ─── CREATE CAMPAIGN ──────────────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns
// Body: { name, description, numberId, templateId, contactListId,
//         recipients, variableMapping, scheduledAt, timezone }

export const createCampaign = async (req, res, next) => {
    try {
        const {
            name,
            description,
            numberId,
            templateId,
            recipients,
            variableMapping,
            scheduledAt,
            timezone,
        } = req.body;

        // ── Validate WhatsApp number ─────────────────────────────────────────
        if (!numberId) {
            return res.status(400).json({ success: false, message: "WhatsApp Number ID is required" });
        }
        const waNumber = await WhatsAppToken.findOne({ _id: numberId, userId: req.user.id });
        if (!waNumber) {
            return res.status(404).json({ success: false, message: "WhatsApp number not found" });
        }
        // if (waNumber.status !== "active") {
        //     return res.status(400).json({ success: false, message: `Number is "${waNumber.status}" and cannot be used` });
        // }

        // ── Validate template (must be APPROVED) ─────────────────────────────
        if (!templateId) {
            return res.status(400).json({ success: false, message: "Template ID is required" });
        }
        const template = await Template.findOne({
            _id: templateId,
            userId: req.user.id,
            isDeleted: false,
            status: "APPROVED",
        });
        if (!template) {
            return res.status(404).json({ success: false, message: "Approved template not found" });
        }

        // ── Validate recipients source ───────────────────────────────────────
        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ success: false, message: "Recipients array is required and cannot be empty" });
        }

        const formattedRecipients = [];
        for (let i = 0; i < recipients.length; i++) {
            const r = recipients[i];
            const phone = r.Phone || r.phone || r.phoneNumber;
            const name = r.Name || r.name || null;

            if (!phone || typeof phone !== "string" || phone.trim().length < 5) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Invalid or missing phone number at row ${i + 1}` 
                });
            }

            const variables = {};
            for (const [key, val] of Object.entries(r)) {
                const lowerKey = key.toLowerCase();
                if (lowerKey !== "phone" && lowerKey !== "name" && lowerKey !== "phonenumber") {
                    variables[key] = val !== undefined && val !== null ? String(val) : "";
                }
            }

            formattedRecipients.push({
                phoneNumber: phone.trim(),
                name: name ? name.trim() : null,
                variables,
                status: "PENDING"
            });
        }

        // ── Create ───────────────────────────────────────────────────────────
        const campaign = await Campaign.create({
            userId: req.user.id,
            numberId,
            templateId,
            name,
            description: description || "",
            contactListId: null,
            recipients: formattedRecipients,
            variableMapping: variableMapping || {},
            scheduledAt: scheduledAt || null,
            timezone: timezone || "UTC",
            status: scheduledAt ? "SCHEDULED" : "DRAFT",
            stats: {
                total: formattedRecipients.length
            }
        });

        if (scheduledAt) {
            await agenda.schedule(new Date(scheduledAt), "meta-whatsapp-campaign-run", {
                campaignId: campaign._id.toString()
            });
        }

        res.status(201).json({ success: true, message: "Campaign created", data: campaign });
    } catch (err) {
        next(err);
    }
};

// ─── LAUNCH CAMPAIGN ──────────────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns/:id/launch

export const launchCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            _id: req.params.id,
            userId: req.user.id,
            isDeleted: false,
        }).populate("templateId");

        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        if (!["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)) {
            return res.status(400).json({
                success: false,
                message: `Campaign cannot be launched from "${campaign.status}" status`,
            });
        }

        // ── Pre-flight Costing & User Credit Check ──
        const costInfo = await calculateCampaignCost({
            template: campaign.templateId,
            recipients: campaign.recipients,
            userId: req.user.id
        });

        const availableCredits = await getUserAvailableCredits(req.user.id);
        const requiredCredits = costInfo.totalEstimatedCredits || 0;

        if (requiredCredits > availableCredits) {
            const shortfall = Math.ceil(requiredCredits - availableCredits);
            return res.status(403).json({
                success: false,
                insufficientCredits: true,
                error: `Insufficient Credits! This campaign requires ${requiredCredits} credits, but you only have ${availableCredits} available. Please add credits to continue.`,
                message: `Insufficient Credits! This campaign requires ${requiredCredits} credits, but you only have ${availableCredits} available. Please add credits to continue.`,
                data: {
                    requiredCredits,
                    availableCredits,
                    shortfall,
                    recipientCount: costInfo.recipientCount
                }
            });
        }

        campaign.status = "RUNNING";
        await campaign.save();

        // Respond immediately — campaign runs async
        res.json({
            success: true,
            message: "Campaign launched",
            data: { id: campaign._id, status: "RUNNING" },
        });

        // Fire and forget (swap for Bull queue in production)
        runCampaign(campaign._id.toString()).catch((err) =>
            logger.error("[Campaign] Launch error:", err.message)
        );
    } catch (err) {
        next(err);
    }
};

// ─── PAUSE CAMPAIGN ───────────────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns/:id/pause

export const pauseCampaignCtrl = async (req, res, next) => {
    try {
        const campaign = await pauseCampaign(req.params.id, req.user.id);

        if (!campaign) {
            return res.status(400).json({ success: false, message: "Campaign is not running" });
        }

        res.json({ success: true, message: "Campaign paused", data: campaign });
    } catch (err) {
        next(err);
    }
};

// ─── RESUME CAMPAIGN ──────────────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns/:id/resume

export const resumeCampaignCtrl = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            _id: req.params.id,
            userId: req.user.id,
        }).populate("templateId");

        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        if (campaign.status !== "PAUSED") {
            return res.status(400).json({ success: false, message: "Campaign is not paused" });
        }

        // ── Pre-flight Costing & User Credit Check ──
        const costInfo = await calculateCampaignCost({
            template: campaign.templateId,
            recipients: campaign.recipients,
            userId: req.user.id
        });

        const availableCredits = await getUserAvailableCredits(req.user.id);
        const requiredCredits = costInfo.totalEstimatedCredits || 0;

        if (requiredCredits > availableCredits) {
            const shortfall = Math.ceil(requiredCredits - availableCredits);
            return res.status(403).json({
                success: false,
                insufficientCredits: true,
                error: `Insufficient Credits! Resuming this campaign requires ${requiredCredits} credits, but you only have ${availableCredits} available. Please add credits to continue.`,
                message: `Insufficient Credits! Resuming this campaign requires ${requiredCredits} credits, but you only have ${availableCredits} available. Please add credits to continue.`,
                data: {
                    requiredCredits,
                    availableCredits,
                    shortfall,
                    recipientCount: costInfo.recipientCount
                }
            });
        }

        await resumeCampaign(req.params.id);

        res.json({ success: true, message: "Campaign resumed" });
    } catch (err) {
        next(err);
    }
};

// ─── CANCEL CAMPAIGN ──────────────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns/:id/cancel

export const cancelCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOneAndUpdate(
            {
                _id: req.params.id,
                userId: req.user.id,
                status: { $in: ["DRAFT", "SCHEDULED", "RUNNING", "PAUSED"] },
                isDeleted: false,
            },
            { status: "CANCELLED", cancelledAt: new Date() },
            { new: true }
        );

        if (!campaign) {
            return res.status(400).json({ success: false, message: "Campaign cannot be cancelled" });
        }

        res.json({ success: true, message: "Campaign cancelled", data: campaign });
    } catch (err) {
        next(err);
    }
};

// ─── DELETE CAMPAIGN ──────────────────────────────────────────────────────────
// DELETE /api/meta-whatsapp/campaigns/:id

export const deleteCampaign = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            _id: req.params.id,
            userId: req.user.id,
            isDeleted: false,
        });

        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        if (campaign.status === "RUNNING") {
            return res.status(400).json({ success: false, message: "Cannot delete a running campaign" });
        }

        campaign.isDeleted = true;
        await campaign.save();

        res.json({ success: true, message: "Campaign deleted" });
    } catch (err) {
        next(err);
    }
};

// ─── GET CAMPAIGN STATS ───────────────────────────────────────────────────────
// GET /api/meta-whatsapp/campaigns/:id/stats

export const getCampaignStats = async (req, res, next) => {
    try {
        const campaign = await Campaign.findOne({
            _id: req.params.id,
            userId: req.user.id,
            isDeleted: false,
        }).select("stats status startedAt completedAt name");

        if (!campaign) {
            return res.status(404).json({ success: false, message: "Campaign not found" });
        }

        const { stats } = campaign;

        const enriched = {
            ...stats,
            deliveryRate: stats.sent ? Math.round((stats.delivered / stats.sent) * 100) : 0,
            readRate: stats.delivered ? Math.round((stats.read / stats.delivered) * 100) : 0,
            failureRate: stats.total ? Math.round((stats.failed / stats.total) * 100) : 0,
        };

        res.json({
            success: true,
            data: { ...campaign.toObject(), stats: enriched },
        });
    } catch (err) {
        next(err);
    }
};

// ─── ESTIMATE CAMPAIGN COST ───────────────────────────────────────────────────
// POST /api/meta-whatsapp/campaigns/estimate
export const estimateMetaCampaign = async (req, res, next) => {
    try {
        const { templateId, recipients } = req.body;

        if (!templateId) {
            return res.status(400).json({ success: false, message: "Template ID is required" });
        }

        if (!Array.isArray(recipients) || recipients.length === 0) {
            return res.status(400).json({ success: false, message: "Recipients array is required" });
        }

        // 1. Fetch template
        const template = await Template.findOne({
            _id: templateId,
            userId: req.user.id,
            isDeleted: false
        });

        if (!template) {
            return res.status(404).json({ success: false, message: "Template not found" });
        }

        const category = String(template.category || "marketing").toLowerCase().trim();

        // 2. Resolve price for each recipient
        let totalINR = 0;
        let totalUSD = 0;
        let totalGBP = 0;

        // Load exchange rates for conversion to INR
        let usdRate = 83.5;
        let gbpRate = 108.0;
        try {
            const ExchangeRate = mongoose.model("ExchangeRate");
            const exchangeRateDoc = await ExchangeRate.findOne().sort({ createdAt: -1 });
            if (exchangeRateDoc && exchangeRateDoc.conversion_rate) {
                usdRate = exchangeRateDoc.conversion_rate;
            }
        } catch (e) {
            logger.warn(`[CampaignEstimate] USD exchange rate load failed: ${e.message}`);
        }

        const pricingPromises = recipients.map(async (r) => {
            const phone = String(r.Phone || r.phone || r.phoneNumber || r || "").replace(/\D/g, "");
            if (!phone) return;

            try {
                const priceInfo = await resolveMessagePrice(phone, category, true);
                const priceVal = Number(priceInfo.price) || 0;
                const currency = String(priceInfo.currency || "INR").toUpperCase();

                if (currency === "USD") {
                    totalUSD += priceVal;
                    totalINR += priceVal * usdRate;
                } else if (currency === "GBP") {
                    totalGBP += priceVal;
                    totalINR += priceVal * gbpRate;
                } else {
                    totalINR += priceVal;
                }
            } catch (priceErr) {
                logger.error(`[CampaignEstimate] Price lookup failed for ${phone}: ${priceErr.message}`);
                // Fallback default India marketing price
                totalINR += 0.9631;
            }
        });

        await Promise.all(pricingPromises);

        res.json({
            success: true,
            data: {
                conversations: recipients.length,
                category: template.category,
                estimatedAmountINR: Number(totalINR.toFixed(4)),
                totalAmountINR: Number((totalINR).toFixed(4)), // GST 18%
                breakdown: {
                    usd: Number(totalUSD.toFixed(4)),
                    gbp: Number(totalGBP.toFixed(4)),
                    inr: Number((totalINR - (totalUSD * usdRate) - (totalGBP * gbpRate)).toFixed(4))
                }
            }
        });
    } catch (err) {
        next(err);
    }
};