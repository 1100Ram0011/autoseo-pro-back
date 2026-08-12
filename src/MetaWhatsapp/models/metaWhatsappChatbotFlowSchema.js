import mongoose from "mongoose";

const metaWhatsappChatbotFlowSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        phoneNumberId: {
            type: String,
            required: true,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        description: {
            type: String,
            default: ""
        },
        layout: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        }
    },
    { timestamps: true }
);

// Unique index for flow names per user and business number
metaWhatsappChatbotFlowSchema.index({ userId: 1, phoneNumberId: 1, name: 1 }, { unique: true });

export default mongoose.model("MetaWhatsappChatbotFlow", metaWhatsappChatbotFlowSchema);
