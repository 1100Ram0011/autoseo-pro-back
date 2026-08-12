import mongoose from "mongoose";

const interactiveButtonSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, trim: true },
        title: { type: String, required: true, trim: true, maxlength: 20 }
    },
    { _id: false }
);

const interactiveListRowSchema = new mongoose.Schema(
    {
        id: { type: String, required: true, trim: true },
        title: { type: String, required: true, trim: true, maxlength: 24 },
        description: { type: String, trim: true, maxlength: 72, default: "" }
    },
    { _id: false }
);

const interactiveListSectionSchema = new mongoose.Schema(
    {
        title: { type: String, trim: true, maxlength: 24, default: "" },
        rows: {
            type: [interactiveListRowSchema],
            validate: [arr => arr.length > 0, 'Section must contain at least 1 item']
        }
    },
    { _id: false }
);

const metaWhatsappInteractiveSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },
        numberId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "WhatsAppToken",
            required: true,
            index: true
        },
        name: {
            type: String,
            required: [true, "Interactive layout name is required"],
            trim: true,
            maxlength: 100
        },
        type: {
            type: String,
            enum: ["button", "list"],
            required: true
        },
        headerType: {
            type: String,
            enum: ["text", "document", "image", "video"],
            default: "text"
        },
        headerText: {
            type: String,
            trim: true,
            maxlength: 60,
            default: ""
        },
        mediaUrl: {
            type: String,
            trim: true,
            default: ""
        },
        mediaFilename: {
            type: String,
            trim: true,
            default: ""
        },
        bodyText: {
            type: String,
            required: [true, "Body message is required"],
            trim: true,
            maxlength: 1024
        },
        footerText: {
            type: String,
            trim: true,
            maxlength: 60,
            default: ""
        },
        
        // Fields for "button" (Quick Reply)
        buttons: {
            type: [interactiveButtonSchema],
            validate: {
                validator: function(v) {
                    if (this.type !== "button") return true;
                    return v.length >= 1 && v.length <= 3;
                },
                message: "Quick Reply buttons must be between 1 and 3 options"
            }
        },

        // Fields for "list" (List Menu)
        listButtonText: {
            type: String,
            maxlength: 20,
            validate: {
                validator: function(v) {
                    if (this.type !== "list") return true;
                    return !!v && v.trim().length > 0;
                },
                message: "List menu button label is required"
            }
        },
        sections: {
            type: [interactiveListSectionSchema],
            validate: {
                validator: function(v) {
                    if (this.type !== "list") return true;
                    const totalRows = v.reduce((sum, sec) => sum + (sec.rows?.length || 0), 0);
                    return totalRows >= 1 && totalRows <= 10;
                },
                message: "List menu must contain between 1 and 10 rows in total"
            }
        }
    },
    { timestamps: true }
);

// Compound index
metaWhatsappInteractiveSchema.index({ userId: 1, numberId: 1 });

export default mongoose.model("MetaWhatsappInteractive", metaWhatsappInteractiveSchema);
