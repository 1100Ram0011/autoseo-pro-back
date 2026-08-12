import mongoose from "mongoose";

/**
 * WhatsAppApiKey
 * ─────────────────────────────────────────────────────────────
 * One API key per WhatsApp number per user.
 * The raw key is shown ONCE at creation — only a SHA-256 hash is stored.
 *
 * Flow:
 *   1. User generates a key for a connected number
 *   2. Raw key returned once → user copies it
 *   3. All public API calls are authenticated by hashing
 *      the incoming key and matching against `apiKey`
 *
 * Index: { userId + whatsappTokenId + status } → only ONE active key per number
 */
const whatsappApiKeySchema = new mongoose.Schema(
    {
        // ── Owner ─────────────────────────────────────────────
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // ── Linked WhatsApp Number ────────────────────────────
        whatsappTokenId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsAppToken",
            required: true,
            comment: "References the _id from metaWhatsappCampaignTokenSchema",
        },

        // ── Denormalized from WhatsAppToken for fast lookup ───
        phoneNumberId: {
            type: String,
            required: true,
            trim: true,
            comment: "Meta Phone Number ID — denormalized for middleware lookup",
        },
        phoneNumber: {
            type: String,
            trim: true,
            comment: "E.164 display number — denormalized for UI display",
        },

        // ── The Key (hashed) ──────────────────────────────────
        apiKey: {
            type: String,
            required: true,
            unique: true,
            comment: "SHA-256 hash of the raw API key — raw key is NEVER stored",
        },

        // ── The Raw Key (stored for user retrieval and copying) 
        rawKey: {
            type: String,
            comment: "The complete raw API key for user display and copying",
        },

        // ── Masked key representation for UI display ──────────
        displayKey: {
            type: String,
            comment: "Full raw key for UI display",
        },
        keySuffix: {
            type: String,
            comment: "Last 12 chars of the raw key — for UI display",
        },

        // ── Lifecycle ─────────────────────────────────────────
        status: {
            type: String,
            enum: ["active", "revoked"],
            default: "active",
        },

        // ── Expiry ────────────────────────────────────────────
        expiresAt: {
            type: Date,
            default: null,
            comment: "null = never expires; otherwise the exact expiry timestamp",
        },

        // ── Usage Tracking ────────────────────────────────────
        lastUsedAt: {
            type: Date,
            default: null,
            comment: "Updated on every public API call",
        },
        totalRequests: {
            type: Number,
            default: 0,
            comment: "Incremented on every public API call",
        },
    },
    { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

// ── Indexes ───────────────────────────────────────────────────

// Fast hash lookup on every public API request
whatsappApiKeySchema.index({ apiKey: 1 }, { unique: true });

// Enforce one active key per number per user
whatsappApiKeySchema.index(
    { userId: 1, whatsappTokenId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: { status: "active" },
        name: "one_active_key_per_number",
    }
);

// Fast listing: all keys for a user
whatsappApiKeySchema.index({ userId: 1, status: 1 });

// ── Virtuals ──────────────────────────────────────────────────

whatsappApiKeySchema.virtual("isExpired").get(function () {
    if (!this.expiresAt) return false;
    return new Date() > this.expiresAt;
});

// ── Statics ───────────────────────────────────────────────────

/** Find all keys for a user (safe — no raw key) */
whatsappApiKeySchema.statics.findAllByUser = function (userId) {
    return this.find({ userId })
        .select("-apiKey")
        .sort({ status: 1, createdAt: -1 }); // active first, newest first
};

/** Find the active key for a specific number */
whatsappApiKeySchema.statics.findActiveByNumber = function (userId, whatsappTokenId) {
    return this.findOne({ userId, whatsappTokenId, status: "active" }).select("-apiKey");
};

/** Lookup by hashed key — used by auth middleware */
whatsappApiKeySchema.statics.findByHashedKey = function (hashedKey) {
    return this.findOne({ apiKey: hashedKey });
};

export default mongoose.model("WhatsAppApiKey", whatsappApiKeySchema);
