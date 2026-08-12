import mongoose from "mongoose";

const msg91WhatsappLogSchema = new mongoose.Schema(
    {
        // ── Owner ─────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── MSG91 Identifiers ──────────────────────────────
        requestId: {
            type: String,
            trim: true,
            index: true,
        },

        uuid: {
            type: String,
            trim: true,
            index: true,
        },

        CRQID: {
            type: String,
            trim: true,
        },

        // ── Phone Numbers ──────────────────────────────────
        integratedNumber: {
            type: String,
            trim: true,
            index: true,
        },

        customerNumber: {
            type: String,
            trim: true,
            index: true,
        },

        // ── Message Info ───────────────────────────────────
        messageType: {
            type: String,
            enum: ["text", "image", "video", "document", "audio", "template", "interactive", "sticker", "location", "contacts"],
            trim: true,
        },

        direction: {
            type: String,
            enum: ["inbound", "outbound"],
            trim: true,
        },

        content: {
            type: String,
            trim: true,
        },

        templateName: {
            type: String,
            trim: true,
            index: true,
        },

        campaignName: {
            type: String,
            trim: true,
            index: true,
        },

        origin: {
            type: String,
            trim: true,
        },

        // ── Delivery Status ────────────────────────────────
        status: {
            type: String,
            enum: [
                "queued",
                "sent",
                "delivered",
                "read",
                "failed",
                "rejected",
                "pending",
            ],
            trim: true,
            index: true,
        },

        failureReason: {
            type: String,
            trim: true,
        },

        // ── Timestamps from MSG91 ──────────────────────────
        requestedAt: Date,
        sentTime: Date,
        deliveryTime: Date,

        // ── Engagement ─────────────────────────────────────
        totalClicked: {
            type: Number,
            default: 0,
        },

        // ── Billing ────────────────────────────────────────
        price: {
            type: Number,
            default: 0,
        },

        // ── Store Full MSG91 Log Object ─────────────────────
        providerData: {
            type: mongoose.Schema.Types.Mixed,
        },

        // ── Optional: Full API Response Metadata ───────────
        providerResponse: {
            type: mongoose.Schema.Types.Mixed,
        },
    },
    {
        timestamps: true,
    }
);

// ── Unique Index (Prevent Duplicate Logs) ─────────────────
msg91WhatsappLogSchema.index(
    { userId: 1, requestId: 1, customerNumber: 1 },
    { unique: true }
);

// ── Performance Indexes ───────────────────────────────────
msg91WhatsappLogSchema.index({ createdAt: -1 });
msg91WhatsappLogSchema.index({ userId: 1, status: 1 });
msg91WhatsappLogSchema.index({ userId: 1, createdAt: -1 });
msg91WhatsappLogSchema.index({ userId: 1, campaignName: 1 });
msg91WhatsappLogSchema.index({ requestedAt: -1 });

export default mongoose.model("Msg91WhatsappLog", msg91WhatsappLogSchema);