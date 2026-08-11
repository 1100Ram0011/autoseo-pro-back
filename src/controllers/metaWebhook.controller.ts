import { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { logger } from "../config/logger";

const prisma = new PrismaClient();

// GET /api/meta-whatsapp/webhook
export const verifyWebhook = (req: Request, res: Response): any => {
    try {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];

        // The verify token should match the one configured in Meta App Dashboard
        const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN || "mytekai_secret_token";

        if (mode && token) {
            if (mode === "subscribe" && token === VERIFY_TOKEN) {
                logger.info("[Webhook] Webhook verified successfully");
                return res.status(200).send(challenge);
            } else {
                logger.warn("[Webhook] Webhook verification failed (Token mismatch)");
                return res.sendStatus(403);
            }
        }
        return res.sendStatus(400);
    } catch (error: any) {
        logger.error(`[Webhook] Verification error: ${error.message}`);
        return res.sendStatus(500);
    }
};

// POST /api/meta-whatsapp/webhook
export const handleWebhook = async (req: Request, res: Response): Promise<any> => {
    try {
        const body = req.body;

        if (body.object !== "whatsapp_business_account") {
            return res.sendStatus(404);
        }

        // Return 200 OK immediately to Meta to prevent retries
        res.status(200).send("EVENT_RECEIVED");

        if (body.entry && body.entry[0].changes && body.entry[0].changes[0].value) {
            const changeValue = body.entry[0].changes[0].value;
            const phoneNumberId = changeValue.metadata?.phone_number_id;

            if (!phoneNumberId) {
                logger.warn("[Webhook] No phone_number_id found in payload");
                return;
            }

            // Find the token based on phoneNumberId
            const waToken = await prisma.whatsAppToken.findFirst({
                where: { phoneNumberId, status: "active" }
            });

            if (!waToken) {
                logger.warn(`[Webhook] No active token found for phone_number_id: ${phoneNumberId}`);
                return;
            }

            // ─── HANDLE STATUS UPDATES (Sent, Delivered, Read, Failed) ───
            if (changeValue.statuses && changeValue.statuses.length > 0) {
                for (const status of changeValue.statuses) {
                    await handleStatusUpdate(waToken, status);
                }
            }

            // ─── HANDLE INCOMING MESSAGES ───
            if (changeValue.messages && changeValue.messages.length > 0) {
                const contact = changeValue.contacts?.[0];
                for (const message of changeValue.messages) {
                    await handleIncomingMessage(waToken, message, contact);
                }
            }
        }
    } catch (error: any) {
        logger.error(`[Webhook] Handling error: ${error.message}`);
    }
};

// --- Helper Functions (Stubs for the complex 1000-line logic) ---

async function handleStatusUpdate(waToken: any, statusObj: any) {
    try {
        const { id, status, recipient_id, timestamp, pricing, errors } = statusObj;
        logger.info(`[Webhook] Status update: ${status} for message ${id}`);
        
        // TODO: Update log status in database
        // await prisma.whatsAppLog.updateMany({
        //     where: { messageId: id },
        //     data: { status, [status + "At"]: new Date(timestamp * 1000) }
        // });
    } catch (error: any) {
        logger.error(`[Webhook] Status update error: ${error.message}`);
    }
}

async function handleIncomingMessage(waToken: any, message: any, contact: any) {
    try {
        const { from, id, type, timestamp } = message;
        logger.info(`[Webhook] Incoming message from ${from} of type ${type}`);

        // TODO: 
        // 1. Log inbound message to Database
        // 2. Check for Chatbot Rules / Keywords
        // 3. Process AI / Dialogflow Fallback if enabled
        // 4. Send Interactive / Template / Text reply if triggered
        
    } catch (error: any) {
        logger.error(`[Webhook] Incoming message error: ${error.message}`);
    }
}
