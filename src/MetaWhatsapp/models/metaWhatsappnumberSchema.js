import mongoose from "mongoose";

/**
 * WhatsAppNumber  (WA Number)
 * ─────────────────────────────────────────────────────────────
 * Represents a Meta-connected phone number owned by a Tenant.
 * Multiple users in the same tenant share the same numbers.
 *
 * Relationships:
 *   WhatsAppNumber ──(tenantId)──▶ Tenant
 *   WhatsAppNumber ──(addedBy)───▶ User       (who connected it)
 *   WhatsAppNumber ◀──────────── Template     (optional per-number)
 *   WhatsAppNumber ◀──────────── Campaign
 *   WhatsAppNumber ◀──────────── Message
 */
const waNumberSchema = new mongoose.Schema(
    {
        // ── Tenant ownership ──────────────────────────────────
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Tenant",
            required: true,
            index: true,
        },

        /** User who connected / added this number */
        addedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
        },

        // ── Display ───────────────────────────────────────────
        displayName: {
            type: String,
            required: true,
            trim: true,
        },
        phoneNumber: {
            type: String,
            required: true,
            trim: true,
            comment: "E.164 format e.g. +15551479354",
        },

        // ── Meta Identifiers (from dashboard screenshot) ──────
        phoneNumberId: {
            type: String,
            required: true,
            unique: true,
            comment: "Meta Phone Number ID e.g. 992879557248187",
        },
        wabaId: {
            type: String,
            required: true,
            comment: "Meta WABA ID e.g. 1645069746649369",
        },
        accessToken: {
            type: String,
            select: false,
            default: null,
        },

        // ── Quality & Status (as shown in UI) ─────────────────
        status: {
            type: String,
            enum: ["active", "pending", "banned", "paused", "disconnected"],
            default: "active",
        },
        qualityRating: {
            type: String,
            enum: ["GREEN", "YELLOW", "RED", "UNKNOWN"],
            default: "UNKNOWN",
        },
        messagingLimit: {
            type: String,
            enum: ["TIER_50", "TIER_250", "TIER_1K", "TIER_10K", "TIER_100K", "UNLIMITED"],
            default: "TIER_1K",
            comment: "250/day shown in UI maps to TIER_250",
        },

        // ── Business Profile ──────────────────────────────────
        verifiedName: { type: String },
        businessDescription: { type: String },
        address: { type: String },
        businessEmail: { type: String },
        websiteUrl: { type: String },
        profilePicUrl: { type: String },

        // ── Usage ─────────────────────────────────────────────
        dailySentCount: {
            type: Number,
            default: 0,
            comment: "Reset daily via cron",
        },

        // ── Webhook ───────────────────────────────────────────
        webhookVerifyToken: { type: String, select: false },

        // ── Feature 1: Retry ──────────────────────────────────────────
        retryConfig: {
            enabled: { type: Boolean, default: true },
            maxRetries: { type: Number, default: 3, min: 1, max: 5 },
            retryWindowHours: { type: Number, default: 24 },
            quietHoursStart: { type: String, default: "22:00" },
            quietHoursEnd: { type: String, default: "07:00" },
        },

        // ── Feature 2: Auto Template Disable ──────────────────────────
        autoTemplateDisable: {
            enabled: { type: Boolean, default: true },
            stopOnReclassify: { type: Boolean, default: true },
            notifyOnPause: { type: Boolean, default: true },
            notifyEmail: { type: String, default: null },
        },

        // ── Feature 3: Call Settings ──────────────────────────────────
        callSettings: {
            status: { type: String, enum: ["ENABLED", "DISABLED"], default: "DISABLED" },
            callIconVisibility: { type: String, enum: ["DEFAULT", "DISABLE_ALL"], default: "DISABLE_ALL" },
            timezone: { type: String, default: "Asia/Kolkata" },
            weeklySchedule: { type: mongoose.Schema.Types.Mixed, default: {} },
            holidays: [{ date: String, name: String }],
            sipEnabled: { type: Boolean, default: false },
            lastSyncedAt: { type: Date, default: null },
        },

        // ── Feature 4: Preview URL ────────────────────────────────────
        previewUrlEnabled: { type: Boolean, default: true },

        // ── Feature 5: MM Lite ────────────────────────────────────────
        mmLite: {
            eligible: { type: Boolean, default: false },
            tosAccepted: { type: Boolean, default: false },
            tosAcceptedAt: { type: Date, default: null },
            lastCheckedAt: { type: Date, default: null },
        },

        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// ── Indexes ───────────────────────────────────────────────────
waNumberSchema.index({ tenantId: 1, status: 1 });
waNumberSchema.index({ phoneNumberId: 1 }, { unique: true });
waNumberSchema.index({ wabaId: 1 });

// ── Statics ───────────────────────────────────────────────────
waNumberSchema.statics.findActiveByTenant = function (tenantId) {
    return this.find({ tenantId, status: "active", isDeleted: false });
};

export default mongoose.model("WhatsAppNumber", waNumberSchema);