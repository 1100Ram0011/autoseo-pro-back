import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
    {
        url: {
            type: String,
            required: true,
        },
        key: {
            type: String,
        },
        originalName: {
            type: String,
            required: true,
        },
        contentType: String,
        size: Number,
    },
    { _id: false }
);

const templateSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            index: true,
        },
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

        variables: {
            type: [String],
            default: [],
            index: true,
        },

        attachments: {
            type: [attachmentSchema],
            default: [],
            validate: [arr => arr.length <= 5, "Maximum 5 attachments allowed"],
        },

        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            index: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        version: {
            type: Number,
            default: 1,
        },

        design: {
            type: String,
            default: null,
        },

        /* ── AI template traceability ── */
        sourceAITemplate: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "AIEmailTemplate",
            default: null,
        },

        sourcePrompt: {
            type: String,
            default: "",
            trim: true,
        },

        isAIGenerated: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true }
);

templateSchema.index({ userId: 1, isActive: 1 });
templateSchema.index({ createdAt: -1 });
templateSchema.index({ userId: 1, name: 1, isActive: 1 });

export default mongoose.model("EmailTemplate", templateSchema);
