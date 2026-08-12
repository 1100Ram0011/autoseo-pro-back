import mongoose from "mongoose";

const metaWhatsappPricingSchema = new mongoose.Schema(
    {
        countryCode: {
            type: String,
            required: true,
            trim: true,
            comment: "E.g., IN, US, GB"
        },
        countryName: {
            type: String,
            required: true,
            trim: true
        },
        countryPrefix: {
            type: String,
            required: true,
            trim: true,
            comment: "E.g. 91, 1, 44"
        },
        currency: {
            type: String,
            default: "INR",
            trim: true
        },
        marketing: {
            type: Number,
            required: true,
            default: 0
        },
        utility: {
            type: Number,
            required: true,
            default: 0
        },
        authentication: {
            type: Number,
            required: true,
            default: 0
        },
        service: {
            type: Number,
            required: true,
            default: 0
        },
        marketingMarkup: {
            type: Number,
            required: true,
            default: 0.10
        },
        utilityMarkup: {
            type: Number,
            required: true,
            default: 0.10
        },
        authenticationMarkup: {
            type: Number,
            required: true,
            default: 0.10
        },
        serviceMarkup: {
            type: Number,
            required: true,
            default: 0.10
        },
        effectiveFrom: {
            type: Date,
            default: Date.now
        },
        effectiveTo: {
            type: Date,
            default: null
        },
        version: {
            type: Number,
            default: 1
        }
    },
    {
        timestamps: true
    }
);

// Indexes
metaWhatsappPricingSchema.index({ countryPrefix: 1, effectiveFrom: -1 });
metaWhatsappPricingSchema.index({ countryCode: 1, effectiveFrom: -1 });

const MetaWhatsappPricing = mongoose.model("MetaWhatsappPricing", metaWhatsappPricingSchema);
export default MetaWhatsappPricing;
