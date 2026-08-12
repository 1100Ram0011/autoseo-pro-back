import WhatsAppToken from '../models/metaWhatsappCampaignTokenSchema.js';
import MetaGraphClient from '../services/metaFbWhatsapp.client.js';
import { syncWithMetaGraph } from '../utils/metaSync.util.js';

export const getNumberSettings = async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const number = await WhatsAppToken.findOne({ phoneNumberId, userId: req.user?.id || req.user?._id }).select('+accessToken');
        
        if (!number) {
            return res.status(404).json({ success: false, message: 'Number not found' });
        }

        // Fetch live settings from Meta
        await syncWithMetaGraph({
            document: number,
            phoneNumberId,
            accessToken: number.accessToken,
            fetchFromMetaFn: () => MetaGraphClient.getPhoneNumberSettings(phoneNumberId, number.accessToken, { fields: 'calling' }),
            extractLiveStateFn: (res) => res?.data?.[0]?.calling,
            compareAndUpdateFn: (doc, liveCalling) => {
                let needsSave = false;
                
                if (!doc.callSettings) doc.callSettings = {};

                if (doc.callSettings.status !== liveCalling.status) {
                    doc.callSettings.status = liveCalling.status;
                    needsSave = true;
                }
                if (doc.callSettings.callIconVisibility !== liveCalling.call_icon_visibility && liveCalling.call_icon_visibility) {
                    doc.callSettings.callIconVisibility = liveCalling.call_icon_visibility;
                    needsSave = true;
                }
                
                return needsSave;
            }
        });

        res.json({
            success: true,
            settings: {
                retryConfig: number.retryConfig,
                autoTemplateDisable: number.autoTemplateDisable,
                callSettings: number.callSettings,
                previewUrlEnabled: number.previewUrlEnabled,
                mmLite: number.mmLite
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateNumberSettings = async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const updates = req.body; // Partial updates allowed

        const number = await WhatsAppToken.findOne({ phoneNumberId, userId: req.user?.id || req.user?._id }).select('+accessToken');
        if (!number) {
            return res.status(404).json({ success: false, message: 'Number not found' });
        }

        // Apply partial updates to local DB
        if (updates.retryConfig) Object.assign(number.retryConfig, updates.retryConfig);
        if (updates.autoTemplateDisable) {
            Object.assign(number.autoTemplateDisable, updates.autoTemplateDisable);
            if (updates.autoTemplateDisable.enabled === false) {
                // If user turns protection OFF, resume any campaigns that were auto-paused by protection
                const MetaWhatsappCampaign = (await import('../models/metaWhatsappCampaignSchema.js')).default;
                await MetaWhatsappCampaign.updateMany(
                    { numberId: number._id, status: 'PAUSED', autoPausedByTemplateProtection: true },
                    { $set: { status: 'RUNNING', autoPausedByTemplateProtection: false, failureReason: null, resumedAt: new Date() } }
                );
            }
        }
        if (updates.previewUrlEnabled !== undefined) number.previewUrlEnabled = updates.previewUrlEnabled;
        if (updates.mmLite) Object.assign(number.mmLite, updates.mmLite);

        // Feature 3: Sync Call Settings with Meta
        if (updates.callSettings) {
            const currentCallStatus = number.callSettings?.status || 'DISABLED';
            const newCallStatus = updates.callSettings.status || currentCallStatus;
            
            const currentIcon = number.callSettings?.callIconVisibility || 'DISABLE_ALL';
            const newIcon = updates.callSettings.callIconVisibility || currentIcon;

            // Only call Meta API if there's a change
            if (newCallStatus !== currentCallStatus || newIcon !== currentIcon) {
                const metaPayload = {
                    calling: {
                        status: newCallStatus,
                        call_icon_visibility: newIcon
                    }
                };

                try {
                    const res = await MetaGraphClient.updatePhoneNumberSettings(
                        phoneNumberId,
                        number.accessToken,
                        metaPayload
                    );
                    console.log("res - ", res);
                    number.callSettings.lastSyncedAt = new Date();
                } catch (metaErr) {
                    console.error('[NumberSettings] Failed to sync call settings to Meta:', metaErr.message);
                    return res.status(400).json({ 
                        success: false, 
                        message: 'Failed to update Meta Call Settings. Changes reverted.',
                        metaError: metaErr.response?.data?.error || metaErr.message 
                    });
                }
            }

            Object.assign(number.callSettings, updates.callSettings);
        }

        await number.save();
        
        res.json({ success: true, message: 'Settings updated successfully', settings: number });
    } catch (error) {
        console.error('[NumberSettings] Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getMetaPhoneSettings = async (req, res) => {
    try {
        const { phoneNumberId } = req.params;
        const number = await MetaWhatsappNumber.findOne({ phoneNumberId, tenantId: req.user.tenantId });
        
        if (!number) {
            return res.status(404).json({ success: false, message: 'Number not found' });
        }

        const data = await MetaGraphClient.getPhoneNumberSettings(phoneNumberId, number.systemAccessToken);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
