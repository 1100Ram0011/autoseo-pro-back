import mongoose from "mongoose";

const emailTokenSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        provider: {
            type: String,
            enum: ["google", "microsoft", "custom"],
            required: true,
        },
        accountType: {
            type: String,
            enum: ["free", "workplace"],
            default: "free",
        },
        tier: {
            type: String,
            enum: [
                "gmail_free", "google_workspace", "google_unknown",
                "outlook_free", "m365_basic", "m365_business", "microsoft_unknown",
                "custom_smtp", "unknown",
            ],
            default: "unknown",
        },
        limitConfidence: {
            type: String,
            enum: ["high", "medium", "low"],
            default: "low",
        },
        limitSource: {
            type: String,
            enum: ["profile_detection", "mailtips_probe", "discovered_429", "manual_override"],
            default: "profile_detection",
        },
        email: {
            type: String,
            // required: true,
        },
        accessToken: {
            type: String,
            // required: true,
        },
        refreshToken: {
            type: String,
            // required: true,
        },
        appPassword: {
            type: String,
        },
        expiresAt: {
            type: Date,
            // required: true,
        },
        scope: {
            type: String,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        status: {
            type: String,
            enum: ["active", "expired", "revoked", "error", "disconnected"],
            default: "active",
        },
        dailyLimit: {
            type: Number,
            default: 500,
        },
        lifetimeSent: {
            type: Number,
            default: 0,
        },
        lifetimeFailed: {
            type: Number,
            default: 0,
        },
        lastUsedAt: {
            type: Date,
            default: Date.now,
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
    },
    { timestamps: true }
);

// One token record per user per provider per email
emailTokenSchema.index({ userId: 1, provider: 1, email: 1 }, { unique: true });

export default mongoose.model("EmailToken", emailTokenSchema);