import mongoose from "mongoose";

const Msg91WhatsappNumberEntrySchema = new mongoose.Schema(
    {
        number: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED"],
            default: "PENDING"
        },
        rejectionReason: {
            type: String,
            default: null
        },
        activatedAt: {
            type: Date,
            default: null
        }
    },
    { _id: false }
);

const Msg91WhatsappOnboardingSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        // ── Numbers ───────────────────────────────────────────────────────────
        whatsappNumbers: {
            type: [Msg91WhatsappNumberEntrySchema],
            required: true,
            validate: {
                validator: (arr) => arr.length > 0,
                message: "At least one whatsapp number is required"
            }
        },

        // ── Business Info ─────────────────────────────────────────────────────
        businessName: {
            type: String,
            trim: true,
            default: null,
        },
        businessEmail: {
            type: String,
            required: true,
            trim: true
        },
        facebookPageId: {
            type: String,
            trim: true,
            default: null
        },
        facebookPageName: {
            type: String,
            trim: true,
            default: null
        },

        // ── Step 2: FB Admin ──────────────────────────────────────────────────
        fbAdminConfirmed: {
            type: Boolean,
            default: false
        },
        fbAdminConfirmedAt: {
            type: Date,
            default: null
        },

        // ── Status ────────────────────────────────────────────────────────────
        connectionStatus: {
            type: String,
            enum: [
                "PENDING",
                "FB_CONFIRMED",
                "SUBMITTED",
                "APPROVED",
                "REJECTED",
                "CANCELLED"
            ],
            default: "PENDING"
        },

        submittedAt: {
            type: Date,
            default: null
        },

        // ── Admin ─────────────────────────────────────────────────────────────
        reviewedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        reviewedAt: {
            type: Date,
            default: null
        },
        rejectionReason: {
            type: String,
            default: null
        },

        // ── Notes ─────────────────────────────────────────────────────────────
        userNotes: {
            type: String,
            default: null
        },
        adminNotes: {
            type: String,
            default: null
        },



        businessPhone: {
            type: String,
            trim: true,
            default: null
        },
        businessIndustry: {
            type: String,
            trim: true,
            default: null
        },
        userName: {
            type: String,   // MSG91 login username for the sub-account
            trim: true,
            default: null
        },
        userFullName: {
            type: String,
            trim: true,
            default: null
        },

        // MSG91 response tracking
        msg91Response: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },
        msg91Error: {
            type: String,
            default: null
        },
        msg91ClientId: {
            type: String,   // MSG91 returns a client ID after add_client
            default: null
        },


        connectionType: {
            type: String,
            enum: ['msg91', 'facebook'],
            required: true,
            default: 'facebook'
        },

    },
    { timestamps: true }
);

Msg91WhatsappOnboardingSchema.index({ userId: 1, connectionStatus: 1 });
Msg91WhatsappOnboardingSchema.index({ connectionStatus: 1 });
Msg91WhatsappOnboardingSchema.index({ "whatsappNumbers.number": 1 });

export default mongoose.model("Msg91WhatsappOnboarding", Msg91WhatsappOnboardingSchema);