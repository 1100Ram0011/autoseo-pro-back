import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

// GET /api/meta-whatsapp/:phoneNumberId/chatbot
export const getChatbotFlows = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const userId = (req as any).user?.id;
        const { flowId } = req.query;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const query: any = { userId, phoneNumberId };
        
        if (flowId && flowId !== "null" && flowId !== "undefined") {
            query.flowId = String(flowId);
        } else {
            // For backward compatibility, default to rules where flowId is null
            query.flowId = null;
        }

        const flows = await prisma.metaWhatsappChatbot.findMany({
            where: query,
            include: {
                interactive: true
            },
            orderBy: { createdAt: 'desc' }
        });

        return res.json({ success: true, data: flows });
    } catch (err: any) {
        logger.error(`[Chatbot Flow Rule Controller] Get flows error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta-whatsapp/:phoneNumberId/chatbot
export const createChatbotFlow = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const userId = (req as any).user?.id;
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

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        if (!triggerValue) {
            return res.status(400).json({ success: false, message: "Trigger value is required" });
        }

        // Normalize keyword triggers to lowercase
        const normalizedTrigger = triggerType === "keyword" ? triggerValue.trim().toLowerCase() : triggerValue.trim();
        const targetFlowId = (flowId && flowId !== "null" && flowId !== "undefined") ? String(flowId) : null;

        // Check if trigger already exists in this specific flow
        const exists = await prisma.metaWhatsappChatbot.findFirst({
            where: {
                phoneNumberId: phoneNumberId as string,
                flowId: targetFlowId,
                triggerValue: normalizedTrigger
            }
        });

        if (exists) {
            return res.status(400).json({ success: false, message: `A chatbot rule with the trigger "${triggerValue}" already exists.` });
        }

        const newFlow = await prisma.metaWhatsappChatbot.create({
            data: {
                userId: userId as string,
                phoneNumberId: phoneNumberId as string,
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
            },
            include: {
                interactive: true
            }
        });

        return res.status(201).json({ success: true, message: "Chatbot flow created successfully", data: newFlow });
    } catch (err: any) {
        logger.error(`[Chatbot Flow Rule Controller] Create flow error: ${err.message}`);
        next(err);
    }
};

// PUT /api/meta-whatsapp/:phoneNumberId/chatbot/:id
export const updateChatbotFlow = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = (req as any).user?.id;
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

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const flow = await prisma.metaWhatsappChatbot.findFirst({
            where: { id: id as string, userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow rule not found or unauthorized" });
        }

        const updateData: any = {};

        if (triggerValue) {
            const normalizedTrigger = triggerType === "keyword" ? triggerValue.trim().toLowerCase() : triggerValue.trim();
            const targetFlowId = flowId !== undefined ? (flowId || null) : flow.flowId;
            
            const isFlowIdChanged = flowId !== undefined && String(flowId || "") !== String(flow.flowId || "");
            
            if (normalizedTrigger !== flow.triggerValue || isFlowIdChanged) {
                const exists = await prisma.metaWhatsappChatbot.findFirst({
                    where: {
                        id: { not: flow.id },
                        phoneNumberId: phoneNumberId as string,
                        flowId: targetFlowId,
                        triggerValue: normalizedTrigger
                    }
                });
                
                if (exists) {
                    return res.status(400).json({ success: false, message: `A chatbot rule with the trigger "${triggerValue}" already exists.` });
                }
                updateData.triggerValue = normalizedTrigger;
            }
        }

        if (triggerType !== undefined) updateData.triggerType = triggerType;
        if (replyType !== undefined) updateData.replyType = replyType;
        if (replyText !== undefined) updateData.replyText = replyText;
        if (replyInteractiveId !== undefined) updateData.replyInteractiveId = replyInteractiveId || null;
        if (templateName !== undefined) updateData.templateName = templateName;
        if (templateLanguage !== undefined) updateData.templateLanguage = templateLanguage;
        if (templateParams !== undefined) updateData.templateParams = templateParams;
        if (apiUrl !== undefined) updateData.apiUrl = apiUrl;
        if (apiBody !== undefined) updateData.apiBody = apiBody;
        if (flowId !== undefined) updateData.flowId = flowId || null;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (attributeName !== undefined) updateData.attributeName = attributeName;
        if (attributeValue !== undefined) updateData.attributeValue = attributeValue;
        if (tagName !== undefined) updateData.tagName = tagName;
        if (conditionAttribute !== undefined) updateData.conditionAttribute = conditionAttribute;
        if (conditionOperator !== undefined) updateData.conditionOperator = conditionOperator;
        if (conditionValue !== undefined) updateData.conditionValue = conditionValue;

        const updatedFlow = await prisma.metaWhatsappChatbot.update({
            where: { id: id as string },
            data: updateData,
            include: {
                interactive: true
            }
        });

        return res.json({ success: true, message: "Chatbot flow updated successfully", data: updatedFlow });
    } catch (err: any) {
        logger.error(`[Chatbot Flow Rule Controller] Update flow error: ${err.message}`);
        next(err);
    }
};

// DELETE /api/meta-whatsapp/:phoneNumberId/chatbot/:id
export const deleteChatbotFlow = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const flow = await prisma.metaWhatsappChatbot.findFirst({
            where: { id: id as string, userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow rule not found or unauthorized" });
        }

        await prisma.metaWhatsappChatbot.delete({
            where: { id: id as string }
        });

        return res.json({ success: true, message: "Chatbot flow deleted successfully" });
    } catch (err: any) {
        logger.error(`[Chatbot Flow Rule Controller] Delete flow error: ${err.message}`);
        next(err);
    }
};
