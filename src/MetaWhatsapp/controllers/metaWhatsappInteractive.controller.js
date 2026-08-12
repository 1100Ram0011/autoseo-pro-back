import MetaGraphClient from "../services/metaFbWhatsapp.client.js";
import MetaWhatsappInteractive from "../models/metaWhatsappInteractiveSchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import logger from "../../config/logger.js";
import * as LogService from "../services/metaWhatsappLog.service.js";

// GET /api/meta/whatsapp/:phoneNumberId/interactive
export const getInteractiveMessages = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const numberDoc = await WhatsAppToken.findOne({ userId: req.user.id, phoneNumberId });
        if (!numberDoc) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const items = await MetaWhatsappInteractive.find({ userId: req.user.id, numberId: numberDoc._id }).sort({ createdAt: -1 });
        return res.json({ success: true, data: items });
    } catch (err) {
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/interactive
export const createInteractiveMessage = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const { name, type, headerText, bodyText, footerText, buttons, listButtonText, sections } = req.body;

        const numberDoc = await WhatsAppToken.findOne({ userId: req.user.id, phoneNumberId });
        if (!numberDoc) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const newItem = await MetaWhatsappInteractive.create({
            userId: req.user.id,
            numberId: numberDoc._id,
            name,
            type,
            headerText: headerText || "",
            bodyText,
            footerText: footerText || "",
            buttons: type === 'button' ? buttons : undefined,
            listButtonText: type === 'list' ? listButtonText : undefined,
            sections: type === 'list' ? sections : undefined
        });

        return res.status(201).json({ success: true, message: "Interactive message template saved", data: newItem });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/meta/whatsapp/:phoneNumberId/interactive/:id
export const deleteInteractiveMessage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const deleted = await MetaWhatsappInteractive.findOneAndDelete({ _id: id, userId: req.user.id });
        if (!deleted) {
            return res.status(404).json({ success: false, message: "Interactive message not found or unauthorized" });
        }
        return res.json({ success: true, message: "Interactive message deleted successfully" });
    } catch (err) {
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/interactive/:id/send
export const sendInteractiveMessage = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const { to } = req.body; // recipient phone number

        if (!to) {
            return res.status(400).json({ success: false, message: "Recipient phone number 'to' is required" });
        }

        const credentials = await WhatsAppToken.findOne({ 
            userId: req.user.id, 
            phoneNumberId 
        }).select("+accessToken");

        if (!credentials) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const item = await MetaWhatsappInteractive.findOne({ _id: id, userId: req.user.id });
        if (!item) {
            return res.status(404).json({ success: false, message: "Interactive message template not found" });
        }

        // Format Meta API interactive message payload
        const interactivePayload = {
            type: item.type,
            body: { text: item.bodyText }
        };

        if (item.headerText) {
            interactivePayload.header = { type: "text", text: item.headerText };
        }

        if (item.footerText) {
            interactivePayload.footer = { text: item.footerText };
        }

        if (item.type === "button") {
            const seenButtonIds = new Set();
            interactivePayload.action = {
                buttons: (item.buttons || []).map((btn, idx) => {
                    let rawId = (btn.id || btn.title || `btn_${idx + 1}`).trim();
                    if (!rawId) rawId = `btn_${idx + 1}`;
                    let uniqueId = rawId;
                    let counter = 1;
                    while (seenButtonIds.has(uniqueId)) {
                        uniqueId = `${rawId}_${counter}`;
                        counter++;
                    }
                    seenButtonIds.add(uniqueId);
                    return {
                        type: "reply",
                        reply: { id: uniqueId, title: btn.title }
                    };
                })
            };
        } else if (item.type === "list") {
            const seenRowIds = new Set();
            interactivePayload.action = {
                button: item.listButtonText,
                sections: (item.sections || []).map(sec => ({
                    title: sec.title || "",
                    rows: (sec.rows || []).map((row, rIdx) => {
                        let rawId = (row.id || row.title || `row_${rIdx + 1}`).trim();
                        if (!rawId) rawId = `row_${rIdx + 1}`;
                        let uniqueId = rawId;
                        let counter = 1;
                        while (seenRowIds.has(uniqueId)) {
                            uniqueId = `${rawId}_${counter}`;
                            counter++;
                        }
                        seenRowIds.add(uniqueId);
                        return {
                            id: uniqueId,
                            title: row.title,
                            description: row.description || ""
                        };
                    })
                }))
            };
        }

        const response = await MetaGraphClient.sendMessage(phoneNumberId, credentials.accessToken, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "interactive",
            interactive: interactivePayload
        });

        // ── Log outbound message to central logs collection ──
        const messageId = response?.messages?.[0]?.id;
        if (messageId) {
            LogService.logOutboundMessage({
                phoneNumberId,
                to,
                metaMessageId: messageId,
                messageType: "interactive",
                content: interactivePayload?.body?.text || `Interactive: ${interactivePayload?.type || 'buttons'}`,
                origin: "manual",
                userId: req.user.id,
                status: "sent",
            }).catch((logErr) => logger.error(`[Send Interactive Log Error] ${logErr.message}`));
        }

        return res.json({ success: true, message: "Interactive message sent successfully", messageId: response?.messages?.[0]?.id });
    } catch (err) {
        logger.error(`[Send Interactive Error] ${req.params.id} -> ${req.body?.to}:`, err.message);
        return res.status(err.statusCode || 500).json({
            success: false,
            message: "Failed to send interactive message via Meta Graph API",
            error: err.message,
            metaCode: err.metaCode,
            metaTraceId: err.metaFbTraceId
        });
    }
};

// PUT /api/meta/whatsapp/:phoneNumberId/interactive/:id
export const updateInteractiveMessage = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, type, headerText, bodyText, footerText, buttons, listButtonText, sections } = req.body;

        const updated = await MetaWhatsappInteractive.findOneAndUpdate(
            { _id: id, userId: req.user.id },
            {
                name,
                type,
                headerText: headerText || "",
                bodyText,
                footerText: footerText || "",
                buttons: type === 'button' ? buttons : undefined,
                listButtonText: type === 'list' ? listButtonText : undefined,
                sections: type === 'list' ? sections : undefined
            },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ success: false, message: "Interactive message not found or unauthorized" });
        }

        return res.json({ success: true, message: "Interactive message updated successfully", data: updated });
    } catch (err) {
        next(err);
    }
};
