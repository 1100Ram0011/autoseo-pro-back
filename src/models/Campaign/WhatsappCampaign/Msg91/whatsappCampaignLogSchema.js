import mongoose from "mongoose";

// ── Sub-schema for individual recipient status ────────────────────────────────
const RecipientSchema = new mongoose.Schema(
    {
        initiatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,   // ← was nullable before; now mandatory
            index: true
        },

        phone: {
            type: String,
            required: true,
            trim: true,
        },
        variables: {
            type: Map,
            of: String,
            default: {},
        },
        status: {
            type: String,
            enum: ["QUEUED", "SENT", "FAILED", "DELIVERED", "READ"],
            default: "QUEUED",
        },
        error: {
            type: String,
            default: null,
        },
        msg91RequestId: {
            type: String,
            default: null,
        },
    },
    { _id: false } // no separate _id for each recipient sub-doc
);

// ── Main CampaignLog Schema ───────────────────────────────────────────────────
const CampaignLogSchema = new mongoose.Schema(
    {
        // ── Template Info ─────────────────────────────────────────────────────────
        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Msg91Template",
            required: true,
        },
        templateName: {
            type: String,
            required: true,
            trim: true,
        },

        // ── Sender ────────────────────────────────────────────────────────────────
        fromNumber: {
            type: String,
            required: true,
            trim: true,
        },

        // ── Counts ────────────────────────────────────────────────────────────────
        totalCount: {
            type: Number,
            required: true,
            min: 1,
        },
        sentCount: {
            type: Number,
            default: 0,
        },
        failedCount: {
            type: Number,
            default: 0,
        },
        deliveredCount: {
            type: Number,
            default: 0,
        },

        // ── Recipients ────────────────────────────────────────────────────────────
        recipients: {
            type: [RecipientSchema],
            default: [],
        },

        // ── Campaign Status ───────────────────────────────────────────────────────
        status: {
            type: String,
            enum: ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "PARTIAL"],
            default: "QUEUED"
        },

        // ── MSG91 Raw Response ────────────────────────────────────────────────────
        msg91RequestId: {
            type: String,
            default: null,
        },
        msg91BulkResponse: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },

        // ── Meta ──────────────────────────────────────────────────────────────────
        initiatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },
        completedAt: {
            type: Date,
            default: null,
        },
    },
    {
        timestamps: true,
        versionKey: false,
    }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
CampaignLogSchema.index({ initiatedBy: 1, createdAt: -1 });   // primary list query
CampaignLogSchema.index({ initiatedBy: 1, templateId: 1 });
CampaignLogSchema.index({ initiatedBy: 1, fromNumber: 1 });

// ── Virtual: success rate % ───────────────────────────────────────────────────
CampaignLogSchema.virtual("successRate").get(function () {
    if (!this.totalCount) return 0;
    return Math.round((this.sentCount / this.totalCount) * 100);
});

export default mongoose.model("whatsappCampaignLog", CampaignLogSchema);