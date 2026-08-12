import MetaWhatsappChatbot from "../models/metaWhatsappChatbotSchema.js";
import logger from "../../config/logger.js";

// GET /api/meta/whatsapp/:phoneNumberId/chatbot
export const getChatbotFlows = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const userId = req.user.id;
        const { flowId } = req.query;

        const query = { userId, phoneNumberId };
        if (flowId && flowId !== "null" && flowId !== "undefined") {
            query.flowId = flowId;
        } else {
            // For backward compatibility, default to rules where flowId is null
            query.flowId = null;
        }

        const flows = await MetaWhatsappChatbot.find(query)
            .populate("replyInteractiveId")
            .sort({ createdAt: -1 });

        return res.json({ success: true, data: flows });
    } catch (err) {
        logger.error(`[Chatbot Flow Controller] Get flows error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/chatbot
export const createChatbotFlow = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const userId = req.user.id;
        const {
            triggerType,
            triggerValue,
            replyType,
            replyText,
            replyInteractiveId,
            templateName,
            templateLanguage,
            templateParams,
            apiUrl,
            apiBody,
            flowId,
            isActive,
            attributeName,
            attributeValue,
            tagName,
            conditionAttribute,
            conditionOperator,
            conditionValue
        } = req.body;

        if (!triggerValue) {
            return res.status(400).json({ success: false, message: "Trigger value is required" });
        }

        // Normalize keyword triggers to lowercase
        const normalizedTrigger = triggerType === "keyword" ? triggerValue.trim().toLowerCase() : triggerValue.trim();

        const targetFlowId = (flowId && flowId !== "null" && flowId !== "undefined") ? flowId : null;

        // Check if trigger already exists in this specific flow
        const exists = await MetaWhatsappChatbot.findOne({ phoneNumberId, flowId: targetFlowId, triggerValue: normalizedTrigger });
        if (exists) {
            return res.status(400).json({ success: false, message: `A chatbot rule with the trigger "${triggerValue}" already exists.` });
        }

        const newFlow = await MetaWhatsappChatbot.create({
            userId,
            phoneNumberId,
            flowId: targetFlowId,
            triggerType,
            triggerValue: normalizedTrigger,
            replyType,
            replyText,
            replyInteractiveId: replyInteractiveId || null,
            templateName: templateName || "",
            templateLanguage: templateLanguage || "en",
            templateParams: templateParams || {},
            apiUrl: apiUrl || "",
            apiBody: apiBody || "",
            attributeName: attributeName || "",
            attributeValue: attributeValue || "",
            tagName: tagName || "",
            conditionAttribute: conditionAttribute || "",
            conditionOperator: conditionOperator || "",
            conditionValue: conditionValue || "",
            isActive: isActive ?? true
        });

        // Populate and return
        const populatedFlow = await MetaWhatsappChatbot.findById(newFlow._id).populate("replyInteractiveId");

        return res.status(201).json({ success: true, message: "Chatbot flow created successfully", data: populatedFlow });
    } catch (err) {
        logger.error(`[Chatbot Flow Controller] Create flow error: ${err.message}`);
        next(err);
    }
};

// PUT /api/meta/whatsapp/:phoneNumberId/chatbot/:id
export const updateChatbotFlow = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = req.user.id;
        const {
            triggerType,
            triggerValue,
            replyType,
            replyText,
            replyInteractiveId,
            templateName,
            templateLanguage,
            templateParams,
            apiUrl,
            apiBody,
            flowId,
            isActive,
            attributeName,
            attributeValue,
            tagName,
            conditionAttribute,
            conditionOperator,
            conditionValue
        } = req.body;

        const flow = await MetaWhatsappChatbot.findOne({ _id: id, userId, phoneNumberId });
        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow rule not found or unauthorized" });
        }

        logger.info(`[updateChatbotFlow] req.body: ${JSON.stringify(req.body)}`);
        logger.info(`[updateChatbotFlow] flow before update: ${JSON.stringify({
            _id: flow._id,
            triggerType: flow.triggerType,
            triggerValue: flow.triggerValue,
            flowId: flow.flowId
        })}`);

        if (triggerValue) {
            const normalizedTrigger = triggerType === "keyword" ? triggerValue.trim().toLowerCase() : triggerValue.trim();
            const targetFlowId = flowId !== undefined ? flowId : flow.flowId;
            // Check uniqueness if triggerValue or flowId changed
            const isFlowIdChanged = flowId !== undefined && String(flowId || "") !== String(flow.flowId || "");
            if (normalizedTrigger !== flow.triggerValue || isFlowIdChanged) {
                const exists = await MetaWhatsappChatbot.findOne({
                    _id: { $ne: flow._id },
                    phoneNumberId,
                    flowId: targetFlowId || null,
                    triggerValue: normalizedTrigger
                });
                if (exists) {
                    return res.status(400).json({ success: false, message: `A chatbot rule with the trigger "${triggerValue}" already exists.` });
                }
                flow.triggerValue = normalizedTrigger;
            }
        }

        if (triggerType) flow.triggerType = triggerType;
        if (replyType) flow.replyType = replyType;
        if (replyText !== undefined) flow.replyText = replyText;
        if (replyInteractiveId !== undefined) flow.replyInteractiveId = replyInteractiveId || null;
        if (templateName !== undefined) flow.templateName = templateName;
        if (templateLanguage !== undefined) flow.templateLanguage = templateLanguage;
        if (templateParams !== undefined) flow.templateParams = templateParams;
        if (apiUrl !== undefined) flow.apiUrl = apiUrl;
        if (apiBody !== undefined) flow.apiBody = apiBody;
        if (flowId !== undefined) flow.flowId = flowId || null;
        if (isActive !== undefined) flow.isActive = isActive;
        if (attributeName !== undefined) flow.attributeName = attributeName;
        if (attributeValue !== undefined) flow.attributeValue = attributeValue;
        if (tagName !== undefined) flow.tagName = tagName;
        if (conditionAttribute !== undefined) flow.conditionAttribute = conditionAttribute;
        if (conditionOperator !== undefined) flow.conditionOperator = conditionOperator;
        if (conditionValue !== undefined) flow.conditionValue = conditionValue;

        await flow.save();

        const populatedFlow = await MetaWhatsappChatbot.findById(flow._id).populate("replyInteractiveId");

        return res.json({ success: true, message: "Chatbot flow updated successfully", data: populatedFlow });
    } catch (err) {
        logger.error(`[Chatbot Flow Controller] Update flow error: ${err.message}`);
        next(err);
    }
};

// DELETE /api/meta/whatsapp/:phoneNumberId/chatbot/:id
export const deleteChatbotFlow = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = req.user.id;

        const flow = await MetaWhatsappChatbot.findOneAndDelete({ _id: id, userId, phoneNumberId });
        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow rule not found or unauthorized" });
        }

        return res.json({ success: true, message: "Chatbot flow deleted successfully" });
    } catch (err) {
        logger.error(`[Chatbot Flow Controller] Delete flow error: ${err.message}`);
        next(err);
    }
};
