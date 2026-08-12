import logger from "../../../../config/logger.js";
import { generateWithOpenAI } from "../../../../services/aiService.js";
import axios from "axios";

export const handleMsg91Webhook = async (req, res) => {
    try {
        // MSG91 webhooks typically send an array of events or a single event
        // The exact format of MSG91 inbound interactive message:
        const data = req.body;
        logger.info(`[MSG91 Webhook] Received payload: ${JSON.stringify(data)}`);

        // Acknowledge receipt to MSG91 immediately to prevent retries
        res.status(200).send("OK");

        // Assuming standard interactive payload format where button payload is passed
        // This handles cases where MSG91 forwards the WhatsApp inbound message
        // WhatsApp inbound usually looks like this (Meta format, often mirrored by MSG91):
        // data.entry[0].changes[0].value.messages[0]
        // or MSG91 specific format depending on configuration.
        // We will try to parse generic MSG91/WhatsApp webhook payloads.

        let messages = [];
        if (data?.entry) {
            // Meta style inbound
            const entry = data.entry[0];
            const changes = entry?.changes?.[0];
            const value = changes?.value;
            if (value?.messages) {
                messages = value.messages;
            }
        } else if (data?.messages) {
            // MSG91 specific format
            messages = data.messages;
        } else if (Array.isArray(data)) {
            messages = data;
        } else if (data?.text || data?.interactive || data?.button) {
            messages = [data];
        }

        for (const message of messages) {
            const senderPhone = message.from || message.sender; // customer's phone
            const receiverPhone = data.wabaNumber || data.receiver || "YOUR_WABA_NUMBER"; // business phone

            // Check if it's an interactive button reply (Quick Reply)
            let payload = null;

            if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
                payload = message.interactive.button_reply.id; // Meta format uses .id for payload
                if (!payload) payload = message.interactive.button_reply.payload;
            } else if (message.type === 'button') {
                payload = message.button?.payload || message.button?.text;
            } else if (message.context?.payload) {
                payload = message.context.payload;
            } else if (message.button_reply) {
                payload = message.button_reply.id || message.button_reply.payload;
            }

            if (payload) {
                logger.info(`[MSG91 Webhook] User clicked Quick Reply with payload: ${payload}`);

                // Send to ChatGPT
                const aiPrompt = `The user clicked a WhatsApp Quick Reply button with the payload/ID: "${payload}". Please generate a brief, friendly, and helpful text response to send back to the user acknowledging their choice. Do not use markdown.`;

                try {
                    const aiResponse = await generateWithOpenAI({
                        systemPrompt: "You are an AI assistant for a business managing WhatsApp communications. Keep responses very short (1-2 sentences), professional, and directly address the user's quick reply choice.",
                        userPrompt: aiPrompt
                    });

                    // Send the AI response back to the user via MSG91 API
                    if (aiResponse && senderPhone) {
                        const msg91Payload = {
                            integrated_number: receiverPhone,
                            content_type: "text",
                            payload: {
                                messaging_product: "whatsapp",
                                recipient_type: "individual",
                                to: senderPhone,
                                type: "text",
                                text: {
                                    body: aiResponse
                                }
                            }
                        };

                        const MSG91_AUTH_KEY = process.env.MSG91_AUTHKEY;
                        const MSG91_BASE_URL = "https://control.msg91.com/api/v5";

                        await axios.post(
                            `${MSG91_BASE_URL}/whatsapp/whatsapp-outbound-message/`,
                            msg91Payload,
                            {
                                headers: {
                                    "Content-Type": "application/json",
                                    "authkey": MSG91_AUTH_KEY,
                                }
                            }
                        );
                        logger.info(`[MSG91 Webhook] Sent ChatGPT reply to ${senderPhone}: ${aiResponse}`);
                    }
                } catch (aiError) {
                    logger.error(`[MSG91 Webhook] Error generating or sending AI reply: ${aiError.message}`);
                }
            } else {
                logger.info(`[MSG91 Webhook] No button payload found in message. Message type: ${message.type}`);
            }
        }

    } catch (error) {
        logger.error(`[MSG91 Webhook] Unhandled error: ${error.message}`);
        if (!res.headersSent) {
            res.status(500).send("Internal Server Error");
        }
    }
};
