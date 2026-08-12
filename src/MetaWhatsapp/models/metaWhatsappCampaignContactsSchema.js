import mongoose from "mongoose";

const contactSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        phone: { type: String, required: true, trim: true },
        name: { type: String, default: "", trim: true },
        email: { type: String, lowercase: true, trim: true, default: null },
        customFields: { type: Map, of: String, default: {} },
        tags: { type: [String], default: [], index: true },
        optedOut: { type: Boolean, default: false },
        optedOutAt: { type: Date, default: null },
        source: {
            type: String,
            enum: ["manual", "import", "api", "webhook"],
            default: "manual",
        },
        isDeleted: { type: Boolean, default: false },
        deletedAt: { type: Date, default: null },
        isBotActive: { type: Boolean, default: true },
        lastInterventionTime: { type: Date, default: null }
    },
    { timestamps: true }
);

// contactSchema.index({ userId: 1, phone: 1 }, { unique: true, sparse: true });
// contactSchema.index({ userId: 1, tags: 1 });
// contactSchema.index({ userId: 1, optedOut: 1 });

contactSchema.statics.findReachable = function (userId) {
    return this.find({ userId, optedOut: false, isDeleted: false });
};

export default mongoose.model("Contact", contactSchema);