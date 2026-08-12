import MetaWhatsappPricing from "../models/metaWhatsappPricingSchema.js";
import logger from "../../config/logger.js";

/**
 * Get all pricing rate cards
 */
export const getAllPricings = async (req, res, next) => {
    try {
        const pricings = await MetaWhatsappPricing.find().sort({ countryName: 1 });
        return res.json({
            success: true,
            data: pricings
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Create a new pricing rate card
 */
export const createPricing = async (req, res, next) => {
    try {
        const pricing = await MetaWhatsappPricing.create(req.body);
        logger.info(`[PricingController] Created pricing rate card for ${pricing.countryName} (${pricing._id})`);
        return res.status(201).json({
            success: true,
            data: pricing
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Update an existing pricing rate card
 */
export const updatePricing = async (req, res, next) => {
    try {
        const pricing = await MetaWhatsappPricing.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!pricing) {
            return res.status(404).json({
                success: false,
                message: "Pricing card not found"
            });
        }
        logger.info(`[PricingController] Updated pricing rate card for ${pricing.countryName} (${pricing._id})`);
        return res.json({
            success: true,
            data: pricing
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Delete a pricing rate card
 */
export const deletePricing = async (req, res, next) => {
    try {
        const pricing = await MetaWhatsappPricing.findByIdAndDelete(req.params.id);
        if (!pricing) {
            return res.status(404).json({
                success: false,
                message: "Pricing card not found"
            });
        }
        logger.info(`[PricingController] Deleted pricing rate card for ${pricing.countryName} (${pricing._id})`);
        return res.json({
            success: true,
            message: "Pricing card deleted successfully"
        });
    } catch (err) {
        next(err);
    }
};
