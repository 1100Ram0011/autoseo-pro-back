import MetaGraphClient from "../services/metaFbWhatsapp.client.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import logger from "../../config/logger.js";

// GET /api/meta/whatsapp/:phoneNumberId/conversational-automation
// Fetch current settings from local DB, sync with Meta if available
export const getConversationalAutomation = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const credentials = await WhatsAppToken.findOne({ 
            userId: req.user.id, 
            phoneNumberId 
        }).select("+accessToken");

        if (!credentials) {
            return res.status(404).json({ success: false, message: "WhatsApp number not found or unauthorized" });
        }

        // Default to saved local DB config
        let config = credentials.conversationalAutomation || { prompts: [], commands: [] };

        try {
            const data = await MetaGraphClient.getConversationalAutomation(phoneNumberId, credentials.accessToken);
            // Only update local DB if Meta returns a valid conversational_automation object with data
            if (
                data?.conversational_automation && 
                (Array.isArray(data.conversational_automation.prompts) || Array.isArray(data.conversational_automation.commands))
            ) {
                config = data.conversational_automation;
                await WhatsAppToken.updateOne(
                    { phoneNumberId },
                    { $set: { conversationalAutomation: config } }
                );
            }
        } catch (metaErr) {
            logger.warn(`[Conversational Automation] Could not fetch from Meta, using local DB config for ${phoneNumberId}: ${metaErr.message}`);
        }

        return res.json({ success: true, data: config });
    } catch (err) {
        logger.error(`[Conversational Automation] Get error for ${req.params.phoneNumberId}:`, err.message);
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/conversational-automation
// Configure commands & prompts on Meta and save locally according to official Meta Graph API specs
export const updateConversationalAutomation = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const { prompts, commands, enable_welcome_message } = req.body;
        const isWelcomeMessageEnabled = enable_welcome_message !== undefined ? Boolean(enable_welcome_message) : true;

        // Meta Spec Validation Rules:
        // - Prompts: Max 4 prompts, max 80 chars per prompt
        // - Commands: Max 30 commands, name max 32 chars (lowercase alphanumeric & underscores), desc max 256 chars
        if (prompts && prompts.length > 4) {
            return res.status(400).json({ success: false, message: "Maximum of 4 Ice Breaker prompts allowed." });
        }

        if (commands && commands.length > 30) {
            return res.status(400).json({ success: false, message: "Maximum of 30 Slash Commands allowed." });
        }

        // Clean & Sanitize Prompts (Max 80 chars)
        const cleanPrompts = (prompts || [])
            .map(p => typeof p === 'string' ? p.trim() : '')
            .filter(p => p !== '')
            .slice(0, 4);

        for (const prompt of cleanPrompts) {
            if (prompt.length > 80) {
                return res.status(400).json({ success: false, message: `Prompt "${prompt}" exceeds 80 characters limit.` });
            }
        }

        // Clean & Sanitize Commands (Name max 32 chars, Desc max 256 chars)
        const seenNames = new Set();
        const formattedCommands = [];

        for (const c of (commands || [])) {
            const rawName = (c.command_name || c.name || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
            const rawDesc = (c.command_description || c.description || "").trim();

            if (!rawName || !rawDesc) continue;

            if (rawName.length > 32) {
                return res.status(400).json({ success: false, message: `Command '/${rawName}' exceeds 32 characters limit.` });
            }

            if (rawDesc.length > 256) {
                return res.status(400).json({ success: false, message: `Description for '/${rawName}' exceeds 256 characters limit.` });
            }

            if (seenNames.has(rawName)) {
                return res.status(400).json({ success: false, message: `Duplicate command name '/${rawName}' is not allowed.` });
            }

            seenNames.add(rawName);

            formattedCommands.push({
                command_name: rawName,
                command_description: rawDesc,
                name: rawName,
                description: rawDesc
            });
        }

        const credentials = await WhatsAppToken.findOne({ 
            userId: req.user.id, 
            phoneNumberId 
        }).select("+accessToken");

        if (!credentials) {
            return res.status(404).json({ success: false, message: "WhatsApp number not found or unauthorized" });
        }

        const newConfig = {
            enable_welcome_message: isWelcomeMessageEnabled,
            prompts: cleanPrompts,
            commands: formattedCommands
        };

        // 1. Update local DB first so saved state is NEVER lost
        await WhatsAppToken.updateOne(
            { phoneNumberId },
            { $set: { conversationalAutomation: newConfig } }
        );

        let finalConfig = newConfig;

        // 2. Try pushing to Meta Graph API
        try {
            const payload = {
                enable_welcome_message: isWelcomeMessageEnabled,
                prompts: cleanPrompts,
                commands: formattedCommands.map(c => ({
                    command_name: c.command_name,
                    command_description: c.command_description
                }))
            };
            console.log("Sending payload to Meta: ", JSON.stringify(payload, null, 2));

            const updateResponse = await MetaGraphClient.updateConversationalAutomation(phoneNumberId, credentials.accessToken, payload);
            console.log("Update Response from Meta: ", JSON.stringify(updateResponse, null, 2));
            
            // 3. Immediately fetch the live confirmed state from Meta
            // const metaResponse = await MetaGraphClient.getConversationalAutomation(phoneNumberId, credentials.accessToken);
            // if (metaResponse?.conversational_automation) {
            //     finalConfig = metaResponse.conversational_automation;
                
            //     // Save the exact Meta response back to MongoDB for perfect synchronization
            //     await WhatsAppToken.updateOne(
            //         { phoneNumberId },
            //         { $set: { conversationalAutomation: finalConfig } }
            //     );
            // }
            // console.log("metaResponse - ", metaResponse);
        } catch (metaErr) {
            logger.error(`[Conversational Automation] Meta API sync failed for ${phoneNumberId}: ${metaErr.message}`);
            return res.status(400).json({
                success: false,
                message: "Failed to update settings on Meta.",
                error: metaErr.message
            });
        }

        return res.json({ 
            success: true, 
            message: "Conversational automation updated on Meta and saved successfully",
            data: finalConfig 
        });
    } catch (err) {
        logger.error(`[Conversational Automation] Update error for ${req.params.phoneNumberId}:`, err.message);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Failed to update conversational automation",
            error: err.message,
        });
    }
};
