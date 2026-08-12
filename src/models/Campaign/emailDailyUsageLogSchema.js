import mongoose from "mongoose";

const emailDailyUsageLogSchema = new mongoose.Schema(
    {
        tokenId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "EmailToken",
            required: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        date: {
            type: String, // format: YYYY-MM-DD
            required: true,
        },
        sentCount: {
            type: Number,
            default: 0,
        },
        failedCount: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

// One usage log per mailbox per day
emailDailyUsageLogSchema.index({ tokenId: 1, date: 1 }, { unique: true });

export default mongoose.model("EmailDailyUsageLog", emailDailyUsageLogSchema);
