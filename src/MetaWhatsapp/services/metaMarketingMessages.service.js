import MetaGraphClient from './metaFbWhatsapp.client.js';
import MetaWhatsappNumber from '../models/metaWhatsappnumberSchema.js';

class MetaMarketingMessagesService {
    /**
     * Send a marketing template via the MM Lite API
     */
    async sendMMLite(phoneNumberId, accessToken, payload) {
        // Enforce that only MARKETING templates can use this endpoint
        if (payload.type !== 'template') {
            throw new Error('MM Lite API only supports template messages');
        }

        const numberInfo = await MetaWhatsappNumber.findOne({ phoneNumberId, isDeleted: false });
        if (!numberInfo) throw new Error('WhatsApp number not found');

        // Check if eligible and ToS accepted
        if (!numberInfo.mmLite?.eligible || !numberInfo.mmLite?.tosAccepted) {
            throw new Error('Number is not eligible for MM Lite or ToS not accepted');
        }

        // The payload for /marketing_messages is identical to /messages
        return await MetaGraphClient.sendMarketingMessage(phoneNumberId, accessToken, payload);
    }

    /**
     * Update the TTL for a marketing template
     */
    async updateMarketingTemplateTTL(wabaId, accessToken, templateName, ttlSeconds) {
        // Enforce MM Lite TTL limits: 12 hours (43200) to 30 days (2592000)
        if (ttlSeconds < 43200 || ttlSeconds > 2592000) {
            throw new Error('Marketing Template TTL must be between 12 hours and 30 days');
        }

        return await MetaGraphClient.updateTemplateTTL(wabaId, accessToken, templateName, ttlSeconds);
    }
}

export default new MetaMarketingMessagesService();
