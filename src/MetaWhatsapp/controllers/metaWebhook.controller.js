import logger from "../../config/logger.js";
import { generateWithOpenAI, generateTextWithOpenAI } from "../../services/aiService.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import MetaWhatsappChatbot from "../models/metaWhatsappChatbotSchema.js";
import MetaWhatsappChatbotFlow from "../models/metaWhatsappChatbotFlowSchema.js";
import Template from "../models/metaWhatsappCampaignTemplateSchema.js";
import socketService from "../../socket.js";
import axios from "axios";
import Contact from "../models/metaWhatsappCampaignContactsSchema.js";
import WhatsAppNumber from "../models/metaWhatsappnumberSchema.js";
import MetaGraphClient from "../services/metaFbWhatsapp.client.js";
import Campaign from "../models/metaWhatsappCampaignSchema.js";
import LogService from "../services/metaWhatsappLog.service.js";
import MetaTemplateQualityService from "../services/metaTemplateQuality.service.js";

const sendMessageWithFallback = async (phoneNumberId, postPayload, primaryToken) => {
    try {
        const response = await MetaGraphClient.sendMessage(phoneNumberId, primaryToken, postPayload);
        logger.info(`[Meta Webhook] Message sent successfully to ${postPayload.to}`);
        return response;
    } catch (error) {
        logger.warn(`[Meta Webhook] Failed to send with primary token: ${error.message}`);

        const systemToken = process.env.META_WHATSAPP_SYSTEM_USER_TOKEN;
        if (systemToken && systemToken !== primaryToken) {
            logger.info("[Meta Webhook] Attempting fallback with META_WHATSAPP_SYSTEM_USER_TOKEN...");
            try {
                const response = await MetaGraphClient.sendMessage(phoneNumberId, systemToken, postPayload);
                logger.info(`[Meta Webhook] Message sent successfully via fallback token to ${postPayload.to}`);
                
                // Self-heal: update DB record
                try {
                    await WhatsAppToken.updateOne(
                        { phoneNumberId },
                        { $set: { accessToken: systemToken } }
                    );
                    logger.info(`[Meta Webhook] Automatically updated DB accessToken with working System User Token`);
                } catch (dbErr) {
                    logger.error(`[Meta Webhook] Failed to auto-update DB accessToken:`, dbErr.message);
                }
                return response;
            } catch (fallbackError) {
                logger.error(`[Meta Webhook] Fallback token send also failed:`, fallbackError.message);
                throw fallbackError;
            }
        }
        throw error;
    }
};

const resolveContactAttributes = (text, contact, replyText = null) => {
    if (!text) return "";
    
    let resolvedText = text;
    if (replyText !== null && replyText !== undefined) {
        resolvedText = resolvedText.replace(/\{\{reply\}\}/gi, replyText).replace(/\$reply/gi, replyText);
    }
    
    if (!contact) return resolvedText;

    const formatAttrValue = (val) => {
        if (val === undefined || val === null) return null;

        // If val is an object (populated Mongoose Document or ObjectId)
        if (typeof val === "object") {
            if (val._id) return String(val._id);
            if (val.id) return String(val.id);
            try {
                return JSON.stringify(val);
            } catch (e) {
                return String(val);
            }
        }

        const strVal = String(val).trim();

        // Handle legacy/corrupted stringified objects containing ObjectId('...') or _id:
        if (strVal.includes("ObjectId(") || strVal.includes("_id:")) {
            const hexMatch = strVal.match(/([a-fA-F0-9]{24})/);
            if (hexMatch) {
                return hexMatch[1];
            }
        }

        return strVal;
    };

    const getAttr = (key) => {
        if (!key) return null;
        const rawKey = key.trim();
        const lowerKey = rawKey.toLowerCase();

        if (lowerKey === "reply") return replyText || "";
        if (lowerKey === "name" || lowerKey === "firstname" || lowerKey === "first name") return contact.name || "";
        if (lowerKey === "mobilenumber" || lowerKey === "mobile" || lowerKey === "phone") return contact.phone || "";
        if (lowerKey === "email") return contact.email || "";

        // Check customFields (Map or Object) first
        if (contact.customFields) {
            if (typeof contact.customFields.get === "function") {
                let val = contact.customFields.get(rawKey);
                if (val !== undefined && val !== null) return formatAttrValue(val);
                val = contact.customFields.get(lowerKey);
                if (val !== undefined && val !== null) return formatAttrValue(val);

                for (let [mk, mv] of contact.customFields.entries()) {
                    if (mk.toLowerCase() === lowerKey && mv !== undefined && mv !== null) {
                        return formatAttrValue(mv);
                    }
                }
            } else if (typeof contact.customFields === "object") {
                if (contact.customFields[rawKey] !== undefined && contact.customFields[rawKey] !== null) {
                    return formatAttrValue(contact.customFields[rawKey]);
                }
                if (contact.customFields[lowerKey] !== undefined && contact.customFields[lowerKey] !== null) {
                    return formatAttrValue(contact.customFields[lowerKey]);
                }
                for (let ok of Object.keys(contact.customFields)) {
                    if (ok.toLowerCase() === lowerKey && contact.customFields[ok] !== undefined && contact.customFields[ok] !== null) {
                        return formatAttrValue(contact.customFields[ok]);
                    }
                }
            }
        }

        // Check direct property on contact
        if (contact[rawKey] !== undefined && contact[rawKey] !== null) return formatAttrValue(contact[rawKey]);
        if (contact[lowerKey] !== undefined && contact[lowerKey] !== null) return formatAttrValue(contact[lowerKey]);

        // Fallback for userId if not specified in customFields
        if (lowerKey === "userid" || lowerKey === "user_id") {
            if (contact.userId) return formatAttrValue(contact.userId);
        }

        return null;
    };

    // 1. Resolve {{key}} syntax (e.g. {{phone}}, {{enquiryId}})
    resolvedText = resolvedText.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
        const val = getAttr(key);
        return val !== null ? val : match;
    });

    // 2. Resolve $key syntax (e.g. $MobileNumber, $enquiryId, $userId)
    resolvedText = resolvedText.replace(/\$([a-zA-Z0-9_]+)/g, (match, key) => {
        const val = getAttr(key);
        return val !== null ? val : match;
    });

    return resolvedText;
};

const executeRule = async (rule, phoneNumberId, senderPhone, credentials, senderName = null, replyText = null) => {
    if (!rule) return;

    // Load or create the contact record for attribute resolution
    let contact = null;
    try {
        const waNumber = await WhatsAppNumber.findOne({ phoneNumberId });
        const userId = waNumber?.addedBy || credentials?.userId || rule?.userId;
        if (userId) {
            contact = await Contact.findOne({
                userId,
                $or: [
                    { phone: senderPhone },
                    { phone: `+${senderPhone}` },
                    { phone: senderPhone.replace(/^\+/, "") }
                ]
            });
            if (!contact) {
                contact = await Contact.create({
                    userId,
                    phone: senderPhone,
                    name: senderName || senderPhone,
                    source: "webhook"
                });
            } else if ((contact.name === senderPhone || !contact.name) && senderName) {
                contact.name = senderName;
                await contact.save();
            }
        }
    } catch (dbErr) {
        logger.error(`[Meta Webhook] Error fetching/creating contact: ${dbErr.message}`);
    }

    if (rule.replyType === "text") {
        // Resolve contact attribute templates e.g. {{name}} or {{city}}
        const resolvedText = resolveContactAttributes(rule.replyText, contact, replyText);
        
        const response = await sendMessageWithFallback(phoneNumberId, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: senderPhone,
            type: "text",
            text: { body: resolvedText }
        }, credentials.accessToken);
        logger.info(`[Meta Webhook] Sent text bot reply to "${senderPhone}": ${resolvedText}`);

        // --- NEW LOGGING SYSTEM ---
        if (response?.messages?.[0]?.id) {
            await LogService.logOutboundMessage({
                phoneNumberId,
                to: senderPhone,
                metaMessageId: response.messages[0].id,
                messageType: "text",
                content: resolvedText,
                origin: "chatbot"
            });
        }

        // Trigger next sequential node
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "next_step",
            triggerValue: String(rule._id),
            isActive: true
        }).populate("replyInteractiveId");
        
        if (nextRule) {
            // Check if the next rule expects user input.
            // If the next rule is a text or interactive response or conditional, run immediately.
            // If it is a set_attribute or api_request, pause execution and wait for the user's input.
            if (
                nextRule.replyType === "text" || 
                nextRule.replyType === "interactive" || 
                nextRule.replyType === "meta_template" ||
                nextRule.replyType === "condition" || 
                nextRule.replyType === "add_tag" || 
                nextRule.replyType === "intervention"
            ) {
                await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
            } else {
                if (contact) {
                    if (!contact.customFields) contact.customFields = new Map();
                    contact.customFields.set("pending_rule_id", String(nextRule._id));
                    contact.markModified("customFields");
                    await contact.save();
                    logger.info(`[Meta Webhook] Paused flow at text response. Saved pending rule ID: ${nextRule._id} to contact customFields.`);
                }
            }
        }
    } else if (rule.replyType === "interactive" && rule.replyInteractiveId) {
        const item = rule.replyInteractiveId;

        // Helper to replace both templateParams ({{1}}, {{2}}...) and contact attributes ({{name}}, {{reply}}...)
        const formatInteractiveText = (text) => {
            if (!text) return "";
            let processed = text;
            if (rule.templateParams && typeof rule.templateParams === "object") {
                Object.keys(rule.templateParams).forEach(k => {
                    const mappedVal = rule.templateParams[k];
                    if (mappedVal !== undefined && mappedVal !== null) {
                        const reg = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, "gi");
                        processed = processed.replace(reg, mappedVal);
                    }
                });
            }
            return resolveContactAttributes(processed, contact, replyText);
        };

        const resolvedBodyText = formatInteractiveText(item.bodyText);
        
        const interactivePayload = {
            type: item.type,
            body: { text: resolvedBodyText }
        };
        if (item.headerText) interactivePayload.header = { type: "text", text: formatInteractiveText(item.headerText) };
        if (item.footerText) interactivePayload.footer = { text: formatInteractiveText(item.footerText) };

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
                        reply: { id: uniqueId, title: formatInteractiveText(btn.title) }
                    };
                })
            };
        } else if (item.type === "list") {
            const seenRowIds = new Set();
            interactivePayload.action = {
                button: formatInteractiveText(item.listButtonText),
                sections: (item.sections || []).map(sec => ({
                    title: formatInteractiveText(sec.title || ""),
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
                            title: formatInteractiveText(row.title),
                            description: formatInteractiveText(row.description || "")
                        };
                    })
                }))
            };
        }

        const response = await sendMessageWithFallback(phoneNumberId, {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: senderPhone,
            type: "interactive",
            interactive: interactivePayload
        }, credentials.accessToken);
        logger.info(`[Meta Webhook] Sent interactive bot reply to "${senderPhone}"`);

        // --- NEW LOGGING SYSTEM ---
        if (response?.messages?.[0]?.id) {
            await LogService.logOutboundMessage({
                phoneNumberId,
                to: senderPhone,
                metaMessageId: response.messages[0].id,
                messageType: "interactive",
                content: "Interactive message (buttons/list)",
                origin: "chatbot"
            });
        }
    } else if (rule.replyType === "meta_template" || (rule.replyType === "interactive" && rule.templateName)) {
        const templateName = rule.templateName || (rule.replyInteractiveId?.name);
        const templateLanguage = rule.templateLanguage || "en";
        const templateParamsObj = rule.templateParams || {};
        
        let parameters = [];
        if (typeof templateParamsObj === "object" && templateParamsObj !== null) {
            const keys = Object.keys(templateParamsObj).sort((a, b) => Number(a) - Number(b));
            parameters = keys.map(key => ({
                type: "text",
                text: resolveContactAttributes(String(templateParamsObj[key] || ""), contact, replyText) || ""
            }));
        }

        const templatePayload = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: senderPhone,
            type: "template",
            template: {
                name: templateName,
                language: { code: templateLanguage },
                components: parameters.length > 0 ? [
                    {
                        type: "body",
                        parameters
                    }
                ] : []
            }
        };

        const response = await sendMessageWithFallback(phoneNumberId, templatePayload, credentials.accessToken);
        logger.info(`[Meta Webhook] Sent Meta approved template "${templateName}" to "${senderPhone}" with params: ${JSON.stringify(parameters)}`);

        // --- NEW LOGGING SYSTEM ---
        if (response?.messages?.[0]?.id) {
            await LogService.logOutboundMessage({
                phoneNumberId,
                to: senderPhone,
                metaMessageId: response.messages[0].id,
                messageType: "template",
                templateName: templateName,
                content: `Template: ${templateName}`,
                origin: "chatbot"
            });
        }

        // Trigger next sequential node
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "next_step",
            triggerValue: String(rule._id),
            isActive: true
        }).populate("replyInteractiveId");

        if (nextRule) {
            if (
                nextRule.replyType === "text" || 
                nextRule.replyType === "interactive" || 
                nextRule.replyType === "meta_template" ||
                nextRule.replyType === "condition" || 
                nextRule.replyType === "add_tag" || 
                nextRule.replyType === "intervention"
            ) {
                await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
            } else {
                if (contact) {
                    if (!contact.customFields) contact.customFields = new Map();
                    contact.customFields.set("pending_rule_id", String(nextRule._id));
                    contact.markModified("customFields");
                    await contact.save();
                    logger.info(`[Meta Webhook] Paused flow after meta template. Saved pending rule ID: ${nextRule._id} to contact customFields.`);
                }
            }
        }
    } else if (rule.replyType === "api_request") {
        logger.info(`[Meta Webhook] Executing API Request for rule: ${rule._id}`);
        
        let resolvedUrl = resolveContactAttributes(rule.apiUrl, contact, replyText);
        if (resolvedUrl) {
            resolvedUrl = resolvedUrl.trim();
            if (resolvedUrl.startsWith("/") && (resolvedUrl.toLowerCase().startsWith("/http://") || resolvedUrl.toLowerCase().startsWith("/https://"))) {
                resolvedUrl = resolvedUrl.substring(1);
            }
        }
        if (resolvedUrl && resolvedUrl.includes("verify-otp-chatbot")) {
            try {
                await sendMessageWithFallback(phoneNumberId, {
                    messaging_product: "whatsapp",
                    recipient_type: "individual",
                    to: senderPhone,
                    type: "text",
                    text: { body: "Please wait, your website analysis report is generating. You will receive it here once completed! 📊⏳" }
                }, credentials.accessToken);
                logger.info(`[Meta Webhook] Sent pre-crawl "Please wait" message to ${senderPhone}`);
            } catch (err) {
                logger.error(`[Meta Webhook] Failed to send pre-crawl message: ${err.message}`);
            }
        }

        const resolvedBodyStr = resolveContactAttributes(rule.apiBody, contact, replyText);

        let resolvedBody = {};
        try {
            if (resolvedBodyStr) {
                resolvedBody = JSON.parse(resolvedBodyStr);
            }
        } catch (err) {
            logger.error(`[Meta Webhook] Failed to parse resolved API body JSON: ${resolvedBodyStr}`);
            resolvedBody = resolvedBodyStr;
        }

        let statusCode = "fallback";
        let apiResponseData = null;
        try {
            logger.info(`[Meta Webhook] Calling external API: POST ${resolvedUrl} with payload: ${JSON.stringify(resolvedBody)}`);
            const response = await axios.post(resolvedUrl, resolvedBody, {
                headers: {
                    "Content-Type": "application/json",
                    "x-phone-number-id": phoneNumberId
                },
                timeout: 10000 // 10s timeout
            });
            statusCode = String(response.status);
            apiResponseData = response.data;
            logger.info(`[Meta Webhook] API call succeeded with status: ${statusCode}`);
        } catch (apiErr) {
            if (apiErr.response) {
                statusCode = String(apiErr.response.status);
                apiResponseData = apiErr.response.data;
                logger.warn(`[Meta Webhook] API call returned non-2xx status: ${statusCode}`);
            } else {
                logger.error(`[Meta Webhook] API call network/timeout error: ${apiErr.message}`);
                statusCode = "fallback";
            }
        }

        // If the API returned payload attributes, dynamically save them to the Contact record
        if (contact && apiResponseData && typeof apiResponseData === "object") {
            try {
                if (!contact.customFields) {
                    contact.customFields = new Map();
                }

                // Helper to extract nested values e.g. "data.secureLink"
                const getValueByPath = (obj, path) => {
                    if (!obj || !path) return undefined;
                    const parts = path.trim().split(".");
                    let current = obj;
                    for (let i = 0; i < parts.length; i++) {
                        const key = parts[i];
                        if (current && typeof current === "object" && key in current) {
                            current = current[key];
                        } else {
                            // If first key is "data" and missing directly, fallback to obj
                            if (i === 0 && key === "data" && obj && typeof obj === "object") {
                                continue;
                            }
                            return undefined;
                        }
                    }
                    return current;
                };

                // 1. Process explicitly configured responseAttributes (e.g. state <- data.secureLink)
                if (Array.isArray(rule.responseAttributes) && rule.responseAttributes.length > 0) {
                    rule.responseAttributes.forEach(item => {
                        const attr = item?.attribute?.trim();
                        const resKey = item?.responseKey?.trim();
                        if (attr && resKey) {
                            const extracted = getValueByPath(apiResponseData, resKey);
                            if (extracted !== undefined && extracted !== null) {
                                const valStr = typeof extracted === "object" ? JSON.stringify(extracted) : String(extracted);
                                contact.customFields.set(attr.toLowerCase(), valStr);
                                contact.customFields.set(attr, valStr);
                                logger.info(`[Meta Webhook] Mapped attribute "${attr}" = "${valStr}" from response key "${resKey}"`);
                            }
                        }
                    });
                }

                // 2. Also flatten and save direct & nested properties automatically
                const flattenAndSave = (sourceObj) => {
                    if (sourceObj && typeof sourceObj === "object") {
                        Object.keys(sourceObj).forEach(key => {
                            const val = sourceObj[key];
                            if (val !== undefined && val !== null && typeof val !== "object") {
                                contact.customFields.set(key.toLowerCase(), String(val));
                                contact.customFields.set(key, String(val));
                            }
                        });
                    }
                };

                flattenAndSave(apiResponseData);
                if (apiResponseData.data && typeof apiResponseData.data === "object") {
                    flattenAndSave(apiResponseData.data);
                }

                if (apiResponseData.name) contact.name = String(apiResponseData.name);
                if (apiResponseData.email) contact.email = String(apiResponseData.email).toLowerCase();

                contact.markModified("customFields");
                await contact.save();
                logger.info(`[Meta Webhook] Saved contact attributes for API response`);
            } catch (saveErr) {
                logger.error(`[Meta Webhook] Failed to save contact attributes: ${saveErr.message}`);
            }
        }

        // Find response rule for this status code or fallback
        let targetRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "api_response",
            triggerValue: `${rule._id}-${statusCode}`,
            isActive: true
        }).populate("replyInteractiveId");

        if (!targetRule) {
            logger.info(`[Meta Webhook] No specific rule for status code ${statusCode}, checking fallback...`);
            targetRule = await MetaWhatsappChatbot.findOne({
                phoneNumberId,
                flowId: rule.flowId || null,
                triggerType: "api_response",
                triggerValue: `${rule._id}-fallback`,
                isActive: true
            }).populate("replyInteractiveId");
        }

        if (targetRule) {
            await executeRule(targetRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
        } else {
            logger.info(`[Meta Webhook] No response or fallback rule configured for API request rule ${rule._id}`);
        }
    } else if (rule.replyType === "set_attribute") {
        if (contact && rule.attributeName) {
            try {
                let resolvedVal = resolveContactAttributes(rule.attributeValue, contact, replyText);
                if (rule.attributeName && rule.attributeName.toLowerCase() === "temp_website" && resolvedVal) {
                    resolvedVal = resolvedVal.trim();
                    if (resolvedVal && !/^https?:\/\//i.test(resolvedVal)) {
                        resolvedVal = `https://${resolvedVal}`;
                    }
                }
                if (!contact.customFields) {
                    contact.customFields = new Map();
                }
                contact.customFields.set(rule.attributeName.toLowerCase(), resolvedVal);
                contact.customFields.set(rule.attributeName, resolvedVal);
                contact.markModified("customFields");
                await contact.save();
                logger.info(`[Meta Webhook] Set attribute: ${rule.attributeName} = ${resolvedVal}`);
            } catch (err) {
                logger.error(`[Meta Webhook] Failed to save set_attribute: ${err.message}`);
            }
        }
        // Trigger next sequential node
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "next_step",
            triggerValue: String(rule._id),
            isActive: true
        }).populate("replyInteractiveId");
        if (nextRule) {
            await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
        }
    } else if (rule.replyType === "add_tag") {
        if (contact && rule.tagName) {
            try {
                if (!contact.tags) contact.tags = [];
                if (!contact.tags.includes(rule.tagName)) {
                    contact.tags.push(rule.tagName);
                    await contact.save();
                    logger.info(`[Meta Webhook] Added tag: ${rule.tagName}`);
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Failed to add tag: ${err.message}`);
            }
        }
        // Trigger next sequential node
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "next_step",
            triggerValue: String(rule._id),
            isActive: true
        }).populate("replyInteractiveId");
        if (nextRule) {
            await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
        }
    } else if (rule.replyType === "intervention") {
        if (contact) {
            try {
                contact.isBotActive = false;
                contact.lastInterventionTime = new Date();
                await contact.save();
                logger.info(`[Meta Webhook] Paused bot (Human Intervention requested) for ${senderPhone}`);
                
                // Notify via Socket.io
                if (socketService) {
                    socketService.emitToUser(String(contact.userId), "agent_intervention_needed", {
                        phone: senderPhone,
                        name: contact.name,
                        message: "Human takeover requested in WhatsApp Chatbot Flow."
                    });
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Failed to request intervention: ${err.message}`);
            }
        }
        // Trigger next sequential node if connected
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "next_step",
            triggerValue: String(rule._id),
            isActive: true
        }).populate("replyInteractiveId");
        if (nextRule) {
            await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
        }
    } else if (rule.replyType === "condition") {
        let isMatch = false;
        if (contact && rule.conditionAttribute) {
            try {
                let attrValue = "";
                const attrKey = rule.conditionAttribute;
                if (attrKey.toLowerCase() === "name") attrValue = contact.name || "";
                else if (attrKey.toLowerCase() === "email") attrValue = contact.email || "";
                else if (attrKey.toLowerCase() === "phone") attrValue = contact.phone || "";
                else if (contact.customFields) {
                    attrValue = contact.customFields.get(attrKey) || contact.customFields.get(attrKey.toLowerCase()) || "";
                }

                const operator = rule.conditionOperator;
                const targetValue = rule.conditionValue;

                if (operator === "equals") {
                    isMatch = String(attrValue).toLowerCase() === String(targetValue).toLowerCase();
                } else if (operator === "not_equals") {
                    isMatch = String(attrValue).toLowerCase() !== String(targetValue).toLowerCase();
                } else if (operator === "contains") {
                    isMatch = String(attrValue).toLowerCase().includes(String(targetValue).toLowerCase());
                } else if (operator === "greater_than") {
                    isMatch = Number(attrValue) > Number(targetValue);
                } else if (operator === "less_than") {
                    isMatch = Number(attrValue) < Number(targetValue);
                } else if (operator === "exists") {
                    isMatch = attrValue !== undefined && attrValue !== null && attrValue !== "";
                }
                logger.info(`[Meta Webhook] Evaluated condition (${attrKey} ${operator} ${targetValue}): Result = ${isMatch}`);
            } catch (err) {
                logger.error(`[Meta Webhook] Failed evaluating condition: ${err.message}`);
            }
        }

        const branchValue = `${rule._id}-${isMatch ? "true" : "false"}`;
        const nextRule = await MetaWhatsappChatbot.findOne({
            phoneNumberId,
            flowId: rule.flowId || null,
            triggerType: "condition_branch",
            triggerValue: branchValue,
            isActive: true
        }).populate("replyInteractiveId");
        if (nextRule) {
            await executeRule(nextRule, phoneNumberId, senderPhone, credentials, senderName, replyText);
        }
    }
};

// GET /webhook
// Verify Meta webhook token
export const verifyMetaWebhook = async (req, res) => {
    try {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        // Check if verify token matches env or fallback
        const localVerifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || "mytekai_meta_verify_token";

        if (mode && token) {
            if (mode === "subscribe" && (token === localVerifyToken || token === "mytekai_meta_verify_token" || token === "borade_verify_token_2026")) {
                logger.info("[Meta Webhook] Verification successful");
                return res.status(200).send(challenge);
            } else {
                // Also check if any stored token matches
                const matchedToken = await WhatsAppToken.findOne({ webhookVerifyToken: token });
                if (matchedToken) {
                    logger.info("[Meta Webhook] Verification successful via DB match");
                    return res.status(200).send(challenge);
                }
                logger.warn("[Meta Webhook] Verification failed: token mismatch");
                return res.sendStatus(403);
            }
        }
        return res.sendStatus(400);
    } catch (err) {
        logger.error("[Meta Webhook] Verification error:", err);
        return res.sendStatus(500);
    }
};

// POST /webhook
// Handle incoming events from Meta (messages, button clicks, status updates)
export const handleMetaWebhook = async (req, res) => {
    try {
        const data = req.body;
        logger.info(`[Meta Webhook] Received payload: ${JSON.stringify(data)}`);

        // Acknowledge receipt immediately
        res.status(200).send("EVENT_RECEIVED");

        if (data.object !== "whatsapp_business_account") {
            return;
        }

        const entry = data.entry?.[0];
        const changes = entry?.changes?.[0];
        const field = changes?.field;
        const value = changes?.value;

        if (!value) return;

        // --- Handle Phone Number Quality & Messaging Limit Updates ---
        if (field === "phone_number_quality_update" || field === "phone_number_name_update") {
            const displayPhoneNumber = value.display_phone_number;
            const event = value.event; // UPGRADED, DOWNGRADED, FLAG_SET, etc.
            const currentLimit = value.current_limit; // TIER_250, TIER_1K, TIER_10K, TIER_100K, TIER_UNLIMITED
            const phoneNumberId = value.phone_number_id || value.id;

            logger.info(`[Meta Webhook] Quality/Limit Update for Phone ID ${phoneNumberId}: event=${event}, limit=${currentLimit}`);

            try {
                const query = phoneNumberId ? { phoneNumberId } : { phoneNumber: displayPhoneNumber };
                const updateFields = {};

                if (currentLimit) {
                    updateFields.messagingLimit = currentLimit;
                }
                if (value.quality_score?.developer_score || value.quality_rating) {
                    updateFields.qualityRating = (value.quality_score?.developer_score || value.quality_rating || 'UNKNOWN').toUpperCase();
                }

                if (Object.keys(updateFields).length > 0) {
                    const updatedToken = await WhatsAppToken.findOneAndUpdate(query, { $set: updateFields }, { new: true });
                    if (updatedToken) {
                        logger.info(`[Meta Webhook] Updated messaging limit for ${updatedToken.phoneNumber} to ${updatedToken.messagingLimit}`);
                        if (socketService && updatedToken.userId) {
                            socketService.emitToUser(String(updatedToken.userId), "whatsapp:phone_quality_updated", {
                                phoneNumberId: updatedToken.phoneNumberId,
                                messagingLimit: updatedToken.messagingLimit,
                                qualityRating: updatedToken.qualityRating,
                                event
                            });
                        }
                    } else {
                        logger.warn(`[Meta Webhook] No matching WhatsAppToken found for phone ID ${phoneNumberId}`);
                    }
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Phone quality update processing failed: ${err.message}`);
            }
            return;
        }

        // --- Handle Template Portfolio Pacing ---
        if (field === "template_pacing" || field === "message_template_pacing") {
            const templateId = value.message_template_id;
            const pacingAction = value.event || value.action;

            logger.info(`[Meta Webhook] Template Pacing Update: templateId=${templateId}, action=${pacingAction}`);

            try {
                const template = await Template.findOne({ metaTemplateId: String(templateId) });
                if (template) {
                    template.isPacedByMeta = pacingAction === "PACED";
                    await template.save();
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Template pacing update error: ${err.message}`);
            }
            return;
        }

        // --- Handle Template Status Updates ---
        if (field === "message_template_status_update") {
            const templateId = value.message_template_id;
            const newStatus = value.event; // APPROVED, REJECTED, etc.
            const reason = value.reason;
            
            // Delegate to the specialized quality service
            await MetaTemplateQualityService.handleStatusUpdate(value);
            
            try {
                const template = await Template.findOne({ metaTemplateId: String(templateId) });
                if (template) {
                    // Meta's webhook sends APPROVED, REJECTED, PENDING, PAUSED, DISABLED, etc.
                    template.status = newStatus || template.status;
                    template.rejectionReason = reason === "NONE" ? null : reason;
                    
                    if (newStatus === "APPROVED") {
                        template.isLocked = true;
                    }
                    
                    await template.save();
                    logger.info(`[Meta Webhook] Template ${templateId} status updated to ${newStatus}`);
                    
                    if (socketService && template.userId) {
                        socketService.emitToUser(String(template.userId), "whatsapp:template_status_updated", {
                            templateId: template._id,
                            metaTemplateId: templateId,
                            status: newStatus,
                            reason
                        });
                    }
                } else {
                    logger.warn(`[Meta Webhook] Received status update for unknown template ${templateId}`);
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Template update failed: ${err.message}`);
            }
            return;
        }

        // --- Handle Message Status Updates (Delivered, Read, Failed) ---
        if (value.statuses && value.statuses.length > 0) {
            try {
                for (const statusObj of value.statuses) {
                    const messageId = statusObj.id;
                    if (!messageId) continue;

                    let status = statusObj.status; // 'sent', 'delivered', 'read', 'failed'
                    if (statusObj.errors && statusObj.errors.length > 0) {
                        status = "failed";
                    }
                    const timestamp = statusObj.timestamp ? new Date(parseInt(statusObj.timestamp) * 1000) : new Date();
                    
                    logger.info(`[Meta Webhook] Status update for message ${messageId}: ${status}`);

                    // Centralized atomic log, campaign sync, error capture & socket broadcast
                    await LogService.updateMessageStatus({
                        metaMessageId: messageId,
                        status: status, // pass resolved status ('failed' if errors present)
                        timestamp: timestamp,
                        errors: statusObj.errors || [],
                        pricing: statusObj.pricing,
                        conversation: statusObj.conversation,
                        phoneNumberId: value.metadata?.phone_number_id,
                        recipientId: statusObj.recipient_id
                    });
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Error processing statuses: ${err.message}`);
            }
        }

        // --- Handle Incoming Messages ---
        if (!value.messages) {
            return; // Not a message event
        }

        const messages = value.messages;
        const metadata = value.metadata;
        const phoneNumberId = metadata?.phone_number_id;

        if (!phoneNumberId) {
            logger.warn("[Meta Webhook] No phone_number_id found in metadata");
            return;
        }

        // Fetch credentials for this business number to authorize replies
        let credentials = await WhatsAppToken.findOne({ phoneNumberId }).select("+accessToken");
        if (!credentials) {
            if (phoneNumberId === process.env.META_WHATSAPP_PHONE_NO_ID && process.env.META_WHATSAPP_ACCESS_TOKEN) {
                logger.info(`[Meta Webhook] Using env credentials fallback for phone_number_id: ${phoneNumberId}`);
                credentials = {
                    phoneNumberId: process.env.META_WHATSAPP_PHONE_NO_ID,
                    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN,
                    wabaId: process.env.META_WHATSAPP_WABA_IDS
                };
            } else {
                logger.error(`[Meta Webhook] No credentials found for phone_number_id: ${phoneNumberId}`);
                return;
            }
        }
        // Fetch active flows for this business number to filter triggers
        let activeFlowIds = [];
        try {
            const activeFlows = await MetaWhatsappChatbotFlow.find({ phoneNumberId, isActive: true });
            activeFlowIds = activeFlows.map(f => f._id);
        } catch (flowErr) {
            logger.error(`[Meta Webhook] Error fetching active flows: ${flowErr.message}`);
        }

        for (const message of messages) {
            const senderPhone = message.from; // user's phone number
            const senderProfile = value.contacts?.find(c => c.wa_id === senderPhone)?.profile?.name || 
                                 value.contacts?.[0]?.profile?.name || null;
            const senderName = senderProfile || senderPhone;

            let contact = null;
            // Check if contact has bot disabled (agent takeover is active)
            try {
                const waNumber = await WhatsAppNumber.findOne({ phoneNumberId });
                const userId = waNumber?.addedBy || credentials?.userId;
                if (userId) {
                    contact = await Contact.findOne({
                        userId,
                        $or: [
                            { phone: senderPhone },
                            { phone: `+${senderPhone}` },
                            { phone: senderPhone.replace(/^\+/, "") }
                        ]
                    });
                }

                // Fallback: search by phone number only if userId was missing or contact not found
                if (!contact) {
                    contact = await Contact.findOne({
                        $or: [
                            { phone: senderPhone },
                            { phone: `+${senderPhone}` },
                            { phone: senderPhone.replace(/^\+/, "") }
                        ]
                    });
                }

                if (contact && contact.isBotActive === false) {
                    logger.info(`[Meta Webhook] Bot is paused (Human Intervention active) for ${senderPhone}. Skipping bot processing.`);
                    
                    // Emit message to Socket for real-time live chat updates
                    if (socketService && contact.userId) {
                        socketService.emitToUser(String(contact.userId), "whatsapp:message_received", {
                            phone: senderPhone,
                            name: contact.name,
                            message: message.text?.body || "Interactive message received"
                        });
                    }
                    continue;
                }
            } catch (err) {
                logger.error(`[Meta Webhook] Error checking bot active state: ${err.message}`);
            }

            // 1. Extract button click payload if present
            let payload = null;
            if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
                payload = message.interactive.button_reply.id;
            } else if (message.type === 'button') {
                payload = message.button?.payload || message.button?.text;
            }

            // 2. Extract text body if present
            let messageText = null;
            if (message.type === 'text') {
                messageText = message.text?.body;
            }

            // Check if there is a pending rule waiting for this contact's input
            let pendingRuleId = null;
            if (contact && contact.customFields) {
                pendingRuleId = contact.customFields.get("pending_rule_id") || contact.customFields.get("pending_rule_id".toLowerCase());
            }

            if (pendingRuleId && messageText) {
                logger.info(`[Meta Webhook] Contact ${senderPhone} has pending rule ID: ${pendingRuleId}. Processing response as input.`);
                try {
                    const pendingRule = await MetaWhatsappChatbot.findOne({
                        _id: pendingRuleId,
                        phoneNumberId,
                        isActive: true
                    }).populate("replyInteractiveId");

                    if (pendingRule) {
                        // Clear the pending rule from contact customFields to prevent infinite loops
                        contact.customFields.delete("pending_rule_id");
                        contact.customFields.delete("pending_rule_id".toLowerCase());
                        contact.markModified("customFields");
                        await contact.save();

                        // Execute the pending rule with the user's message as reply text context
                        await executeRule(pendingRule, phoneNumberId, senderPhone, credentials, senderName, messageText);
                        continue; // Proceed to next message, skipping keyword triggers
                    } else {
                        logger.info(`[Meta Webhook] Pending rule ID ${pendingRuleId} not found or inactive. Falling back to trigger matching.`);
                    }
                } catch (pendingErr) {
                    logger.error(`[Meta Webhook] Error loading/executing pending rule: ${pendingErr.message}`);
                }
            }

            if (payload) {
                logger.info(`[Meta Webhook] User clicked Quick Reply payload: ${payload}`);

                // --- NEW LOGGING SYSTEM ---
                await LogService.logInboundMessage({
                    phoneNumberId: phoneNumberId,
                    from: senderPhone,
                    metaMessageId: message.id,
                    messageType: "interactive",
                    content: payload,
                    providerData: message
                });

                try {
                    // Try finding a dynamic chatbot rule first
                    const dynamicRule = await MetaWhatsappChatbot.findOne({
                        phoneNumberId,
                        flowId: { $in: [...activeFlowIds, null] },
                        triggerValue: payload,
                        triggerType: "button_payload",
                        isActive: true
                    }).populate("replyInteractiveId");

                    if (dynamicRule) {
                        logger.info(`[Meta Webhook] Found dynamic rule for button payload: ${payload}`);
                        await executeRule(dynamicRule, phoneNumberId, senderPhone, credentials, senderName);
                    } else {
                        logger.info(`[Meta Webhook] No dynamic chatbot rule found for button payload "${payload}".`);
                    }
                } catch (error) {
                    logger.error(`[Meta Webhook] Error sending button response:`, error.message);
                }
            } else if (messageText) {
                const normalizedText = messageText.trim().toLowerCase();
                logger.info(`[Meta Webhook] Received text message: "${messageText}" from ${senderPhone}`);

                // --- NEW LOGGING SYSTEM ---
                await LogService.logInboundMessage({
                    phoneNumberId: phoneNumberId,
                    from: senderPhone,
                    metaMessageId: message.id,
                    messageType: "text",
                    content: messageText,
                    providerData: message
                });

                try {
                    // Try finding a dynamic chatbot rule first
                    const dynamicRule = await MetaWhatsappChatbot.findOne({
                        phoneNumberId,
                        flowId: { $in: [...activeFlowIds, null] },
                        triggerValue: normalizedText,
                        triggerType: "keyword",
                        isActive: true
                    }).populate("replyInteractiveId");

                    if (dynamicRule) {
                        logger.info(`[Meta Webhook] Found dynamic rule for keyword: ${normalizedText}`);
                        await executeRule(dynamicRule, phoneNumberId, senderPhone, credentials, senderName);
                    } else {
                        // Fallback to static mapping
                        const responseMap = {
                            "how can borade ai grow my business?": "Borade AI can grow your business by automating customer support, capturing qualified leads, and sending personalized marketing campaigns. Let us know if you'd like a demo!",
                            "can you analyze my website?": "Yes! Please reply with your website URL (e.g., https://example.com) and we'll analyze it for growth and optimization opportunities.",
                            "how do i get more leads?": "We capture leads 24/7 through interactive WhatsApp menus and follow up instantly. Would you like to schedule a demo of our Lead Gen flow?",
                            "what can ai do for my business?": "AI can automate up to 80% of customer queries, handle booking/scheduling, qualify leads, and run automated follow-ups instantly on WhatsApp.",
                            "hello": "SEND_HELLO_BUTTONS",
                            "hi": "SEND_HELLO_BUTTONS",
                            "hey": "SEND_HELLO_BUTTONS",
                        };

                        let botReply = responseMap[normalizedText];
                        if (!botReply) {
                            try {
                                botReply = await generateTextWithOpenAI({
                                    systemPrompt: "You are Borade AI, a smart assistant designed to help businesses automate their operations, lead generation, and customer support. Keep your response short (1-2 sentences), professional, and helpful.",
                                    userPrompt: messageText
                                });
                            } catch (aiError) {
                                logger.error(`[Meta Webhook] AI fallback generation failed: ${aiError.message}`);
                                botReply = "Hello! Thanks for contacting Borade AI. How can we help you today?";
                            }
                        }

                        if (botReply && senderPhone) {
                            let postPayload;
                            if (botReply === "SEND_HELLO_BUTTONS") {
                                postPayload = {
                                    messaging_product: "whatsapp",
                                    recipient_type: "individual",
                                    to: senderPhone,
                                    type: "interactive",
                                    interactive: {
                                        type: "button",
                                        body: {
                                            text: "Hello! Welcome to Borade AI. How can we help you grow your business today?"
                                        },
                                        action: {
                                            buttons: [
                                                {
                                                    type: "reply",
                                                    reply: {
                                                        id: "analyze_website",
                                                        title: "Analyze Website"
                                                    }
                                                },
                                                {
                                                    type: "reply",
                                                    reply: {
                                                        id: "demo_schedule",
                                                        title: "Book Demo"
                                                    }
                                                },
                                                {
                                                    type: "reply",
                                                    reply: {
                                                        id: "view_services",
                                                        title: "View Services"
                                                    }
                                                }
                                            ]
                                        }
                                     }
                                };
                            } else {
                                postPayload = {
                                    messaging_product: "whatsapp",
                                    recipient_type: "individual",
                                    to: senderPhone,
                                    type: "text",
                                    text: { body: botReply }
                                };
                            }

                            const response = await sendMessageWithFallback(phoneNumberId, postPayload, credentials.accessToken);
                            logger.info(`[Meta Webhook] Sent static/AI bot reply to ${senderPhone}: ${botReply}`);

                            // --- NEW LOGGING SYSTEM ---
                            if (response?.messages?.[0]?.id) {
                                await LogService.logOutboundMessage({
                                    phoneNumberId,
                                    to: senderPhone,
                                    metaMessageId: response.messages[0].id,
                                    messageType: botReply === "SEND_HELLO_BUTTONS" ? "interactive" : "text",
                                    content: botReply === "SEND_HELLO_BUTTONS" ? "Hello buttons sent" : botReply,
                                    origin: "auto-reply"
                                });
                            }
                        }
                    }
                } catch (sendError) {
                    logger.error(`[Meta Webhook] Error sending auto-reply:`, sendError.message);
                    
                    // --- NEW LOGGING SYSTEM ---
                    // Log the failed outbound message attempt
                    await LogService.logOutboundMessage({
                        phoneNumberId,
                        to: senderPhone,
                        metaMessageId: null,
                        messageType: botReply === "SEND_HELLO_BUTTONS" ? "interactive" : "text",
                        content: botReply === "SEND_HELLO_BUTTONS" ? "Hello buttons sent" : botReply,
                        origin: "auto-reply",
                        status: "failed",
                        errors: [{ title: "Send Error", message: sendError.message, code: sendError.code || sendError.name }]
                    });
                }
            }
        }


    } catch (error) {
        logger.error(`[Meta Webhook] Unhandled error: ${error.message}`);
    }
};
