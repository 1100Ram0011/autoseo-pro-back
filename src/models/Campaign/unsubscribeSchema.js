// models/Campaign/EmailCampaign/unsubscribeSchema.js
import mongoose from "mongoose";

const unsubscribeSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        campaignId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Campaign",
        },
        token: {
            type: String,
            required: true,
            unique: true,
        },
        unsubscribedAt: {
            type: Date,
            default: null,
        },
    },
    { timestamps: true }
);

// One unsubscribe per email per sender
unsubscribeSchema.index({ email: 1, userId: 1 }, { unique: true });

export default mongoose.model("Unsubscribe", unsubscribeSchema);