import mongoose from "mongoose";
import logger from "../../config/logger.js";
import MetaWhatsappPricing from "../models/metaWhatsappPricingSchema.js";

/**
 * Resolve message price based on recipient phone number and message category
 */
export const resolveMessagePrice = async (phoneNumber, category, billable = true) => {
    if (!billable) return { price: 0, currency: "INR" };
    if (!phoneNumber) return { price: 0, currency: "INR" };

    // Clean phone number (leave digits only)
    const cleanNum = String(phoneNumber).replace(/\D/g, "");

    try {
        // Find all active rates
        const pricings = await MetaWhatsappPricing.find({ effectiveTo: null });

        if (!pricings || pricings.length === 0) {
            // If DB pricing table is empty, return default India rates as fallback
            return getDefaultRates(cleanNum, category);
        }

        // Sort by prefix length descending to match longest prefix first (e.g. 91 before 9)
        pricings.sort((a, b) => b.countryPrefix.length - a.countryPrefix.length);

        let matched = null;
        for (const p of pricings) {
            if (cleanNum.startsWith(p.countryPrefix)) {
                matched = p;
                break;
            }
        }

        // If no match found, fallback to Indian pricing as the global baseline
        if (!matched) {
            matched = pricings.find(p => p.countryCode === "IN") || pricings[0];
        }

        const cat = String(category || "").toLowerCase();
        let price = 0;
        let markup = 0;

        if (cat === "marketing") {
            price = matched.marketing;
            markup = matched.marketingMarkup !== undefined ? matched.marketingMarkup : (matched.currency === "INR" ? 0.10 : 0);
        } else if (cat === "utility") {
            price = matched.utility;
            markup = matched.utilityMarkup !== undefined ? matched.utilityMarkup : (matched.currency === "INR" ? 0.10 : 0);
        } else if (cat === "authentication") {
            price = matched.authentication;
            markup = matched.authenticationMarkup !== undefined ? matched.authenticationMarkup : (matched.currency === "INR" ? 0.10 : 0);
        } else if (cat === "service") {
            price = matched.service;
            markup = matched.serviceMarkup !== undefined ? matched.serviceMarkup : (matched.currency === "INR" ? 0.10 : 0);
        } else {
            price = matched.marketing;
            markup = matched.marketingMarkup !== undefined ? matched.marketingMarkup : (matched.currency === "INR" ? 0.10 : 0);
        }

        price += markup;

        return {
            price,
            currency: matched.currency || "INR"
        };
    } catch (err) {
        logger.error(`[PricingService] Price lookup failed, using defaults: ${err.message}`);
        return getDefaultRates(cleanNum, category);
    }
};

/**
 * Fallback hardcoded defaults if DB pricing is empty or lookup fails
 */
function getDefaultRates(cleanNum, category) {
    const isIndia = cleanNum.startsWith("91");
    const cat = String(category || "").toLowerCase();

    if (isIndia) {
        // Includes 0.10 Rs markup (10 paise)
        if (cat === "marketing") return { price: 0.8631 + 0.10, currency: "INR" };
        if (cat === "utility") return { price: 0.1150 + 0.10, currency: "INR" };
        if (cat === "authentication") return { price: 0.1150 + 0.10, currency: "INR" };
        return { price: 0.10, currency: "INR" };
    } else {
        // US/Fallback Default (USD cents)
        if (cat === "marketing") return { price: 0.015, currency: "USD" };
        if (cat === "utility") return { price: 0.010, currency: "USD" };
        if (cat === "authentication") return { price: 0.0135, currency: "USD" };
        return { price: 0, currency: "USD" };
    }
}

/**
 * Seed default Meta Pricing rate card if empty
 */
export const seedMetaPricing = async (req, res) => {
    try {
        const count = await MetaWhatsappPricing.countDocuments();
        if (count > 0) {
            // Migrate existing records: set default category markups to 0.10 for INR and 0.00 for other currencies if undefined
            await MetaWhatsappPricing.updateMany(
                { currency: "INR", marketingMarkup: { $exists: false } },
                { $set: { marketingMarkup: 0.10, utilityMarkup: 0.10, authenticationMarkup: 0.10, serviceMarkup: 0.10 } }
            );
            await MetaWhatsappPricing.updateMany(
                { currency: { $ne: "INR" }, marketingMarkup: { $exists: false } },
                { $set: { marketingMarkup: 0.00, utilityMarkup: 0.00, authenticationMarkup: 0.00, serviceMarkup: 0.00 } }
            );

            // Clean up old single markup field if exists
            await MetaWhatsappPricing.updateMany(
                {},
                { $unset: { markup: "" } }
            );

            if (res && typeof res.json === "function") {
                return res.json({
                    message: "Default rates already seeded and updated with category markups"
                });
            }
            return;
        }

        logger.info("[PricingService] Seeding default Meta Whatsapp rates...");
        const defaultRates = [
            {
                countryCode: "IN",
                countryName: "India",
                countryPrefix: "91",
                currency: "INR",
                marketing: 0.8631,
                utility: 0.1150,
                authentication: 0.1150,
                service: 0,
                marketingMarkup: 0.10,
                utilityMarkup: 0.10,
                authenticationMarkup: 0.10,
                serviceMarkup: 0.10,
                version: 1
            },
            {
                countryCode: "US",
                countryName: "United States",
                countryPrefix: "1",
                currency: "USD",
                marketing: 0.015,
                utility: 0.010,
                authentication: 0.0135,
                service: 0.008,
                marketingMarkup: 0.00,
                utilityMarkup: 0.00,
                authenticationMarkup: 0.00,
                serviceMarkup: 0.00,
                version: 1
            },
            {
                countryCode: "GB",
                countryName: "United Kingdom",
                countryPrefix: "44",
                currency: "GBP",
                marketing: 0.038,
                utility: 0.015,
                authentication: 0.022,
                service: 0.012,
                marketingMarkup: 0.00,
                utilityMarkup: 0.00,
                authenticationMarkup: 0.00,
                serviceMarkup: 0.00,
                version: 1
            }
        ];

        await MetaWhatsappPricing.insertMany(defaultRates);
        logger.info("[PricingService] Successfully seeded default rates card.");
    } catch (err) {
        logger.error(`[PricingService] Failed to seed rates card: ${err.message}`);
    }
};

/**
 * Convert a given price and currency into platform credits (1 credit = 1 paisa)
 */
export const convertPriceToCredits = async (price, currency) => {
    let priceInINR = price;
    const currencyUpper = String(currency || "INR").toUpperCase();
    if (currencyUpper === "USD") {
        let conversionRate = 83.5;
        try {
            // Dynamically load ExchangeRate model using mongoose to avoid circular import issues
            const ExchangeRate = mongoose.model("ExchangeRate");
            const exchangeRateDoc = await ExchangeRate.findOne().sort({ createdAt: -1 });
            if (exchangeRateDoc && exchangeRateDoc.conversion_rate) {
                conversionRate = exchangeRateDoc.conversion_rate;
            }
        } catch (err) {
            logger.warn(`[PricingService] Failed to load USD to INR exchange rate: ${err.message}`);
        }
        priceInINR = price * conversionRate;
    } else if (currencyUpper === "GBP") {
        let conversionRate = 108.0;
        try {
            const ExchangeRate = mongoose.model("ExchangeRate");
            // If they have standard conversion rate in DB, we can try to find GBP. Otherwise fallback to 108.
        } catch (err) {
            logger.warn(`[PricingService] Failed to load GBP to INR exchange rate: ${err.message}`);
        }
        priceInINR = price * conversionRate;
    }
    
    return Number((priceInINR).toFixed(4));
};

/**
 * Aggregate active non-expired credit balances for a given user
 */
export const getUserAvailableCredits = async (userId) => {
    if (!userId) return 0;
    try {
        const CreditBalanceModel = mongoose.models.CreditBalance || (await import("../../models/credits/index.js")).CreditBalance;
        const eligibleWallets = await CreditBalanceModel.find({
            userId,
            isActive: true,
            validUntil: { $gt: new Date() },
        });
        return eligibleWallets.reduce((sum, wallet) => sum + (wallet.balance || 0), 0);
    } catch (err) {
        logger.error(`[PricingService] Failed to calculate user available credits: ${err.message}`);
        return 0;
    }
};

/**
 * Calculate total estimated credits and pricing breakdown for a campaign doc or raw payload
 */
export const calculateCampaignCost = async ({ template, recipients, userId }) => {
    let targetRecipients = Array.isArray(recipients) ? recipients : [];
    
    // Filter to PENDING recipients (or un-sent ones)
    const pendingRecipients = targetRecipients.filter(r => !r.status || r.status === "PENDING");
    const category = String(template?.category || "marketing").toLowerCase().trim();

    let totalINR = 0;
    let totalUSD = 0;
    let totalGBP = 0;
    let totalCredits = 0;

    let usdRate = 83.5;
    let gbpRate = 108.0;
    try {
        const ExchangeRate = mongoose.model("ExchangeRate");
        const exchangeRateDoc = await ExchangeRate.findOne().sort({ createdAt: -1 });
        if (exchangeRateDoc && exchangeRateDoc.conversion_rate) {
            usdRate = exchangeRateDoc.conversion_rate;
        }
    } catch (e) {
        // use default rates
    }

    // Pre-fetch all active Meta pricings ONCE for high-speed calculation
    let pricings = [];
    try {
        pricings = await MetaWhatsappPricing.find({ effectiveTo: null }).lean();
        if (pricings && pricings.length > 0) {
            pricings.sort((a, b) => b.countryPrefix.length - a.countryPrefix.length);
        }
    } catch (e) {
        logger.error(`[PricingService] Pre-fetch pricing failed: ${e.message}`);
    }

    for (const r of pendingRecipients) {
        const phone = String(r.Phone || r.phone || r.phoneNumber || r || "").replace(/\D/g, "");
        if (!phone) continue;

        try {
            let matched = null;
            if (pricings && pricings.length > 0) {
                for (const p of pricings) {
                    if (phone.startsWith(p.countryPrefix)) {
                        matched = p;
                        break;
                    }
                }
                if (!matched) {
                    matched = pricings.find(p => p.countryCode === "IN") || pricings[0];
                }
            }

            let priceVal = 0;
            let currency = "INR";

            if (matched) {
                currency = String(matched.currency || "INR").toUpperCase();
                let basePrice = 0;
                let markup = 0;

                if (category === "marketing") {
                    basePrice = matched.marketing;
                    markup = matched.marketingMarkup !== undefined ? matched.marketingMarkup : (currency === "INR" ? 0.10 : 0);
                } else if (category === "utility") {
                    basePrice = matched.utility;
                    markup = matched.utilityMarkup !== undefined ? matched.utilityMarkup : (currency === "INR" ? 0.10 : 0);
                } else if (category === "authentication") {
                    basePrice = matched.authentication;
                    markup = matched.authenticationMarkup !== undefined ? matched.authenticationMarkup : (currency === "INR" ? 0.10 : 0);
                } else if (category === "service") {
                    basePrice = matched.service;
                    markup = matched.serviceMarkup !== undefined ? matched.serviceMarkup : (currency === "INR" ? 0.10 : 0);
                } else {
                    basePrice = matched.marketing;
                    markup = matched.marketingMarkup !== undefined ? matched.marketingMarkup : (currency === "INR" ? 0.10 : 0);
                }
                priceVal = (Number(basePrice) || 0) + (Number(markup) || 0);
            } else {
                const defaultInfo = getDefaultRates(phone, category);
                priceVal = defaultInfo.price;
                currency = defaultInfo.currency;
            }

            let priceInINR = priceVal;
            if (currency === "USD") {
                priceInINR = priceVal * usdRate;
                totalUSD += priceVal;
            } else if (currency === "GBP") {
                priceInINR = priceVal * gbpRate;
                totalGBP += priceVal;
            } else {
                totalINR += priceVal;
            }

            totalCredits += priceInINR;
        } catch (priceErr) {
            totalINR += 0.9631;
            totalCredits += 0.9631;
        }
    }

    const roundedCredits = Number(totalCredits.toFixed(4));

    return {
        recipientCount: pendingRecipients.length,
        category: template?.category,
        totalEstimatedCredits: roundedCredits,
        estimatedAmountINR: Number((totalINR + (totalUSD * usdRate) + (totalGBP * gbpRate)).toFixed(4)),
        breakdown: {
            usd: Number(totalUSD.toFixed(4)),
            gbp: Number(totalGBP.toFixed(4)),
            inr: Number(totalINR.toFixed(4))
        }
    };
};

