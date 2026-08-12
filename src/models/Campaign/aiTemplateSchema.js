import mongoose from "mongoose";

/**
 * AI Email Template Schema
 * ─────────────────────────
 * Global templates created by admins.
 * Users can browse these and copy ("use") them into their own EmailTemplate collection.
 */
const aiEmailTemplateSchema = new mongoose.Schema(
    {
        /* ── Template content ── */
        name: {
            type: String,
            required: true,
            trim: true,
        },

        subject: {
            type: String,
            required: true,
            trim: true,
        },

        html: {
            type: String,
            required: true,
        },

        design: {
            type: String,
            default: "",
        },

        /* ── AI generation metadata ── */
        prompt: {
            type: String,
            default: "",
            trim: true,
        },

        category: {
            type: String,
            trim: true,
            default: "General",
            enum: [
                "General",
                "Welcome",
                "Newsletter",
                "Promotional",
                "Transactional",
                "Event",
                "Follow-up",
                "Onboarding",
                "Feedback",
                "Other",
            ],
        },

        description: {
            type: String,
            default: "",
            trim: true,
        },

        thumbnailUrl: {
            type: String,
            default: "",
        },

        variables: {
            type: [String],
            default: [],
        },

        tags: {
            type: [String],
            default: [],
        },

        /* ── Usage tracking ── */
        usageCount: {
            type: Number,
            default: 0,
        },

        /* ── Admin / ownership ── */
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        isFeatured: {
            type: Boolean,
            default: false,
        },

        version: {
            type: Number,
            default: 1,
        },
    },
    { timestamps: true }
);

aiEmailTemplateSchema.index({ category: 1, isActive: 1 });
aiEmailTemplateSchema.index({ createdAt: -1 });
aiEmailTemplateSchema.index({ isFeatured: 1 });
aiEmailTemplateSchema.index({ tags: 1 });

export default mongoose.model("AIEmailTemplate", aiEmailTemplateSchema);
