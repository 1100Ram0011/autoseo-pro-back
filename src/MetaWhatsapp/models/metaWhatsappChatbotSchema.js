import mongoose from "mongoose";

const metaWhatsappChatbotSchema = new mongoose.Schema(
    {
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
        triggerType: {
            type: String,
            enum: ["keyword", "button_payload", "api_response", "condition_branch", "next_step"],
            required: true,
            default: "keyword"
        },
        triggerValue: {
            type: String,
            required: true,
            trim: true
        },
        replyType: {
            type: String,
            enum: ["text", "interactive", "meta_template", "api_request", "set_attribute", "add_tag", "intervention", "condition"],
            required: true,
            default: "text"
        },
        replyText: {
            type: String,
            trim: true,
            maxlength: 1024,
            default: ""
        },
        replyInteractiveId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MetaWhatsappInteractive",
            default: null
        },
        templateName: {
            type: String,
            trim: true,
            default: ""
        },
        templateLanguage: {
            type: String,
            trim: true,
            default: "en"
        },
        templateParams: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        flowId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "MetaWhatsappChatbotFlow",
            default: null,
            index: true
        },
        apiUrl: {
            type: String,
            trim: true,
            default: ""
        },
        apiBody: {
            type: String,
            trim: true,
            default: ""
        },
        apiMethod: {
            type: String,
            trim: true,
            default: "POST"
        },
        apiHeaders: {
            type: mongoose.Schema.Types.Mixed,
            default: []
        },
        apiParams: {
            type: mongoose.Schema.Types.Mixed,
            default: []
        },
        responseAttributes: {
            type: mongoose.Schema.Types.Mixed,
            default: []
        },
        attributeName: {
            type: String,
            trim: true,
            default: ""
        },
        attributeValue: {
            type: String,
            trim: true,
            default: ""
        },
        tagName: {
            type: String,
            trim: true,
            default: ""
        },
        conditionAttribute: {
            type: String,
            trim: true,
            default: ""
        },
        conditionOperator: {
            type: String,
            enum: ["equals", "not_equals", "contains", "greater_than", "less_than", "exists", ""],
            default: ""
        },
        conditionValue: {
            type: String,
            trim: true,
            default: ""
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    { timestamps: true }
);

// Compound unique index per business number and flow so duplicate trigger keywords/payloads cannot be set
metaWhatsappChatbotSchema.index({ phoneNumberId: 1, flowId: 1, triggerValue: 1 }, { unique: true });

export default mongoose.model("MetaWhatsappChatbot", metaWhatsappChatbotSchema);
