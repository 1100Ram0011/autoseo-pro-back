import mongoose from "mongoose";

// ─── META WHATSAPP ANALYTICS CACHE SCHEMA ─────────────────────────────────────
// Caches aggregated analytics fetched from Meta Graph API
// (conversation_analytics, analytics, template insights)

const metaWhatsappAnalyticsSchema = new mongoose.Schema(
    {
        // ── Owner ─────────────────────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── WABA Identifier ──────────────────────────────────────────────────
        wabaId: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        // ── Time Period ──────────────────────────────────────────────────────
        periodStart: {
            type: Date,
            required: true,
        },

        periodEnd: {
            type: Date,
            required: true,
        },

        granularity: {
            type: String,
            enum: ["HALF_HOUR", "DAILY", "MONTHLY"],
            default: "DAILY",
        },

        // ── Analytics Type ───────────────────────────────────────────────────
        type: {
            type: String,
            enum: ["conversation_analytics", "message_analytics", "template_insights"],
            required: true,
        },

        // ── Raw Data from Meta ───────────────────────────────────────────────
        data: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            comment: "Raw analytics response from Meta Graph API",
        },

        // ── Parsed Summary ───────────────────────────────────────────────────
        summary: {
            totalConversations: { type: Number, default: 0 },
            freeConversations: { type: Number, default: 0 },
            paidConversations: { type: Number, default: 0 },
            messageSent: { type: Number, default: 0 },
            messageDelivered: { type: Number, default: 0 },
        },

        // ── Fetch Metadata ───────────────────────────────────────────────────
        fetchedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

// ─── INDEXES ──────────────────────────────────────────────────────────────────
metaWhatsappAnalyticsSchema.index({ userId: 1, wabaId: 1, type: 1, periodStart: 1, periodEnd: 1 }, { unique: true });
metaWhatsappAnalyticsSchema.index({ fetchedAt: 1 });

// ─── STATICS ──────────────────────────────────────────────────────────────────

/**
 * Check if analytics cache is still fresh (< 6 hours old)
 */
metaWhatsappAnalyticsSchema.statics.isFresh = async function (userId, wabaId, type, start, end) {
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const cached = await this.findOne({
        userId,
        wabaId,
        type,
        periodStart: start,
        periodEnd: end,
        fetchedAt: { $gte: sixHoursAgo },
    });
    return cached;
};

export default mongoose.model("MetaWhatsappAnalytics", metaWhatsappAnalyticsSchema);
