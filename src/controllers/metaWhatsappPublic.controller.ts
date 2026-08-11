import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import axios from "axios";
import { logger } from "../config/logger";
// Note: sendTemplateMessage and other services should be imported from the corresponding TS service files
// import { sendTemplateMessage } from "../services/metaWhatsapp.services";
// import * as LogService from "../services/metaWhatsappLog.service";

const prisma = new PrismaClient();

const syncContactAttributesAsync = async (userId: string, to: string, attrsToSave: any, vars: any) => {
    if (!userId || (!attrsToSave && !vars)) return;

    logger.info(`[Public API] Syncing contact attributes for userId: ${userId}, to: ${to}`);
    try {
        const normalizedTo = String(to).replace(/\D/g, "");
        const setObj: any = {};

        const cleanVal = (val: any) => {
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

        if (attrsToSave && typeof attrsToSave === "object") {
            Object.keys(attrsToSave).forEach(k => {
                if (attrsToSave[k] !== undefined && attrsToSave[k] !== null) {
                    const strVal = cleanVal(attrsToSave[k]);
                    setObj[`${k}`] = strVal;
                }
            });
        }

        if (Array.isArray(vars)) {
            vars.forEach((v, idx) => {
                if (v !== undefined && v !== null) {
                    setObj[`var_${idx + 1}`] = String(v);
                }
            });
        } else if (vars && typeof vars === "object") {
            Object.keys(vars).forEach(k => {
                if (vars[k] !== undefined && vars[k] !== null) {
                    setObj[`${k}`] = String(vars[k]);
                }
            });
        }

        if (Object.keys(setObj).length > 0) {
            // Upsert contact in Prisma using unique phone/userId combination
            const contactPhone = `+${normalizedTo}`; // Standardize format for DB

            // This is a simplified contact sync for Prisma. 
            // Usually, custom fields are stored as JSON in Prisma
            await prisma.whatsAppContact.upsert({
                where: {
                    userId_phoneNumber: {
                        userId,
                        phoneNumber: contactPhone
                    }
                },
                update: {
                    customFields: setObj 
                },
                create: {
                    userId,
                    listId: "default", // or fetch a valid listId
                    phoneNumber: contactPhone,
                    name: normalizedTo,
                    source: "api",
                    customFields: setObj
                }
            });
        }
    } catch (err: any) {
        logger.error(`[Public API] Contact sync setup error: ${err.message}`);
    }
};

export const publicSendTemplate = async (req: Request | any, res: Response): Promise<any> => {
    try {
        const { to, templateName, templateLanguage, components, attributes, customFields } = req.body;

        if (!to || !templateName) {
            return res.status(400).json({
                error: "Missing required fields: 'to' and 'templateName' are required.",
            });
        }

        const { phoneNumberId, accessToken } = req.waCredentials;
        const userId = req.apiKeyDoc?.userId;

        syncContactAttributesAsync(userId, to, attributes || customFields, null);

        // This should use the internal service, but we mock the axios call here for the rewrite
        const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            to,
            type: "template",
            template: {
                name: templateName,
                language: { code: templateLanguage || "en_US" },
                components: components || []
            }
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        const result = response.data;

        // Log outbound
        const messageId = result?.messages?.[0]?.id;
        if (messageId) {
            await prisma.whatsAppLog.create({
                data: {
                    userId,
                    phoneNumberId,
                    to,
                    messageId: messageId,
                    messageType: "template",
                    templateName,
                    content: `Template: ${templateName}`,
                    origin: "api",
                    status: "sent",
                    direction: "outbound"
                }
            }).catch(logErr => logger.error(`[Public API] Outbound template logging failed: ${logErr.message}`));
        }

        return res.status(200).json({
            status: "success",
            result,
        });
    } catch (error: any) {
        logger.error(`[Public API - sendTemplate] Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
};

const applyVariables = (text: string, vars: any) => {
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

export const publicSendInteractive = async (req: Request | any, res: Response): Promise<any> => {
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

        const { phoneNumberId, accessToken } = req.waCredentials;
        const userId = req.apiKeyDoc?.userId;
        const targetName = name || interactiveName;

        syncContactAttributesAsync(userId, to, attributes || customFields, vars);

        let interactivePayload: any = null;

        if (interactiveId || targetName) {
            const query: any = { userId };
            if (interactiveId) {
                query.id = interactiveId;
            } else {
                query.name = targetName;
            }

            const item = await prisma.metaWhatsappInteractive.findFirst({ where: query });
            if (!item) {
                return res.status(404).json({
                    error: `Interactive message template '${interactiveId || targetName}' not found.`,
                });
            }

            interactivePayload = {
                type: item.type,
                body: { text: applyVariables(item.bodyText, vars) }
            };

            const docLink = inputDocLink;
            const docName = inputDocName || "Document.pdf";

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
                    buttons: (item.buttons as any[]).map((btn: any, idx: number) => {
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
                    button: applyVariables(item.listButtonText || "", vars),
                    sections: (item.sections as any[]).map((sec: any) => ({
                        title: applyVariables(sec.title || "", vars),
                        rows: (sec.rows || []).map((row: any, rIdx: number) => {
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
                const seenButtonIds = new Set();
                interactivePayload.action = {
                    buttons: (buttons as any[]).map((btn: any, idx: number) => {
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
                const seenRowIds = new Set();
                interactivePayload.action = {
                    button: applyVariables(listButtonText, vars),
                    sections: (sections as any[]).map((sec: any) => ({
                        title: applyVariables(sec.title || "", vars),
                        rows: (sec.rows || []).map((row: any, rIdx: number) => {
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

        const response = await axios.post(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "interactive",
            interactive: interactivePayload
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        const messageId = response.data?.messages?.[0]?.id;
        if (messageId) {
            await prisma.whatsAppLog.create({
                data: {
                    userId,
                    phoneNumberId,
                    to,
                    messageId: messageId,
                    messageType: "interactive",
                    content: interactivePayload?.body?.text || `Interactive: ${interactivePayload?.type || 'buttons'}`,
                    origin: "api",
                    status: "sent",
                    direction: "outbound"
                }
            }).catch(logErr => logger.error(`[Public API] Outbound interactive logging failed: ${logErr.message}`));
        }

        return res.status(200).json({
            status: "success",
            message: "Interactive message sent successfully",
            messageId,
            result: response.data,
        });
    } catch (error: any) {
        logger.error(`[Public API - sendInteractive] Error: ${error.message}`);
        return res.status(500).json({ error: error.message });
    }
};
