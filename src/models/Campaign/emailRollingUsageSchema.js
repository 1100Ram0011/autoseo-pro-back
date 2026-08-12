import mongoose from "mongoose";

const emailRollingUsageSchema = new mongoose.Schema(
  {
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EmailToken",
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    count: {
      type: Number,
      default: 1,
    },
    restored: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Index to quickly find expired and non-restored usages
emailRollingUsageSchema.index({ expiresAt: 1, restored: 1 });
// Index to quickly group by tokenId
emailRollingUsageSchema.index({ tokenId: 1, restored: 1 });

export default mongoose.model("EmailRollingUsage", emailRollingUsageSchema);
