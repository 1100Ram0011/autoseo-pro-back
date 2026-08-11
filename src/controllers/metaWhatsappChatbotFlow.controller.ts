import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

// GET /api/meta-whatsapp/:phoneNumberId/chatbot-flows
export const getChatbotFlowsList = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const flows = await prisma.metaWhatsappChatbotFlow.findMany({
            where: { userId, phoneNumberId: phoneNumberId as string },
            include: {
                user: {
                    select: { name: true, email: true }
                }
            },
            orderBy: { createdAt: 'desc' }
        });

        return res.json({ success: true, data: flows });
    } catch (err: any) {
        logger.error(`[Chatbot Flow List Controller] Get flows error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta-whatsapp/:phoneNumberId/chatbot-flows
export const createChatbotFlowList = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const userId = (req as any).user?.id;
        const { name, description } = req.body;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        if (!name) {
            return res.status(400).json({ success: false, message: "Flow name is required" });
        }

        // Check uniqueness
        const exists = await prisma.metaWhatsappChatbotFlow.findUnique({
            where: {
                userId_phoneNumberId_name: {
                    userId: userId as string,
                    phoneNumberId: phoneNumberId as string,
                    name: name.trim()
                }
            }
        });

        if (exists) {
            return res.status(400).json({ success: false, message: `A chatbot flow named "${name}" already exists.` });
        }

        const newFlow = await prisma.metaWhatsappChatbotFlow.create({
            data: {
                userId: userId as string,
                phoneNumberId: phoneNumberId as string,
                name: name.trim(),
                description: description || "",
                isActive: true
            },
            include: {
                user: {
                    select: { name: true, email: true }
                }
            }
        });

        return res.status(201).json({ success: true, message: "Chatbot flow created successfully", data: newFlow });
    } catch (err: any) {
        logger.error(`[Chatbot Flow List Controller] Create flow error: ${err.message}`);
        next(err);
    }
};

// PUT /api/meta-whatsapp/:phoneNumberId/chatbot-flows/:id
export const updateChatbotFlowList = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = (req as any).user?.id;
        const { name, description, isActive, layout } = req.body;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const flow = await prisma.metaWhatsappChatbotFlow.findFirst({
            where: { id: id as string, userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow not found or unauthorized" });
        }

        const updateData: any = {};

        if (name) {
            const trimmedName = name.trim();
            if (trimmedName !== flow.name) {
                const exists = await prisma.metaWhatsappChatbotFlow.findUnique({
                    where: {
                        userId_phoneNumberId_name: {
                            userId: userId as string,
                            phoneNumberId: phoneNumberId as string,
                            name: trimmedName
                        }
                    }
                });
                if (exists) {
                    return res.status(400).json({ success: false, message: `A chatbot flow named "${name}" already exists.` });
                }
                updateData.name = trimmedName;
            }
        }

        if (description !== undefined) updateData.description = description;
        if (isActive !== undefined) updateData.isActive = isActive;
        if (layout !== undefined) updateData.layout = layout;

        const updatedFlow = await prisma.metaWhatsappChatbotFlow.update({
            where: { id: id as string },
            data: updateData,
            include: {
                user: {
                    select: { name: true, email: true }
                }
            }
        });

        return res.json({ success: true, message: "Chatbot flow updated successfully", data: updatedFlow });
    } catch (err: any) {
        logger.error(`[Chatbot Flow List Controller] Update flow error: ${err.message}`);
        next(err);
    }
};

// DELETE /api/meta-whatsapp/:phoneNumberId/chatbot-flows/:id
export const deleteChatbotFlowList = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId, id } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const flow = await prisma.metaWhatsappChatbotFlow.findFirst({
            where: { id: id as string, userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!flow) {
            return res.status(404).json({ success: false, message: "Chatbot flow not found or unauthorized" });
        }

        await prisma.metaWhatsappChatbotFlow.delete({ where: { id: id as string } });

        const deleteResult = await prisma.metaWhatsappChatbot.deleteMany({
            where: { flowId: id as string, userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        logger.info(`[Chatbot Flow List Controller] Deleted flow "${flow.name}" and cascade-deleted ${deleteResult.count} rules`);

        return res.json({ success: true, message: "Chatbot flow and all associated rules deleted successfully" });
    } catch (err: any) {
        logger.error(`[Chatbot Flow List Controller] Delete flow error: ${err.message}`);
        next(err);
    }
};

// POST /api/meta-whatsapp/:phoneNumberId/chatbot-flows/test-api-request
export const testApiRequest = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { url, method = "POST", headers = [], params = [], body = {} } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, message: "API URL is required" });
        }

        let resolvedUrl = url.trim();
        if (resolvedUrl.startsWith("/") && (resolvedUrl.toLowerCase().startsWith("/http://") || resolvedUrl.toLowerCase().startsWith("/https://"))) {
            resolvedUrl = resolvedUrl.substring(1);
        }

        const headersObj: any = {
            "Content-Type": "application/json",
            "ngrok-skip-browser-warning": "69420"
        };
        
        if (Array.isArray(headers)) {
            headers.forEach((h: any) => {
                if (h.key && h.key.trim()) {
                    headersObj[h.key.trim()] = h.value || "";
                }
            });
        }

        const paramsObj: any = {};
        if (Array.isArray(params)) {
            params.forEach((p: any) => {
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
    } catch (err: any) {
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
