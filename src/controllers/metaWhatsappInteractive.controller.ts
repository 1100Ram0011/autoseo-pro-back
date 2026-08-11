import { Request, Response, NextFunction } from "express";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

// GET /api/meta-whatsapp/:phoneNumberId/interactive
export const getInteractiveMessages = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const numberDoc = await prisma.whatsAppToken.findFirst({
            where: { userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!numberDoc) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const items = await prisma.metaWhatsappInteractive.findMany({
            where: { userId, numberId: numberDoc.id },
            orderBy: { createdAt: 'desc' }
        });

        return res.json({ success: true, data: items });
    } catch (err) {
        next(err);
    }
};

// POST /api/meta-whatsapp/:phoneNumberId/interactive
export const createInteractiveMessage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId } = req.params;
        const { name, type, headerText, bodyText, footerText, buttons, listButtonText, sections } = req.body;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const numberDoc = await prisma.whatsAppToken.findFirst({
            where: { userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!numberDoc) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const newItem = await prisma.metaWhatsappInteractive.create({
            data: {
                userId,
                numberId: numberDoc.id,
                name,
                type,
                headerText: headerText || "",
                bodyText,
                footerText: footerText || "",
                buttons: type === 'button' ? buttons : undefined,
                listButtonText: type === 'list' ? listButtonText : undefined,
                sections: type === 'list' ? sections : undefined
            }
        });

        return res.status(201).json({ success: true, message: "Interactive message template saved", data: newItem });
    } catch (err) {
        next(err);
    }
};

// DELETE /api/meta-whatsapp/:phoneNumberId/interactive/:id
export const deleteInteractiveMessage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { id } = req.params;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const item = await prisma.metaWhatsappInteractive.findFirst({
            where: { id: id as string, userId: userId as string }
        });

        if (!item) {
            return res.status(404).json({ success: false, message: "Interactive message not found or unauthorized" });
        }

        await prisma.metaWhatsappInteractive.delete({
            where: { id: id as string }
        });

        return res.json({ success: true, message: "Interactive message deleted successfully" });
    } catch (err) {
        next(err);
    }
};

// POST /api/meta-whatsapp/:phoneNumberId/interactive/:id/send
export const sendInteractiveMessage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { phoneNumberId, id } = req.params;
        const { to } = req.body; // recipient phone number
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        if (!to) {
            return res.status(400).json({ success: false, message: "Recipient phone number 'to' is required" });
        }

        const credentials = await prisma.whatsAppToken.findFirst({
            where: { userId: userId as string, phoneNumberId: phoneNumberId as string }
        });

        if (!credentials) {
            return res.status(404).json({ success: false, message: "WhatsApp number not connected or unauthorized" });
        }

        const item = await prisma.metaWhatsappInteractive.findFirst({
            where: { id: id as string, userId: userId as string }
        });

        if (!item) {
            return res.status(404).json({ success: false, message: "Interactive message template not found" });
        }

        const interactivePayload: any = {
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
                buttons: ((item.buttons as any[]) || []).map((btn: any, idx: number) => {
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
                sections: ((item.sections as any[]) || []).map((sec: any) => ({
                    title: sec.title || "",
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
                            title: row.title,
                            description: row.description || ""
                        };
                    })
                }))
            };
        }

        // Send via Meta Graph API
        const response = await axios.post(
            `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
            {
                messaging_product: "whatsapp",
                recipient_type: "individual",
                to,
                type: "interactive",
                interactive: interactivePayload
            },
            {
                headers: {
                    Authorization: `Bearer ${credentials.accessToken}`,
                    "Content-Type": "application/json"
                }
            }
        );

        return res.json({ 
            success: true, 
            message: "Interactive message sent successfully", 
            messageId: response.data?.messages?.[0]?.id 
        });
    } catch (err: any) {
        logger.error(`[Send Interactive Error] ${req.params.id} -> ${req.body?.to}: ${err.message}`);
        return res.status(err.response?.status || 500).json({
            success: false,
            message: "Failed to send interactive message via Meta Graph API",
            error: err.response?.data || err.message
        });
    }
};

// PUT /api/meta-whatsapp/:phoneNumberId/interactive/:id
export const updateInteractiveMessage = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { id } = req.params;
        const { name, type, headerText, bodyText, footerText, buttons, listButtonText, sections } = req.body;
        const userId = (req as any).user?.id;

        if (!userId) return res.status(401).json({ success: false, message: "Unauthorized" });

        const item = await prisma.metaWhatsappInteractive.findFirst({
            where: { id: id as string, userId: userId as string }
        });

        if (!item) {
            return res.status(404).json({ success: false, message: "Interactive message not found or unauthorized" });
        }

        const updated = await prisma.metaWhatsappInteractive.update({
            where: { id: id as string },
            data: {
                name,
                type,
                headerText: headerText || "",
                bodyText,
                footerText: footerText || "",
                buttons: type === 'button' ? buttons : undefined,
                listButtonText: type === 'list' ? listButtonText : undefined,
                sections: type === 'list' ? sections : undefined
            }
        });

        return res.json({ success: true, message: "Interactive message updated successfully", data: updated });
    } catch (err) {
        next(err);
    }
};
