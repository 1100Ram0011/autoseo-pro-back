import mongoose from "mongoose";

const campaignRecipientLogSchema = new mongoose.Schema({
    campaignId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "Campaign", 
        required: true 
    },
    senderUserId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
    },
    
    // Target details
    recipientEmail: { 
        type: String, 
        required: true, 
        lowercase: true,
        trim: true
    },
    recipientName: { type: String },
    companyName: { type: String },
    
    // Status Tracking
    status: {
        type: String,
        enum: [
            "queued",       // Ready to be sent
            "scheduled",    // Scheduled for later due to limit hit
            "dispatching",  // Currently in BullMQ queue / processing
            "sent",         // Successfully dispatched
            "delivered",    // Reached inbox
            "bounced",      // Hard/soft bounce
            "rejected",     // Failed to send via provider
            "unsubscribed", // User previously unsubscribed
            "skipped"       // Skipped
        ],
        default: "queued"
    },
    
    // Sender details
    senderEmail: {
        type: String,
    },
    senderTokenId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "EmailToken",
    },
    
    // Metadata for tracking
    messageId: { type: String }, // Provider message ID for tracking bounces
    errorReason: { type: String }, // Store rejection reasons
    sentAt: { type: Date },        // Timestamp when email dispatch/send occurred
    openedAt: { type: Date },      // For open tracking
    clickedAt: { type: Date },     // For click tracking
    dataFile: { type: mongoose.Schema.Types.Mixed } // Raw Excel row data
}, { timestamps: true });

// Allow tracking history of the same email over multiple campaigns
campaignRecipientLogSchema.index({ campaignId: 1, recipientEmail: 1 });
campaignRecipientLogSchema.index({ senderUserId: 1, recipientEmail: 1 });

export default mongoose.model("CampaignRecipientLog", campaignRecipientLogSchema);
