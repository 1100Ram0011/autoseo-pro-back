import mongoose from "mongoose";
import axios from "axios";
import MetaWhatsappChatbotFlow from "../models/metaWhatsappChatbotFlowSchema.js";
import MetaWhatsappChatbot from "../models/metaWhatsappChatbotSchema.js";
import MetaWhatsappInteractive from "../models/metaWhatsappInteractiveSchema.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import logger from "../../config/logger.js";

// GET /api/meta/whatsapp/:phoneNumberId/chatbot-flows
export const getChatbotFlowsList = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const userId = req.user.id;

        const flows = await MetaWhatsappChatbotFlow.find({ userId, phoneNumberId })
            .populate("userId", "name email")
            .sort({ createdAt: -1 });

        return res.json({ success: true, data: flows });
    } catch (err) {
        logger.error(`[Chatbot Flow List Controller] Get flows error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/chatbot-flows
export const createChatbotFlowList = async (req, res, next) => {
    try {
        const { phoneNumberId } = req.params;
        const userId = req.user.id;
        const { name, description } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: "Flow name is required" });
        }

        // Check uniqueness
        const exists = await MetaWhatsappChatbotFlow.findOne({ userId, phoneNumberId, name: name.trim() });
        if (exists) {
            return res.status(400).json({ success: false, message: `A chatbot flow named "${name}" already exists.` });
        }

        let newFlow = await MetaWhatsappChatbotFlow.create({
            userId,
            phoneNumberId,
            name: name.trim(),
            description: description || "",
            isActive: true
        });

        newFlow = await newFlow.populate("userId", "name email");

        return res.status(201).json({ success: true, message: "Chatbot flow created successfully", data: newFlow });
    } catch (err) {
        logger.error(`[Chatbot Flow List Controller] Create flow error: ${err.message}`);
        next(err);
    }
};

// PUT /api/meta/whatsapp/:phoneNumberId/chatbot-flows/:id
export const updateChatbotFlowList = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = req.user.id;
        const { name, description, isActive, layout } = req.body;

        const flow = await MetaWhatsappChatbotFlow.findOne({ _id: id, userId, phoneNumberId });
        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow not found or unauthorized" });
        }

        if (name) {
            const trimmedName = name.trim();
            if (trimmedName !== flow.name) {
                const exists = await MetaWhatsappChatbotFlow.findOne({ userId, phoneNumberId, name: trimmedName });
                if (exists) {
                    return res.status(400).json({ success: false, message: `A chatbot flow named "${name}" already exists.` });
                }
                flow.name = trimmedName;
            }
        }

        if (description !== undefined) flow.description = description;
        if (isActive !== undefined) flow.isActive = isActive;
        if (layout !== undefined) {
            flow.layout = layout;
            flow.markModified("layout");
        }

        await flow.save();
        const populatedFlow = await MetaWhatsappChatbotFlow.findById(flow._id).populate("userId", "name email");

        return res.json({ success: true, message: "Chatbot flow updated successfully", data: populatedFlow });
    } catch (err) {
        logger.error(`[Chatbot Flow List Controller] Update flow error: ${err.message}`);
        next(err);
    }
};

// DELETE /api/meta/whatsapp/:phoneNumberId/chatbot-flows/:id
export const deleteChatbotFlowList = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = req.user.id;

        const flow = await MetaWhatsappChatbotFlow.findOneAndDelete({ _id: id, userId, phoneNumberId });
        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow not found or unauthorized" });
        }

        // Cascade delete all rules linked to this flow
        const deleteResult = await MetaWhatsappChatbot.deleteMany({ flowId: id, userId, phoneNumberId });
        logger.info(`[Chatbot Flow List Controller] Deleted flow "${flow.name}" and cascade-deleted ${deleteResult.deletedCount} rules`);

        return res.json({ success: true, message: "Chatbot flow and all associated rules deleted successfully" });
    } catch (err) {
        logger.error(`[Chatbot Flow List Controller] Delete flow error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/chatbot-flows/:id/duplicate
export const duplicateChatbotFlowList = async (req, res, next) => {
    try {
        const { phoneNumberId, id } = req.params;
        const { targetPhoneNumberId } = req.body || {};
        const userId = req.user.id;

        const targetNumberId = targetPhoneNumberId || phoneNumberId;

        const sourceFlow = await MetaWhatsappChatbotFlow.findOne({ _id: id, userId, phoneNumberId });
        if (!sourceFlow) {
            return res.status(404).json({ success: false, message: "Chatbot flow not found or unauthorized" });
        }

        // Find targetNumberDoc to get targetNumberDoc._id for layout items
        const targetNumberDoc = await WhatsAppToken.findOne({ userId, phoneNumberId: targetNumberId });
        if (!targetNumberDoc) {
            return res.status(404).json({ success: false, message: "Target WhatsApp number not connected or unauthorized" });
        }

        // Find rules of the original flow
        const originalRules = await MetaWhatsappChatbot.find({ flowId: id, userId, phoneNumberId });

        // 1. Identify and clone all referenced interactive templates
        const interactiveTemplateIds = [...new Set(originalRules
            .filter(rule => rule.replyType === "interactive" && rule.replyInteractiveId)
            .map(rule => rule.replyInteractiveId.toString())
        )];

        const templateMap = {}; // oldTemplateId -> newTemplateId
        for (const oldId of interactiveTemplateIds) {
            const oldTemplate = await MetaWhatsappInteractive.findOne({ _id: oldId, userId });
            if (oldTemplate) {
                // Check if a template with the same name already exists under the target number
                let targetTemplate = await MetaWhatsappInteractive.findOne({ 
                    userId, 
                    numberId: targetNumberDoc._id,
                    name: oldTemplate.name 
                });

                if (!targetTemplate) {
                    targetTemplate = await MetaWhatsappInteractive.create({
                        userId,
                        numberId: targetNumberDoc._id,
                        name: oldTemplate.name,
                        type: oldTemplate.type,
                        headerText: oldTemplate.headerText || "",
                        bodyText: oldTemplate.bodyText,
                        footerText: oldTemplate.footerText || "",
                        buttons: oldTemplate.buttons,
                        listButtonText: oldTemplate.listButtonText,
                        sections: oldTemplate.sections
                    });
                }
                templateMap[oldId] = targetTemplate._id.toString();
            }
        }

        // Generate unique duplicate name under the target number
        let duplicateName = `${sourceFlow.name} (Copy)`;
        let unique = false;
        let suffix = 1;
        while (!unique) {
            const exists = await MetaWhatsappChatbotFlow.findOne({ userId, phoneNumberId: targetNumberId, name: duplicateName });
            if (exists) {
                duplicateName = `${sourceFlow.name} (Copy ${suffix})`;
                suffix++;
            } else {
                unique = true;
            }
        }

        // 2. Map original rules _id to new temporary ids for api_response references
        const rulesMap = {}; 
        originalRules.forEach(rule => {
            rulesMap[rule._id.toString()] = new mongoose.Types.ObjectId();
        });

        // 3. Map the layout JSON nodes and connections
        let duplicatedLayout = null;
        if (sourceFlow.layout) {
            try {
                const layout = typeof sourceFlow.layout === "string" 
                    ? JSON.parse(sourceFlow.layout) 
                    : sourceFlow.layout;

                if (layout && Array.isArray(layout.nodes)) {
                    // We map node IDs and template IDs inside layout
                    const nodeMap = {}; // oldNodeId -> newNodeId
                    
                    // First pass: define the mapping for each node
                    layout.nodes.forEach(node => {
                        let newId = node.id;
                        if (node.id.startsWith("reply-")) {
                            const oldRuleId = node.id.replace("reply-", "");
                            if (rulesMap[oldRuleId]) {
                                newId = `reply-${rulesMap[oldRuleId]}`;
                            }
                        } else if (node.id.startsWith("template-") || (node.type === "interactive" && node.data?.templateId)) {
                            // Find the template ID
                            const oldTemplateId = node.data?.templateId || node.id.replace("template-", "");
                            const newTemplateId = templateMap[oldTemplateId];
                            if (newTemplateId) {
                                newId = `template-${newTemplateId}`;
                            }
                        }
                        nodeMap[node.id] = newId;
                    });

                    // Second pass: clone and update nodes
                    const newNodes = layout.nodes.map(node => {
                        const newId = nodeMap[node.id] || node.id;
                        const newNode = { ...node, id: newId };
                        
                        // Update templateId in data if it's an interactive node
                        if (node.type === "interactive" && node.data?.templateId) {
                            const newTemplateId = templateMap[node.data.templateId];
                            if (newTemplateId) {
                                newNode.data = {
                                    ...node.data,
                                    templateId: newTemplateId
                                };
                            }
                        }
                        return newNode;
                    });

                    // Third pass: clone and update connections
                    let newConnections = [];
                    if (Array.isArray(layout.connections)) {
                        newConnections = layout.connections.map(conn => {
                            const fromNew = nodeMap[conn.fromNodeId] || conn.fromNodeId;
                            const toNew = nodeMap[conn.toNodeId] || conn.toNodeId;
                            return {
                                ...conn,
                                id: `conn-${fromNew}-${toNew}-${conn.fromPortId}`,
                                fromNodeId: fromNew,
                                toNodeId: toNew
                            };
                        });
                    }

                    duplicatedLayout = {
                        ...layout,
                        nodes: newNodes,
                        connections: newConnections
                    };
                } else {
                    duplicatedLayout = layout;
                }
            } catch (layoutErr) {
                logger.error(`[Chatbot Flow List Controller] Error parsing source layout: ${layoutErr.message}`);
                duplicatedLayout = sourceFlow.layout;
            }
        }

        // Create duplicate flow under targetNumberId
        const duplicatedFlow = await MetaWhatsappChatbotFlow.create({
            userId,
            phoneNumberId: targetNumberId,
            name: duplicateName,
            description: sourceFlow.description ? `${sourceFlow.description} (Duplicate)` : "Duplicated flow",
            isActive: false, // Default duplicated flow to false / inactive
            layout: duplicatedLayout
        });

        const duplicatedRules = [];
        for (const rule of originalRules) {
            const newId = rulesMap[rule._id.toString()];
            
            // Adjust triggerValue for api_response type
            let newTriggerValue = rule.triggerValue;
            if (rule.triggerType === "api_response") {
                const parts = rule.triggerValue.split("-");
                const originalParentId = parts[0];
                const responseCode = parts.slice(1).join("-");
                if (rulesMap[originalParentId]) {
                    newTriggerValue = `${rulesMap[originalParentId]}-${responseCode}`;
                }
            }

            // Adjust replyInteractiveId using mapped new template ID
            let newReplyInteractiveId = rule.replyInteractiveId;
            if (rule.replyType === "interactive" && rule.replyInteractiveId) {
                newReplyInteractiveId = templateMap[rule.replyInteractiveId.toString()] || null;
            }

            duplicatedRules.push({
                _id: newId,
                userId,
                phoneNumberId: targetNumberId,
                flowId: duplicatedFlow._id,
                triggerType: rule.triggerType,
                triggerValue: newTriggerValue,
                replyType: rule.replyType,
                replyText: rule.replyText,
                replyInteractiveId: newReplyInteractiveId,
                apiUrl: rule.apiUrl,
                apiBody: rule.apiBody,
                isActive: rule.isActive
            });
        }

        if (duplicatedRules.length > 0) {
            await MetaWhatsappChatbot.insertMany(duplicatedRules);
        }

        const populatedDuplicatedFlow = await MetaWhatsappChatbotFlow.findById(duplicatedFlow._id).populate("userId", "name email");

        logger.info(`[Chatbot Flow List Controller] Duplicated flow "${sourceFlow.name}" to "${duplicateName}" on target "${targetNumberId}" with ${duplicatedRules.length} rules and copied templates`);

        return res.status(201).json({ success: true, message: "Chatbot flow duplicated successfully", data: populatedDuplicatedFlow });
    } catch (err) {
        logger.error(`[Chatbot Flow List Controller] Duplicate flow error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta/whatsapp/:phoneNumberId/chatbot-flows/test-api-request
export const testApiRequest = async (req, res, next) => {
    try {
        const { url, method = "POST", headers = [], params = [], body = {} } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: "API URL is required" });
        }

        let resolvedUrl = url.trim();
        if (resolvedUrl.startsWith("/") && (resolvedUrl.toLowerCase().startsWith("/http://") || resolvedUrl.toLowerCase().startsWith("/https://"))) {
            resolvedUrl = resolvedUrl.substring(1);
        }

        const headersObj = {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "69420"
        };
        if (Array.isArray(headers)) {
            headers.forEach(h => {
                if (h.key && h.key.trim()) {
                    headersObj[h.key.trim()] = h.value || "";
                }
            });
        }

        const paramsObj = {};
        if (Array.isArray(params)) {
            params.forEach(p => {
                if (p.key && p.key.trim()) {
                    paramsObj[p.key.trim()] = p.value || "";
                }
            });
        }

        let requestData = null;
        if (method.toUpperCase() !== "GET" && body) {
            if (typeof body === "string") {
                try {
                    requestData = JSON.parse(body);
                } catch (e) {
                    requestData = body;
                }
            } else {
                requestData = body;
            }
        }

        logger.info(`[Chatbot Flow Controller] Testing external API via backend proxy: ${method.toUpperCase()} ${resolvedUrl}`);

        const response = await axios({
            method: method.toUpperCase(),
            url: resolvedUrl,
            headers: headersObj,
            params: paramsObj,
            data: requestData,
            timeout: 10000
        });

        return res.json({
            success: true,
            status: response.status,
            data: response.data
        });
    } catch (err) {
        if (err.response) {
            return res.json({
                success: false,
                status: err.response.status,
                data: err.response.data
            });
        }
        logger.error(`[Chatbot Flow Controller] Test API call network/proxy error: ${err.message}`);
        return res.json({
            success: false,
            status: "Error",
            data: { error: err.message || "Network or server error" }
        });
    }
};
