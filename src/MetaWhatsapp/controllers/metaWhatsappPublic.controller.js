import { sendTemplateMessage } from "../services/metaWhatsapp.services.js";
import MetaGraphClient from "../services/metaFbWhatsapp.client.js";
import MetaWhatsappInteractive from "../models/metaWhatsappInteractiveSchema.js";
import Contact from "../models/metaWhatsappCampaignContactsSchema.js";
import * as LogService from "../services/metaWhatsappLog.service.js";

/**
 * Public API — Send Template Message
 * ─────────────────────────────────────────────────────────────
 * Authenticated via API key (apiKeyAuth middleware).
 * The phoneNumberId and accessToken are resolved automatically
 * from the API key — the caller does NOT need to pass them.
 *
 * POST /api/v1/whatsapp/send-template
 * Headers: { "x-api-key": "<key>" }
 * Body: { to, templateName, templateLanguage?, components?, attributes? }
 */
/**
 * Fast atomic non-blocking update for Contact custom fields & template variables
 */
const syncContactAttributesAsync = (userId, to, attrsToSave, vars) => {
    if (!userId || (!attrsToSave && !vars)) return;

    console.log(`[Public API] Syncing contact attributes for userId: ${userId}, to: ${to}, attrs: ${JSON.stringify(attrsToSave)}, vars: ${JSON.stringify(vars)}`);
    try {
        const normalizedTo = String(to).replace(/\D/g, "");
        const setObj = {};

        const cleanVal = (val) => {
            if (val === undefined || val === null) return "";
            if (typeof val === "object") {
                if (val._id) return String(val._id);
                if (val.id) return String(val.id);
                try { return JSON.stringify(val); } catch (e) { return String(val); }
            }
            const s = String(val).trim();
            if (s.includes("ObjectId(") || s.includes("_id:")) {
                const m = s.match(/([a-fA-F0-9]{24})/);
                if (m) return m[1];
            }
            return s;
        };

        // 1. Process custom attributes object (e.g. { enquiryId: "1002", userId: "USR-1" })
        if (attrsToSave && typeof attrsToSave === "object") {
            Object.keys(attrsToSave).forEach(k => {
                if (attrsToSave[k] !== undefined && attrsToSave[k] !== null) {
                    const strVal = cleanVal(attrsToSave[k]);
                    setObj[`customFields.${k}`] = strVal;
                    setObj[`customFields.${k.toLowerCase()}`] = strVal;
                }
            });
        }

        // 2. Process positional template variables array (e.g. ["Client", "A100", "ENQ-1002"])
        if (Array.isArray(vars)) {
            vars.forEach((v, idx) => {
                if (v !== undefined && v !== null) {
                    setObj[`customFields.${idx + 1}`] = String(v);
                    setObj[`customFields.var_${idx + 1}`] = String(v);
                }
            });
        } else if (vars && typeof vars === "object") {
            Object.keys(vars).forEach(k => {
                if (vars[k] !== undefined && vars[k] !== null) {
                    setObj[`customFields.${k}`] = String(vars[k]);
                }
            });
        }

        if (Object.keys(setObj).length > 0) {
            Contact.findOneAndUpdate(
                {
                    userId,
                    $or: [
                        { phone: normalizedTo },
                        { phone: `+${normalizedTo}` },
                        { phone: normalizedTo.replace(/^91/, "") }
                    ]
                },
                {
                    $set: setObj,
                    $setOnInsert: { name: normalizedTo, source: "api" }
                },
                { upsert: true }
            ).catch(err => console.error("[Public API] Async contact sync error:", err.message));
        }
    } catch (err) {
        console.error("[Public API] Contact sync setup error:", err.message);
    }
};

export const publicSendTemplate = async (req, res) => {
    try {
        const { to, templateName, templateLanguage, components, attributes, customFields } = req.body;

        // Validate required fields
        if (!to || !templateName) {
            return res.status(400).json({
                error: "Missing required fields: 'to' and 'templateName' are required.",
            });
        }

        // Credentials resolved by apiKeyAuth middleware
        const { phoneNumberId, accessToken } = req.waCredentials;
        const userId = req.apiKeyDoc?.userId;

        // Automatically save/update contact attributes & positional variables asynchronously
        syncContactAttributesAsync(userId, to, attributes || customFields, null);

        const result = await sendTemplateMessage({
            phoneNumberId,
            to,
            templateName,
            templateLanguage: templateLanguage,
            components: components || [],
            accessToken,
        });

        // ── Log outbound message to central logs collection ──
        const messageId = result?.messages?.[0]?.id;
        if (messageId) {
            LogService.logOutboundMessage({
                phoneNumberId,
                to,
                metaMessageId: messageId,
                messageType: "template",
                templateName,
                content: `Template: ${templateName}`,
                origin: "api",
                status: "sent",
            }).catch((logErr) => console.error("[Public API] Outbound template logging failed:", logErr.message));
        }

        return res.status(200).json({
            status: "success",
            result,
        });
    } catch (error) {
        console.error("[Public API - sendTemplate] Error:", error);
        return res.status(500).json({ error: error.message });
    }
};

/**
 * Public API — Send Interactive Message (Buttons / Lists)
 * ─────────────────────────────────────────────────────────────
 * Authenticated via API key (apiKeyAuth middleware).
 * Supports sending saved interactive template via 'name' or 'interactiveId' OR passing direct interactive payload.
 *
 * POST /api/v1/whatsapp/send-interactive
 * Headers: { "x-api-key": "<key>" }
 * Body: { to, name?, interactiveName?, interactiveId?, type?, headerText?, bodyText?, footerText?, buttons?, listButtonText?, sections?, attributes? }
 */
const applyVariables = (text, vars) => {
    if (!text || !vars) return text || "";
    let processed = String(text);
    if (Array.isArray(vars)) {
        vars.forEach((val, idx) => {
            const reg = new RegExp(`\\{\\{\\s*${idx + 1}\\s*\\}\\}`, "gi");
            processed = processed.replace(reg, val !== undefined && val !== null ? String(val) : "");
        });
    } else if (typeof vars === "object") {
        Object.keys(vars).forEach(key => {
            const val = vars[key];
            const reg = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, "gi");
            processed = processed.replace(reg, val !== undefined && val !== null ? String(val) : "");
        });
    }
    return processed;
};

export const publicSendInteractive = async (req, res) => {
    try {
        const { to, name, interactiveName, interactiveId, type, headerText, bodyText, footerText, buttons, listButtonText, sections, variables, params, templateParams, mediaUrl, documentUrl, pdfUrl, filename, documentFilename, attributes, customFields } = req.body;
        const vars = variables || params || templateParams;
        const inputDocLink = mediaUrl || documentUrl || pdfUrl;
        const inputDocName = filename || documentFilename;

        if (!to) {
            return res.status(400).json({
                error: "Missing required field: 'to' recipient phone number is required.",
            });
        }

        // Credentials & user resolved by apiKeyAuth middleware
        const { phoneNumberId, accessToken } = req.waCredentials;
        const userId = req.apiKeyDoc?.userId;
        const targetName = name || interactiveName;

        // Automatically save/update contact attributes & positional variables asynchronously
        syncContactAttributesAsync(userId, to, attributes || customFields, vars);

        let interactivePayload = null;

        if (interactiveId || targetName) {
            // Case 1: Send using saved interactive template name or ID
            const query = { userId };
            if (interactiveId) {
                query._id = interactiveId;
            } else {
                query.name = targetName;
            }

            const item = await MetaWhatsappInteractive.findOne(query);
            if (!item) {
                return res.status(404).json({
                    error: `Interactive message template '${interactiveId || targetName}' not found.`,
                });
            }

            interactivePayload = {
                type: item.type,
                body: { text: applyVariables(item.bodyText, vars) }
            };

            const docLink = inputDocLink || item.mediaUrl;
            const docName = inputDocName || item.mediaFilename || "Document.pdf";

            if (docLink) {
                interactivePayload.header = {
                    type: "document",
                    document: {
                        link: docLink,
                        filename: docName
                    }
                };
            } else if (item.headerText) {
                interactivePayload.header = { type: "text", text: applyVariables(item.headerText, vars) };
            }
            if (item.footerText) {
                interactivePayload.footer = { text: applyVariables(item.footerText, vars) };
            }

            if (item.type === "button" && Array.isArray(item.buttons)) {
                const seenButtonIds = new Set();
                interactivePayload.action = {
                    buttons: item.buttons.map((btn, idx) => {
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
                            reply: { id: uniqueId, title: applyVariables(btn.title, vars) }
                        };
                    })
                };
            } else if (item.type === "list" && Array.isArray(item.sections)) {
                const seenRowIds = new Set();
                interactivePayload.action = {
                    button: applyVariables(item.listButtonText, vars),
                    sections: item.sections.map(sec => ({
                        title: applyVariables(sec.title || "", vars),
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
                                title: applyVariables(row.title, vars),
                                description: applyVariables(row.description || "", vars)
                            };
                        })
                    }))
                };
            }
        } else {
            // Case 2: Pass direct interactive payload
            if (!type || !bodyText) {
                return res.status(400).json({
                    error: "Missing required fields: Provide either 'name' / 'interactiveId' OR 'type' ('button'|'list') and 'bodyText'.",
                });
            }

            interactivePayload = {
                type,
                body: { text: applyVariables(bodyText, vars) }
            };

            if (inputDocLink) {
                interactivePayload.header = {
                    type: "document",
                    document: {
                        link: inputDocLink,
                        filename: inputDocName || "Document.pdf"
                    }
                };
            } else if (headerText) {
                interactivePayload.header = { type: "text", text: applyVariables(headerText, vars) };
            }
            if (footerText) {
                interactivePayload.footer = { text: applyVariables(footerText, vars) };
            }

            if (type === "button") {
                if (!Array.isArray(buttons) || buttons.length === 0) {
                    return res.status(400).json({ error: "'buttons' array with at least 1 button is required for button type." });
                }
                const seenButtonIds = new Set();
                interactivePayload.action = {
                    buttons: buttons.map((btn, idx) => {
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
                            reply: { id: uniqueId, title: applyVariables(btn.title, vars) }
                        };
                    })
                };
            } else if (type === "list") {
                if (!listButtonText || !Array.isArray(sections) || sections.length === 0) {
                    return res.status(400).json({ error: "'listButtonText' and 'sections' array are required for list type." });
                }
                const seenRowIds = new Set();
                interactivePayload.action = {
                    button: applyVariables(listButtonText, vars),
                    sections: sections.map(sec => ({
                        title: applyVariables(sec.title || "", vars),
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
                                title: applyVariables(row.title, vars),
                                description: applyVariables(row.description || "", vars)
                            };
                        })
                    }))
                };
            }
        }

        const response = await MetaGraphClient.sendMessage(phoneNumberId, accessToken, {
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
                origin: "api",
                status: "sent",
            }).catch((logErr) => console.error("[Public API] Outbound interactive logging failed:", logErr.message));
        }

        return res.status(200).json({
            status: "success",
            message: "Interactive message sent successfully",
            messageId: response?.messages?.[0]?.id,
            result: response,
        });
    } catch (error) {
        console.error("[Public API - sendInteractive] Error:", error);
        return res.status(500).json({ error: error.message });
    }
};
