// const { getUserWABAs, getWABAPhoneNumbers } = require('./metaOAuth.service');
// const { WhatsAppNumber } = require('../../models');

import { getUserWABAs, getWABAPhoneNumbers } from "./metaOAuth.services.js";
import { metaWhatsappCampaignTokenSchema } from "../models/metaWhatsappCampaignTokenSchema.js";


/**
 * Sync all WABA phone numbers into DB for a tenant
 */
async function syncWhatsAppNumbers({ tenantId, accessToken }) {
    const businesses = await getUserWABAs(accessToken);

    const savedNumbers = [];

    for (const business of businesses) {
        const wabas = business.whatsapp_business_accounts?.data || [];

        for (const waba of wabas) {
            let phones = waba.phone_numbers?.data || [];

            // If phone numbers not returned in nested field, fetch separately
            if (!phones.length) {
                phones = await getWABAPhoneNumbers(waba.id, accessToken);
            }

            for (const phone of phones) {
                const numberData = {
                    tenantId,
                    displayName: phone.verified_name || phone.display_phone_number,
                    phoneNumber: phone.display_phone_number,
                    phoneNumberId: phone.id,
                    wabaId: waba.id,
                    accessToken,
                    status: mapStatus(phone.status),
                    qualityRating: phone.quality_rating || 'UNKNOWN',
                    messagingLimit: phone.messaging_limit_tier || 'TIER_1K',
                };

                const saved = await metaWhatsappCampaignTokenSchema.findOneAndUpdate(
                    { phoneNumberId: phone.id },
                    numberData,
                    { upsert: true, new: true }
                );

                savedNumbers.push(saved);
            }
        }
    }

    return savedNumbers;
}

function mapStatus(metaStatus) {
    if (!metaStatus) return 'active';

    const statusMap = {
        CONNECTED: 'active',
        PENDING: 'pending',
        DISCONNECTED: 'disconnected',
        RESTRICTED: 'paused',
    };

    return statusMap[metaStatus] || 'active';
}

module.exports = { syncWhatsAppNumbers };