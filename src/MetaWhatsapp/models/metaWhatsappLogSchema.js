import mongoose from "mongoose";

// ─── ERROR SUB-SCHEMA (matches Meta Webhook structure) ────────────────────────
const errorSchema = new mongoose.Schema({
    code: { type: Number, default: null },
    title: { type: String, default: null },
    message: { type: String, default: null },
    error_data: {
        details: { type: String, default: null }
    }
}, { _id: false });

// ─── STATUS HISTORY SUB-SCHEMA ────────────────────────────────────────────────
const statusEntrySchema = new mongoose.Schema(
    {
        status: {
            type: String,
            enum: ["queued", "sent", "delivered", "read", "failed"],
            required: true,
        },
        timestamp: {
            type: Date,
            default: Date.now,
        },
        errors: { type: [errorSchema], default: [] },
    },
    { _id: false }
);

// ─── PRICING SUB-SCHEMA ──────────────────────────────────────────────────────
const pricingSchema = new mongoose.Schema(
    {
        model: { type: String, default: null },           // e.g. "CBP"
        category: { type: String, default: null },         // e.g. "marketing", "utility", "authentication", "service"
        billable: { type: Boolean, default: false },
    },
    { _id: false }
);

// ─── META WHATSAPP LOG SCHEMA ─────────────────────────────────────────────────
const metaWhatsappLogSchema = new mongoose.Schema(
    {
        // ── Owner ─────────────────────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── Linked WhatsApp Number ────────────────────────────────────────────
        numberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsAppToken",
            default: null,
            index: true,
        },

        wabaId: {
            type: String,
            trim: true,
            default: null,
        },

        phoneNumberId: {
            type: String,
            trim: true,
            index: true,
        },

        whatsappNumber: {
            type: String,
            trim: true,
            comment: "Display phone number of the business e.g. +15551479354",
        },

        // ── Meta Message Identifier ───────────────────────────────────────────
        metaMessageId: {
            type: String,
            trim: true,
            index: true,
            sparse: true,
            comment: "wamid:xxx returned by Meta after send / in webhook",
        },

        // ── Direction ─────────────────────────────────────────────────────────
        direction: {
            type: String,
            enum: ["inbound", "outbound"],
            required: true,
            index: true,
        },

        // ── Message Info ──────────────────────────────────────────────────────
        messageType: {
            type: String,
            enum: [
                "text", "template", "image", "video", "document",
                "audio", "interactive", "sticker", "location", "contacts",
            ],
            default: "text",
            trim: true,
        },

        templateName: {
            type: String,
            trim: true,
            default: null,
            index: true,
        },

        // ── Campaign Context ──────────────────────────────────────────────────
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MetaWhatsappCampaign",
            default: null,
            index: true,
        },

        campaignName: {
            type: String,
            trim: true,
            default: null,
        },

        // ── Origin Source ─────────────────────────────────────────────────────
        origin: {
            type: String,
            enum: ["campaign", "chatbot", "manual", "webhook", "unknown"],
            default: "unknown",
        },

        // ── Participants ──────────────────────────────────────────────────────
        to: {
            type: String,
            trim: true,
            index: true,
            comment: "Recipient phone number",
        },

        from: {
            type: String,
            trim: true,
            comment: "Sender phone number",
        },

        customerNumber: {
            type: String,
            trim: true,
            index: true,
            comment: "The end-user phone (alias for to/from depending on direction)",
        },

        // ── Content ──────────────────────────────────────────────────────────
        content: {
            type: String,
            trim: true,
            default: null,
            comment: "Message body preview (first 500 chars)",
            maxlength: 500,
        },

        // ── Delivery Status ──────────────────────────────────────────────────
        status: {
            type: String,
            enum: ["queued", "sent", "delivered", "read", "failed"],
            default: "queued",
            index: true,
        },

        statusHistory: {
            type: [statusEntrySchema],
            default: [],
        },

        // ── Retry Tracker (Feature 1) ────────────────────────────────────────
        retryCount: { type: Number, default: 0 },
        retryStatus: { 
            type: String, 
            enum: ["NONE", "SCHEDULED", "RETRYING", "EXHAUSTED", "SUCCESSFUL"], 
            default: "NONE" 
        },
        lastErrorCode: { type: String, default: null },
        lastErrorMessage: { type: String, default: null },
        nextRetryAt: { type: Date, default: null },
        retryHistory: [{
            attempt: Number,
            errorCode: String,
            errorMessage: String,
            scheduledAt: Date,
            executedAt: Date,
            result: { type: String, enum: ["SUCCESS", "FAILED"] }
        }],

        // ── Timestamps from Meta ─────────────────────────────────────────────
        sentAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },

        // ── Error Info ───────────────────────────────────────────────────────
        errors: { type: [errorSchema], default: [] },

        // ── Pricing (from Meta webhook) ──────────────────────────────────────
        pricing: {
            type: pricingSchema,
            default: () => ({}),
        },

        price: {
            type: Number,
            default: 0,
        },
        currency: {
            type: String,
            default: "INR",
        },

        // ── Conversation Info (from Meta) ────────────────────────────────────
        conversationId: {
            type: String,
            trim: true,
            default: null,
            comment: "Meta conversation ID from webhook",
        },

        conversationOrigin: {
            type: String,
            trim: true,
            default: null,
            comment: "user_initiated | business_initiated | referral_conversion",
        },

        // ── Raw Provider Data ────────────────────────────────────────────────
        providerData: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            comment: "Raw webhook payload for debugging",
        },

        originalPayload: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            comment: "The exact payload sent to Meta (used for retries)",
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ─── INDEXES ──────────────────────────────────────────────────────────────────
metaWhatsappLogSchema.index({ userId: 1, createdAt: -1 });
metaWhatsappLogSchema.index({ userId: 1, direction: 1 });
metaWhatsappLogSchema.index({ userId: 1, status: 1 });
metaWhatsappLogSchema.index({ phoneNumberId: 1, createdAt: -1 });
metaWhatsappLogSchema.index({ campaignId: 1 });
metaWhatsappLogSchema.index({ metaMessageId: 1 }, { unique: true, sparse: true });
metaWhatsappLogSchema.index({ userId: 1, phoneNumberId: 1, createdAt: -1 });

// ─── STATICS ──────────────────────────────────────────────────────────────────

/**
 * Aggregate stats for a user (optionally filtered by numberId)
 */
metaWhatsappLogSchema.statics.getStats = async function (userId, filters = {}) {
    const match = { userId: new mongoose.Types.ObjectId(userId) };
    if (filters.numberId && mongoose.Types.ObjectId.isValid(filters.numberId)) {
        match.numberId = new mongoose.Types.ObjectId(filters.numberId);
    }
    if (filters.phoneNumberId) match.phoneNumberId = filters.phoneNumberId;
    if (filters.dateFrom || filters.dateTo) {
        match.createdAt = {};
        if (filters.dateFrom) match.createdAt.$gte = new Date(filters.dateFrom);
        if (filters.dateTo) {
            const endDate = new Date(filters.dateTo);
            endDate.setHours(23, 59, 59, 999);
            match.createdAt.$lte = endDate;
        }
    }

    const [result] = await this.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                sent: { $sum: { $cond: [{ $in: ["$status", ["sent", "delivered", "read"]] }, 1, 0] } },
                delivered: { $sum: { $cond: [{ $in: ["$status", ["delivered", "read"]] }, 1, 0] } },
                read: { $sum: { $cond: [{ $eq: ["$status", "read"] }, 1, 0] } },
                failed: { $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } },
                inbound: { $sum: { $cond: [{ $eq: ["$direction", "inbound"] }, 1, 0] } },
                outbound: { $sum: { $cond: [{ $eq: ["$direction", "outbound"] }, 1, 0] } },
            },
        },
    ]);

    return result || { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, inbound: 0, outbound: 0 };
};

export default mongoose.model("MetaWhatsappLog", metaWhatsappLogSchema);
