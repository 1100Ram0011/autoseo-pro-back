import mongoose from "mongoose";

const campaignSchema = new mongoose.Schema(
    {
        // Basic Info
        name: {
            type: String,
            required: true,
            trim: true,
        },

        // Campaign Owner (VERY IMPORTANT)
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        // Provider selected by user
        provider: {
            type: String,
            enum: ["google", "microsoft", "custom", "system", "multi"],
            required: true,
            index: true,
        },

        // Proper reference to template collection
        templateId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmailTemplate",
            required: true,
        },

        // Optional sender (if multi-mailbox system)
        senderEmail: {
            type: String,
        },

        campaignMail: {
            type: String,
            lowercase: true,
            trim: true,
        },

        // Excel File Storage
        companyName: {
            type: String,
        },
        companyAddress: {
            type: String,
        },
        excelFileUrl: {
            type: String,
        },

        excelFileKey: {
            type: String,
        },

        // Campaign Metrics
        totalRecipients: {
            type: Number,
            required: true,
            default: 0,
        },

        sentCount: {
            type: Number,
            default: 0,
        },

        failedCount: {
            type: Number,
            default: 0,
        },

        skipCount: {
            type: Number,
            default: 0,
        },

        openedCount: {
            type: Number,
            default: 0,
        },

        clickedCount: {
            type: Number,
            default: 0,
        },

        // Campaign Status Lifecycle
        status: {
            type: String,
            enum: [
                "pending",
                "processing",
                "queued",
                "sending",
                "completed",
                "failed",
                "paused",
                "stopped",
            ],
            default: "pending",
        },

        startedAt: Date,
        completedAt: Date,

        holdReason: {
            type: String,
        },
        resumeAt: Date,

        // Tracks how many times the campaign was rescheduled due to zero daily capacity
        rolloverAttempts: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

// Performance Indexes
campaignSchema.index({ createdAt: -1 });
campaignSchema.index({ userId: 1, provider: 1 });

export default mongoose.model("Campaign", campaignSchema);