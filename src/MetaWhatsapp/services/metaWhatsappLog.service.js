import logger from "../../config/logger.js";
import mongoose from "mongoose";
import MetaWhatsappLog from "../models/metaWhatsappLogSchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import MetaWhatsappCampaign from "../models/metaWhatsappCampaignSchema.js";
import { resolveMessagePrice } from "./metaWhatsappPricing.service.js";
import { getMetaErrorInfo } from "../utils/metaErrorCatalog.js";
import socketService from "../../socket.js";
import MetaRetryEngine from "./metaRetryEngine.service.js";

// ─── STATUS PROGRESSION ORDER ─────────────────────────────────────────────────
// Only allow forward transitions: queued → sent → delivered → read
// Failed can happen from any state.
const STATUS_ORDER = { queued: 0, sent: 1, delivered: 2, read: 3 };

/**
 * Determine if a status update should be applied (prevents backward transitions)
 */
const shouldUpdateStatus = (currentStatus, newStatus) => {
    if (newStatus === "failed") return true;
    const currentRank = STATUS_ORDER[currentStatus] ?? -1;
    const newRank = STATUS_ORDER[newStatus] ?? -1;
    return newRank > currentRank;
};

// ─── RESOLVE USER & NUMBER CONTEXT ────────────────────────────────────────────

/**
 * Look up the WhatsAppToken to get userId, numberId, wabaId, phoneNumber
 */
const resolveNumberContext = async (phoneNumberId) => {
    if (!phoneNumberId) return {};
    try {
        const token = await WhatsAppToken.findOne({ phoneNumberId }).lean();
        if (token) {
            return {
                userId: token.userId,
                numberId: token._id,
                wabaId: token.wabaId,
                whatsappNumber: token.phoneNumber || token.displayName,
            };
        }
    } catch (err) {
        logger.error(`[LogService] Failed to resolve number context for ${phoneNumberId}: ${err.message}`);
    }
    return {};
};

// ─── LOG OUTBOUND MESSAGE ─────────────────────────────────────────────────────

/**
 * Create a log entry for an outbound message we sent.
 *
 * @param {Object} opts
 * @param {string} opts.phoneNumberId   - Meta phone number ID
 * @param {string} opts.to              - Recipient phone number
 * @param {string} opts.metaMessageId   - wamid from Meta response
 * @param {string} [opts.messageType]   - text, template, interactive, etc.
 * @param {string} [opts.templateName]  - Template name if template message
 * @param {string} [opts.campaignId]    - Campaign ObjectId
 * @param {string} [opts.campaignName]  - Campaign name
 * @param {string} [opts.content]       - Message body preview
 * @param {string} [opts.origin]        - campaign, chatbot, manual
 * @param {string} [opts.userId]        - Override userId
 * @param {string} [opts.numberId]      - Override numberId
 * @param {string} [opts.wabaId]        - Override wabaId
 * @param {string} [opts.whatsappNumber]- Override display phone
 */
export const logOutboundMessage = async (opts) => {
    try {
        // Resolve context from phoneNumberId if not provided
        const ctx = await resolveNumberContext(opts.phoneNumberId);
        const userId = opts.userId || ctx.userId;

        if (!userId) {
            logger.warn(`[LogService] Cannot log outbound — no userId for phoneNumberId: ${opts.phoneNumberId}`);
            return null;
        }

        // Resolve message price immediately on send/log creation
        let price = 0;
        let currency = "INR";
        let resolvedCategory = opts.category || (opts.templateName ? "marketing" : "service");
        try {
            const priceInfo = await resolveMessagePrice(opts.to, resolvedCategory, true);
            price = priceInfo.price;
            currency = priceInfo.currency;
        } catch (priceErr) {
            logger.error(`[LogService] Outbound log price resolution failed: ${priceErr.message}`);
        }

        const log = await MetaWhatsappLog.findOneAndUpdate(
            // Use metaMessageId as upsert key if available
            opts.metaMessageId
                ? { metaMessageId: opts.metaMessageId }
                : { _id: new mongoose.Types.ObjectId() },
            {
                $setOnInsert: {
                    userId,
                    numberId: opts.numberId || ctx.numberId,
                    wabaId: opts.wabaId || ctx.wabaId,
                    phoneNumberId: opts.phoneNumberId,
                    whatsappNumber: opts.whatsappNumber || ctx.whatsappNumber,
                    metaMessageId: opts.metaMessageId || null,
                    direction: "outbound",
                    messageType: opts.messageType || "text",
                    templateName: opts.templateName || null,
                    campaignId: opts.campaignId || null,
                    campaignName: opts.campaignName || null,
                    origin: opts.origin || "unknown",
                    to: opts.to,
                    from: opts.whatsappNumber || ctx.whatsappNumber,
                    customerNumber: opts.to,
                    content: opts.content ? String(opts.content).substring(0, 500) : null,
                    originalPayload: opts.originalPayload || null,
                    status: opts.status || "sent",
                    sentAt: new Date(),
                    errors: opts.errors || [],
                    statusHistory: [{ status: opts.status || "sent", timestamp: new Date(), errors: opts.errors || [] }],
                    price,
                    currency,
                    pricing: {
                        model: "CBP",
                        category: resolvedCategory,
                        billable: true
                    }
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        logger.debug(`[LogService] Logged outbound message to ${opts.to} (${log._id})`);
        return log;
    } catch (err) {
        // Duplicate key on metaMessageId is OK (idempotent)
        if (err.code === 11000) {
            logger.debug(`[LogService] Outbound log already exists for metaMessageId: ${opts.metaMessageId}`);
            return null;
        }
        logger.error(`[LogService] Failed to log outbound message: ${err.message}`);
        return null;
    }
};

// ─── LOG INBOUND MESSAGE ──────────────────────────────────────────────────────

/**
 * Create a log entry for an inbound message received via webhook.
 *
 * @param {Object} opts
 * @param {string} opts.phoneNumberId - Meta phone number ID that received the message
 * @param {string} opts.from          - Sender (customer) phone number
 * @param {string} opts.metaMessageId - wamid from Meta webhook
 * @param {string} [opts.messageType] - text, image, interactive, etc.
 * @param {string} [opts.content]     - Message body preview
 * @param {Object} [opts.providerData]- Raw webhook message object
 */
export const logInboundMessage = async (opts) => {
    try {
        const ctx = await resolveNumberContext(opts.phoneNumberId);
        const userId = opts.userId || ctx.userId;

        if (!userId) {
            logger.warn(`[LogService] Cannot log inbound — no userId for phoneNumberId: ${opts.phoneNumberId}`);
            return null;
        }

        const log = await MetaWhatsappLog.findOneAndUpdate(
            opts.metaMessageId
                ? { metaMessageId: opts.metaMessageId }
                : { _id: new mongoose.Types.ObjectId() },
            {
                $setOnInsert: {
                    userId,
                    numberId: opts.numberId || ctx.numberId,
                    wabaId: opts.wabaId || ctx.wabaId,
                    phoneNumberId: opts.phoneNumberId,
                    whatsappNumber: opts.whatsappNumber || ctx.whatsappNumber,
                    metaMessageId: opts.metaMessageId || null,
                    direction: "inbound",
                    messageType: opts.messageType || "text",
                    origin: "webhook",
                    to: opts.whatsappNumber || ctx.whatsappNumber,
                    from: opts.from,
                    customerNumber: opts.from,
                    content: opts.content ? String(opts.content).substring(0, 500) : null,
                    status: "delivered",
                    deliveredAt: new Date(),
                    statusHistory: [{ status: "delivered", timestamp: new Date() }],
                    providerData: opts.providerData || null,
                },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        logger.debug(`[LogService] Logged inbound message from ${opts.from} (${log._id})`);
        return log;
    } catch (err) {
        if (err.code === 11000) {
            logger.debug(`[LogService] Inbound log already exists for metaMessageId: ${opts.metaMessageId}`);
            return null;
        }
        logger.error(`[LogService] Failed to log inbound message: ${err.message}`);
        return null;
    }
};

// ─── UPDATE MESSAGE STATUS ────────────────────────────────────────────────────

/**
 * Update the status of an existing log entry (from webhook delivery receipts).
 * Creates the log if it doesn't exist (for messages sent before logging was enabled).
 *
 * @param {Object} opts
 * @param {string} opts.metaMessageId   - wamid from webhook
 * @param {string} opts.status          - new status (sent, delivered, read, failed)
 * @param {Date}   [opts.timestamp]     - event timestamp
 * @param {Object} [opts.errors]        - error info { code, message }
 * @param {Object} [opts.pricing]       - { model, category, billable }
 * @param {Object} [opts.conversation]  - { id, origin }
 * @param {string} [opts.phoneNumberId] - for creating new log if not found
 * @param {string} [opts.recipientId]   - the customer phone number
 */
export const updateMessageStatus = async (opts) => {
    if (!opts.metaMessageId) return null;

    try {
        const existing = await MetaWhatsappLog.findOne({ metaMessageId: opts.metaMessageId });

        // Normalize errors array
        const formattedErrors = opts.errors
            ? (Array.isArray(opts.errors) ? opts.errors : [opts.errors]).map((e) => ({
                  code: e?.code || null,
                  title: e?.title || null,
                  message: e?.message || null,
                  error_data: e?.error_data ? { details: e.error_data.details || null } : { details: null }
              }))
            : [];

        const firstError = formattedErrors[0] || (Array.isArray(opts.errors) ? opts.errors[0] : opts.errors);

        if (existing) {
            // Check if status should progress
            if (!shouldUpdateStatus(existing.status, opts.status)) {
                logger.debug(`[LogService] Skipping backward status update: ${existing.status} → ${opts.status} for ${opts.metaMessageId}`);
                return existing;
            }

            const update = {
                status: opts.status,
                $push: {
                    statusHistory: {
                        status: opts.status,
                        timestamp: opts.timestamp || new Date(),
                        errors: formattedErrors,
                    },
                },
            };

            if (opts.status === "sent") update.sentAt = opts.timestamp || new Date();
            if (opts.status === "delivered") update.deliveredAt = opts.timestamp || new Date();
            if (opts.status === "read") {
                update.readAt = opts.timestamp || new Date();
                if (!existing.deliveredAt) update.deliveredAt = opts.timestamp || new Date();
            }
            if (opts.status === "failed") {
                update.failedAt = opts.timestamp || new Date();
                update.errors = formattedErrors;
            }

            // If the log does not have a price yet, or the webhook provided pricing details, resolve/update it
            if (opts.pricing || !existing.price) {
                const category = opts.pricing?.category || existing.pricing?.category || (existing.templateName ? "marketing" : "service");
                const billable = opts.pricing ? (opts.pricing.billable ?? false) : true;
                const recipientPhone = opts.recipientId || existing.to || existing.customerNumber;
                
                if (opts.pricing) {
                    update["pricing.model"] = opts.pricing.pricing_model || opts.pricing.model || null;
                    update["pricing.category"] = opts.pricing.category || null;
                    update["pricing.billable"] = opts.pricing.billable ?? false;
                }

                try {
                    const priceInfo = await resolveMessagePrice(recipientPhone, category, billable);
                    update.price = priceInfo.price;
                    update.currency = priceInfo.currency;
                } catch (priceErr) {
                    logger.error(`[LogService] Failed to resolve message price: ${priceErr.message}`);
                }
            }

            if (opts.conversation) {
                update.conversationId = opts.conversation.id || null;
                update.conversationOrigin = opts.conversation.origin?.type || opts.conversation.origin || null;
            }

            const updated = await MetaWhatsappLog.findOneAndUpdate(
                { metaMessageId: opts.metaMessageId },
                update,
                { new: true }
            );

            logger.debug(`[LogService] Updated status: ${opts.metaMessageId} → ${opts.status}`);
            
            // Feature 1: Trigger Retry Engine if status is failed
            // if (opts.status === "failed" && updated.originalPayload) {
            //     await MetaRetryEngine.evaluateAndQueue(updated, opts.phoneNumberId, updated.originalPayload);
            // }

            // ─── SYNC TO CAMPAIGN IF APPLICABLE ──────────────────────────────
            let targetCampaignId = updated.campaignId;
            if (!targetCampaignId && opts.metaMessageId) {
                const matchedCamp = await MetaWhatsappCampaign.findOne({ "recipients.metaMessageId": opts.metaMessageId }).select("_id").lean();
                if (matchedCamp) {
                    targetCampaignId = matchedCamp._id;
                    await MetaWhatsappLog.updateOne({ _id: updated._id }, { $set: { campaignId: targetCampaignId } });
                }
            }

            if (targetCampaignId) {
                try {
                    const statusUpper = opts.status.toUpperCase();
                    const lowerStatus = opts.status.toLowerCase();
                    const statKey = `stats.${lowerStatus}`;
                    const timeField = `${lowerStatus}At`;

                    const errCode = firstError?.code ? String(firstError.code) : null;
                    const rawErrMsg = firstError?.error_data?.details || firstError?.message || firstError?.title || null;
                    const errorInfo = errCode ? getMetaErrorInfo(errCode, rawErrMsg) : null;

                    let targetStatus = statusUpper;
                    let retryAtDate = null;

                    if (errCode === "131049") {
                        targetStatus = "SCHEDULED_RETRY";
                        retryAtDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    }

                    const setFields = {
                        "recipients.$[elem].status": targetStatus,
                        [`recipients.$[elem].${timeField}`]: opts.timestamp || new Date(),
                        "recipients.$[elem].errorCode": errCode,
                        "recipients.$[elem].errorMessage": rawErrMsg,
                        "recipients.$[elem].logId": updated._id,
                    };
                    if (retryAtDate) {
                        setFields["recipients.$[elem].scheduledRetryAt"] = retryAtDate;
                    }
                    if (statusUpper === "READ") {
                        setFields["recipients.$[elem].deliveredAt"] = opts.timestamp || new Date();
                    }

                    // Update the specific recipient
                    let campaignDoc = await MetaWhatsappCampaign.findOneAndUpdate(
                        { 
                            _id: targetCampaignId,
                            "recipients.metaMessageId": opts.metaMessageId
                        },
                        {
                            $set: setFields
                        },
                        {
                            arrayFilters: [{ "elem.metaMessageId": opts.metaMessageId }],
                            new: true
                        }
                    );
                    
                    if (!campaignDoc && updated.to) {
                        const cleanPhone = String(updated.to).replace(/\D/g, "");
                        campaignDoc = await MetaWhatsappCampaign.findOne({ _id: targetCampaignId });
                        if (campaignDoc && Array.isArray(campaignDoc.recipients)) {
                            const targetRec = campaignDoc.recipients.find(r => 
                                (r.metaMessageId && r.metaMessageId === opts.metaMessageId) ||
                                (r.logId && String(r.logId) === String(updated._id)) ||
                                (r.phoneNumber && (r.phoneNumber.replace(/\D/g, "").endsWith(cleanPhone) || cleanPhone.endsWith(r.phoneNumber.replace(/\D/g, ""))))
                            );

                            if (targetRec) {
                                targetRec.status = statusUpper;
                                targetRec[`${lowerStatus}At`] = opts.timestamp || new Date();
                                if (statusUpper === "READ") targetRec.deliveredAt = opts.timestamp || new Date();
                                targetRec.errorCode = errCode;
                                targetRec.errorMessage = rawErrMsg;
                                targetRec.logId = updated._id;
                                if (!targetRec.metaMessageId) targetRec.metaMessageId = opts.metaMessageId;

                                campaignDoc.recalculateStats();
                                await campaignDoc.save();
                            }
                        }
                    } else if (campaignDoc) {
                        campaignDoc.recalculateStats();
                        await campaignDoc.save();
                    }

                    if (campaignDoc) {
                        logger.debug(`[LogService] Synced webhook status ${opts.status} to campaign ${targetCampaignId}`);

                        // Emit real-time Socket event to connected user interface
                        if (socketService && campaignDoc.userId) {
                            socketService.emitToUser(String(campaignDoc.userId), "whatsapp:campaign_updated", {
                                campaignId: campaignDoc._id,
                                stats: campaignDoc.stats,
                                status: campaignDoc.status,
                                metaMessageId: opts.metaMessageId,
                                recipientStatus: statusUpper,
                                errorCode: errCode,
                                errorMessage: rawErrMsg
                            });
                        }
                    }
                } catch (campErr) {
                    logger.error(`[LogService] Failed to sync status to campaign: ${campErr.message}`);
                }
            }

            return updated;
        }

        // Log doesn't exist — create a minimal entry (for messages sent before logging was enabled)
        if (opts.phoneNumberId) {
            const ctx = await resolveNumberContext(opts.phoneNumberId);
            if (ctx.userId) {
                // Resolve pricing details
                let resolvedPrice = 0;
                let resolvedCurrency = "INR";
                const cat = opts.pricing?.category || "marketing";
                const billable = opts.pricing ? (opts.pricing.billable ?? false) : true;
                try {
                    const priceInfo = await resolveMessagePrice(
                        opts.recipientId,
                        cat,
                        billable
                    );
                    resolvedPrice = priceInfo.price;
                    resolvedCurrency = priceInfo.currency;
                } catch (priceErr) {
                    logger.error(`[LogService] Failed to resolve retroactive message price: ${priceErr.message}`);
                }

                const newLog = await MetaWhatsappLog.create({
                    userId: ctx.userId,
                    numberId: ctx.numberId,
                    wabaId: ctx.wabaId,
                    phoneNumberId: opts.phoneNumberId,
                    whatsappNumber: ctx.whatsappNumber,
                    metaMessageId: opts.metaMessageId,
                    direction: "outbound",
                    messageType: "template",
                    origin: "unknown",
                    to: opts.recipientId || null,
                    customerNumber: opts.recipientId || null,
                    status: opts.status,
                    sentAt: opts.status === "sent" ? (opts.timestamp || new Date()) : null,
                    deliveredAt: opts.status === "delivered" ? (opts.timestamp || new Date()) : null,
                    readAt: opts.status === "read" ? (opts.timestamp || new Date()) : null,
                    failedAt: opts.status === "failed" ? (opts.timestamp || new Date()) : null,
                    errors: formattedErrors,
                    pricing: opts.pricing ? {
                        model: opts.pricing.pricing_model || null,
                        category: opts.pricing.category || null,
                        billable: opts.pricing.billable ?? false,
                    } : {},
                    price: resolvedPrice,
                    currency: resolvedCurrency,
                    conversationId: opts.conversation?.id || null,
                    conversationOrigin: opts.conversation?.origin?.type || null,
                    statusHistory: [{
                        status: opts.status,
                        timestamp: opts.timestamp || new Date(),
                        errors: formattedErrors,
                    }],
                });
                logger.debug(`[LogService] Created retroactive log for ${opts.metaMessageId} with status ${opts.status}`);
                return newLog;
            }
        }

        logger.debug(`[LogService] No existing log for metaMessageId: ${opts.metaMessageId} and cannot create`);
        return null;
    } catch (err) {
        if (err.code === 11000) {
            logger.debug(`[LogService] Duplicate on status update for ${opts.metaMessageId}`);
            return null;
        }
        logger.error(`[LogService] Failed to update status for ${opts.metaMessageId}: ${err.message}`);
        return null;
    }
};

export default {
    logOutboundMessage,
    logInboundMessage,
    updateMessageStatus,
};
