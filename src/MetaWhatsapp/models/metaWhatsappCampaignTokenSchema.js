import mongoose from "mongoose";

/**
 * WhatsAppToken
 * ─────────────────────────────────────────────────────────────
 * One user → MANY WhatsApp numbers.
 * Each document = one connected WA number belonging to a user.
 *
 * Example:
 *   User "Alice" can connect:
 *     → +1 555 1479354  (Sales number)
 *     → +1 555 9876543  (Support number)
 *     → +91 98765 43210 (India number)
 *
 * Index: { userId + phoneNumberId } = unique
 *   → Same number cannot be added twice by the same user
 *   → Same number CANNOT be claimed by two different users
 */
const whatsappTokenSchema = new mongoose.Schema(
    {
        // ── Owner ─────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── Number label (user-defined) ───────────────────────
        label: {
            type: String,
            trim: true,
            default: "",
            comment: "User-defined nickname e.g. 'Sales', 'Support', 'India Office'",
        },
        isPrimary: {
            type: Boolean,
            default: false,
            comment: "User's default sending number — only one true per user",
        },

        // ── Meta Identifiers ──────────────────────────────────
        phoneNumberId: {
            type: String,
            required: true,
            trim: true,
            comment: "Meta Phone Number ID e.g. 992879557248187",
        },
        wabaId: {
            type: String,
            required: true,
            trim: true,
            comment: "Meta WABA ID e.g. 1645069746649369",
        },

        // ── Display Info ──────────────────────────────────────
        displayName: { type: String, trim: true },
        phoneNumber: {
            type: String,
            trim: true,
            comment: "E.164 format e.g. +15551479354",
        },

        // ── Credentials ───────────────────────────────────────
        accessToken: {
            type: String,
            required: true,
            select: false,  // never returned unless explicitly requested
        },
        appId: { type: String },
        appSecret: { type: String, select: false },

        // ── Token lifecycle ───────────────────────────────────
        expiresAt: {
            type: Date,
            default: null,
            comment: "null = permanent system user token",
        },
        tokenType: {
            type: String,
            enum: ["temporary", "permanent"],
            default: "permanent",
        },

        // ── Webhook ───────────────────────────────────────────
        webhookVerifyToken: { type: String, select: false, default: null },

        // ── Meta Quality (per number) ─────────────────────────
        status: {
            type: String,
            enum: ["active", "pending", "disconnected", "paused", "banned", "expired"],
            default: "active",
        },
        qualityRating: {
            type: String,
            enum: ["GREEN", "YELLOW", "RED", "UNKNOWN"],
            default: "UNKNOWN",
        },
        messagingLimit: {
            type: String,
            // enum: ["TIER_50", "TIER_250", "TIER_1K", "TIER_10K", "TIER_100K", "UNLIMITED"],
            default: "TIER_1K",
        },

        // ── Scope ─────────────────────────────────────────────
        scope: {
            type: String,
            comment: "e.g. whatsapp_business_messaging,whatsapp_business_management",
        },

        // ── Conversational Automation (Ice Breakers & Commands) ──
        conversationalAutomation: {
            enable_welcome_message: { type: Boolean, default: true },
            prompts: {
                type: [String],
                default: [],
                validate: [arr => arr.length <= 4, '{PATH} exceeds the limit of 4 prompts']
            },
            commands: [
                {
                    command_name: { type: String, trim: true, lowercase: true },
                    command_description: { type: String, trim: true }
                }
            ]
        },

        // ── Business Profile ──────────────────────────────────
        businessProfile: {
            about: { type: String, maxlength: 139, default: "" },
            address: { type: String, maxlength: 256, default: "" },
            description: { type: String, maxlength: 512, default: "" },
            email: { type: String, default: "" },
            profile_picture_url: { type: String, default: "" },
            websites: { type: [String], default: [], validate: [arr => arr.length <= 2, 'Max 2 websites'] },
            vertical: { type: String, default: "" },
            lastSyncedAt: { type: Date, default: null },
        },

        // ── Number Settings ───────────────────────────────────
        retryConfig: {
            enabled: { type: Boolean, default: false },
            maxRetries: { type: Number, default: 3, min: 1, max: 5 },
            retryWindowHours: { type: Number, default: 24 }
        },
        autoTemplateDisable: {
            enabled: { type: Boolean, default: false },
            thresholdRating: { type: String, enum: ['YELLOW', 'RED'], default: 'RED' }
        },
        callSettings: {
            status: { type: String, enum: ['ENABLED', 'DISABLED'], default: 'DISABLED' },
            callIconVisibility: { type: String, enum: ['DEFAULT', 'DISABLE_ALL'], default: 'DISABLE_ALL' }
        },
        previewUrlEnabled: {
            type: Boolean,
            default: true
        },
        mmLite: {
            eligible: { type: Boolean, default: false },
            tosAccepted: { type: Boolean, default: false }
        },

        // ── Timestamps ────────────────────────────────────────
        connectedAt: { type: Date, default: Date.now },
        lastUsedAt: { type: Date, default: null },
        disconnectedAt: { type: Date, default: null },
    },
    { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ── Indexes ───────────────────────────────────────────────────

// One user cannot add the SAME number twice
whatsappTokenSchema.index({ userId: 1, phoneNumberId: 1 }, { unique: true });

// Fast lookup: all numbers for a user
whatsappTokenSchema.index({ userId: 1, status: 1 });
whatsappTokenSchema.index({ userId: 1, isPrimary: 1 });

// Prevent two different users claiming the same phone number
whatsappTokenSchema.index({ phoneNumberId: 1 }, { unique: true });

// ── Virtuals ──────────────────────────────────────────────────
whatsappTokenSchema.virtual("isExpired").get(function () {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
});

whatsappTokenSchema.virtual("isConnected").get(function () {
    return this.status === "active" && !this.isExpired;
});

// ── Hooks ─────────────────────────────────────────────────────

/**
 * When a number is set as primary, unset all other numbers
 * of the same user first — only ONE primary allowed per user.
 */
whatsappTokenSchema.pre("save", async function (next) {
    if (this.isModified("isPrimary") && this.isPrimary === true) {
        await this.constructor.updateMany(
            { userId: this.userId, _id: { $ne: this._id } },
            { $set: { isPrimary: false } }
        );
    }
    next();
});

// ── Statics ───────────────────────────────────────────────────

/** All numbers for a user (safe — no credentials) */
whatsappTokenSchema.statics.findAllByUser = function (userId) {
    return this.find({ userId })
        .select("-accessToken -appSecret -webhookVerifyToken")
        .sort({ isPrimary: -1, connectedAt: 1 }); // primary first
};

/** All ACTIVE numbers only */
whatsappTokenSchema.statics.findActiveByUser = function (userId) {
    return this.find({ userId, status: "active" })
        .select("-accessToken -appSecret -webhookVerifyToken")
        .sort({ isPrimary: -1, connectedAt: 1 });
};

/** Get user's primary/default number */
whatsappTokenSchema.statics.findPrimaryByUser = function (userId) {
    return this.findOne({ userId, isPrimary: true, status: "active" });
};

/** Get full credentials for a number — INTERNAL USE ONLY */
whatsappTokenSchema.statics.findCredentials = function (userId, phoneNumberId) {
    return this.findOne({ userId, phoneNumberId })
        .select("+accessToken +appSecret +webhookVerifyToken");
};

/** Count how many numbers a user has connected */
whatsappTokenSchema.statics.countByUser = function (userId) {
    return this.countDocuments({ userId, status: { $ne: "disconnected" } });
};

export default mongoose.model("WhatsAppToken", whatsappTokenSchema);