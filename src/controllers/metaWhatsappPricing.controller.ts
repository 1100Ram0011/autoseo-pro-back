import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

/**
 * Get all pricing rate cards
 */
export const getAllPricings = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const pricings = await prisma.metaWhatsappPricing.findMany({
            orderBy: { countryName: 'asc' }
        });
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
export const createPricing = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const data = req.body;
        // Parse float values safely
        if (data.marketing) data.marketing = parseFloat(data.marketing);
        if (data.utility) data.utility = parseFloat(data.utility);
        if (data.authentication) data.authentication = parseFloat(data.authentication);
        if (data.service) data.service = parseFloat(data.service);
        if (data.marketingMarkup) data.marketingMarkup = parseFloat(data.marketingMarkup);
        if (data.utilityMarkup) data.utilityMarkup = parseFloat(data.utilityMarkup);
        if (data.authenticationMarkup) data.authenticationMarkup = parseFloat(data.authenticationMarkup);
        if (data.serviceMarkup) data.serviceMarkup = parseFloat(data.serviceMarkup);
        if (data.version) data.version = parseInt(data.version);

        if (data.effectiveFrom) data.effectiveFrom = new Date(data.effectiveFrom);
        if (data.effectiveTo) data.effectiveTo = new Date(data.effectiveTo);

        const pricing = await prisma.metaWhatsappPricing.create({ data });
        logger.info(`[PricingController] Created pricing rate card for ${pricing.countryName} (${pricing.id})`);
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
export const updatePricing = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const data = req.body;
        
        if (data.marketing) data.marketing = parseFloat(data.marketing);
        if (data.utility) data.utility = parseFloat(data.utility);
        if (data.authentication) data.authentication = parseFloat(data.authentication);
        if (data.service) data.service = parseFloat(data.service);
        if (data.marketingMarkup) data.marketingMarkup = parseFloat(data.marketingMarkup);
        if (data.utilityMarkup) data.utilityMarkup = parseFloat(data.utilityMarkup);
        if (data.authenticationMarkup) data.authenticationMarkup = parseFloat(data.authenticationMarkup);
        if (data.serviceMarkup) data.serviceMarkup = parseFloat(data.serviceMarkup);
        if (data.version) data.version = parseInt(data.version);

        if (data.effectiveFrom) data.effectiveFrom = new Date(data.effectiveFrom);
        if (data.effectiveTo) data.effectiveTo = new Date(data.effectiveTo);

        const existing = await prisma.metaWhatsappPricing.findUnique({
            where: { id: req.params.id as string }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: "Pricing card not found" });
        }

        const pricing = await prisma.metaWhatsappPricing.update({
            where: { id: req.params.id as string },
            data
        });
        
        logger.info(`[PricingController] Updated pricing rate card for ${pricing.countryName} (${pricing.id})`);
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
export const deletePricing = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const existing = await prisma.metaWhatsappPricing.findUnique({
            where: { id: req.params.id as string }
        });

        if (!existing) {
            return res.status(404).json({ success: false, message: "Pricing card not found" });
        }

        await prisma.metaWhatsappPricing.delete({
            where: { id: req.params.id as string }
        });
        
        logger.info(`[PricingController] Deleted pricing rate card for ${existing.countryName} (${existing.id})`);
        return res.json({
            success: true,
            message: "Pricing card deleted successfully"
        });
    } catch (err) {
        next(err);
    }
};
