import mongoose from "mongoose";

// ─── RECIPIENT SUB-SCHEMA ─────────────────────────────────────────────────────
// Stored when campaign uses inline recipients (no contactListId)
const recipientSchema = new mongoose.Schema(
    {
        phoneNumber: {
            type: String,
            required: true,
            trim: true,
        },
        name: {
            type: String,
            trim: true,
            default: null,
        },
        // Arbitrary key-value pairs for variable substitution in the template
        variables: {
            type: Map,
            of: String,
            default: {},
        },
        // Per-recipient delivery state
        status: {
            type: String,
            enum: ["PENDING", "SENT", "DELIVERED", "READ", "FAILED", "SKIPPED"],
            default: "PENDING",
        },
        sentAt: { type: Date, default: null },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },
        errorCode: { type: String, default: null },
        errorMessage: { type: String, default: null },
        // Meta message ID returned after send
        metaMessageId: { type: String, default: null, index: true, sparse: true },
        // Linked MetaWhatsappLog entry ID
        logId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MetaWhatsappLog",
            default: null,
        },
    },
    { _id: false }
);

// ─── STATS SUB-SCHEMA ─────────────────────────────────────────────────────────
const statsSchema = new mongoose.Schema(
    {
        total: { type: Number, default: 0, min: 0 },
        sent: { type: Number, default: 0, min: 0 },
        delivered: { type: Number, default: 0, min: 0 },
        read: { type: Number, default: 0, min: 0 },
        failed: { type: Number, default: 0, min: 0 },
        skipped: { type: Number, default: 0, min: 0 },
    },
    { _id: false }
);

// ─── CAMPAIGN SCHEMA ──────────────────────────────────────────────────────────
const metaWhatsappCampaignSchema = new mongoose.Schema(
    {
        // ── Ownership ──────────────────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── Identity ──────────────────────────────────────────────────────────
        name: {
            type: String,
            required: [true, "Campaign name is required"],
            trim: true,
            maxlength: [255, "Name cannot exceed 255 characters"],
        },

        description: {
            type: String,
            trim: true,
            default: "",
        },

        // ── Linked resources ──────────────────────────────────────────────────
        numberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsAppToken",
            required: [true, "WhatsApp number is required"],
            index: true,
        },

        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsappTemplateSchema",
            required: [true, "Template is required"],
            index: true,
        },

        // ── Recipients ────────────────────────────────────────────────────────
        // Use EITHER contactListId OR inline recipients — not both.
        contactListId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsappContactList",
            default: null,
            index: true,
        },

        // Populated from contactListId at launch time, or provided inline.
        // Excluded from list-view queries via .select("-recipients").
        recipients: {
            type: [recipientSchema],
            default: [],
        },

        // Key-value map: template variable index → field name on recipient
        // e.g. { "1": "name", "2": "orderId" }
        variableMapping: {
            type: Map,
            of: String,
            default: {},
        },

        // ── Scheduling ────────────────────────────────────────────────────────
        scheduledAt: {
            type: Date,
            default: null,
            index: true,
        },

        timezone: {
            type: String,
            default: "UTC",
            trim: true,
        },

        // ── Status lifecycle ──────────────────────────────────────────────────
        // DRAFT      → created, not yet launched
        // SCHEDULED  → has a future scheduledAt, waiting for the scheduler
        // RUNNING    → actively sending messages
        // PAUSED     → manually paused mid-run
        // COMPLETED  → all messages processed
        // FAILED     → fatal error stopped the run
        // CANCELLED  → manually cancelled before completion
        status: {
            type: String,
            enum: [
                "DRAFT",
                "SCHEDULED",
                "RUNNING",
                "PAUSED",
                "COMPLETED",
                "FAILED",
                "CANCELLED",
            ],
            default: "DRAFT",
            index: true,
        },

        // ── Timestamps (in addition to createdAt/updatedAt from timestamps:true) ──
        startedAt: { type: Date, default: null },
        pausedAt: { type: Date, default: null },
        resumedAt: { type: Date, default: null },
        completedAt: { type: Date, default: null },
        cancelledAt: { type: Date, default: null },
        failedAt: { type: Date, default: null },

        // ── Error / Protection Flags ──────────────────────────────────────────
        failureReason: {
            type: String,
            default: null,
        },
        autoPausedByTemplateProtection: {
            type: Boolean,
            default: false,
        },

        // ── Aggregated stats ──────────────────────────────────────────────────
        stats: {
            type: statsSchema,
            default: () => ({}),
        },

        // ── Soft delete ───────────────────────────────────────────────────────
        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true },
    }
);

// ─── COMPOUND INDEXES ─────────────────────────────────────────────────────────
metaWhatsappCampaignSchema.index({ userId: 1, isDeleted: 1, status: 1 });
metaWhatsappCampaignSchema.index({ userId: 1, createdAt: -1 });
metaWhatsappCampaignSchema.index({ scheduledAt: 1, status: 1 });   // for the scheduler query

// ─── VIRTUALS ─────────────────────────────────────────────────────────────────
metaWhatsappCampaignSchema.virtual("progressPercent").get(function () {
    if (!this.stats?.total) return 0;
    return Math.round((this.stats.sent / this.stats.total) * 100);
});

metaWhatsappCampaignSchema.virtual("deliveryRate").get(function () {
    if (!this.stats?.sent) return 0;
    return Math.round((this.stats.delivered / this.stats.sent) * 100);
});

metaWhatsappCampaignSchema.virtual("readRate").get(function () {
    if (!this.stats?.delivered) return 0;
    return Math.round((this.stats.read / this.stats.delivered) * 100);
});

// ─── PRE-SAVE: AUTO-SET startedAt / completedAt ───────────────────────────────
metaWhatsappCampaignSchema.pre("save", function (next) {
    if (this.isModified("status")) {
        const now = new Date();
        if (this.status === "RUNNING" && !this.startedAt) this.startedAt = now;
        if (this.status === "PAUSED" && !this.pausedAt) this.pausedAt = now;
        if (this.status === "COMPLETED" && !this.completedAt) this.completedAt = now;
        if (this.status === "CANCELLED" && !this.cancelledAt) this.cancelledAt = now;
        if (this.status === "FAILED" && !this.failedAt) this.failedAt = now;
    }
    next();
});

// ─── STATICS ─────────────────────────────────────────────────────────────────

// Find campaigns due to run (for the scheduler)
metaWhatsappCampaignSchema.statics.findScheduledDue = function () {
    return this.find({
        status: "SCHEDULED",
        scheduledAt: { $lte: new Date() },
        isDeleted: false,
    });
};

// Soft delete
metaWhatsappCampaignSchema.statics.softDelete = function (id, userId) {
    return this.findOneAndUpdate(
        { _id: id, userId, isDeleted: false },
        { isDeleted: true },
        { new: true }
    );
};

// ─── INSTANCE METHODS ─────────────────────────────────────────────────────────

// Recalculate aggregated stats from the recipients array
metaWhatsappCampaignSchema.methods.recalculateStats = function () {
    const counts = { total: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, skippedUserLimit: 0 };

    for (const r of this.recipients) {
        counts.total++;
        if (r.errorCode || r.errorMessage || r.status === "FAILED") {
            r.status = "FAILED";
            counts.failed++;
        } else if (r.status === "READ") {
            counts.sent++;
            counts.delivered++;
            counts.read++;
        } else if (r.status === "DELIVERED") {
            counts.sent++;
            counts.delivered++;
        } else if (r.status === "SENT") {
            counts.sent++;
        } else if (r.status === "SKIPPED" || r.status === "SKIPPED_USER_LIMIT") {
            counts.skipped++;
            if (r.status === "SKIPPED_USER_LIMIT") counts.skippedUserLimit++;
        }
    }

    this.stats = counts;
};

export default mongoose.model("MetaWhatsappCampaign", metaWhatsappCampaignSchema);