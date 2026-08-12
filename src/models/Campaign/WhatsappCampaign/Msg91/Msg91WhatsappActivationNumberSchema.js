import mongoose from "mongoose";

const Msg91WhatsappActivationSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        integrated_number: {
            type: String,
            required: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

Msg91WhatsappActivationSchema.index({ userId: 1, integrated_number: 1 }, { unique: true });

export default mongoose.model("Msg91WhatsappActivation", Msg91WhatsappActivationSchema);