import express from "express";

import multer from "multer";

import {
    connectMeta,
    metaCallback,
    fetchWabaNumbers,
    fetchConnectedNumber,
    disconnectConnectedNumber,
    syncNumberMessagingLimit,
    testCreditLineId,
} from "../controllers/metaAuthWhatsapp.controller.js";
import {
    getBusinessProfile,
    updateBusinessProfile,
    uploadProfilePhoto,
} from "../controllers/metaBusinessProfile.controller.js";
import { connectEmbeddedWhatsappOnboarding } from "../controllers/metaWhatsappOnboarding.controller.js";
import {
    getConversationalAutomation,
    updateConversationalAutomation
} from "../controllers/metaConversationalAutomation.controller.js";
import {
    getInteractiveMessages,
    createInteractiveMessage,
    deleteInteractiveMessage,
    sendInteractiveMessage,
    updateInteractiveMessage
} from "../controllers/metaWhatsappInteractive.controller.js";
import {
    getChatbotFlows,
    createChatbotFlow,
    updateChatbotFlow,
    deleteChatbotFlow
} from "../controllers/metaWhatsappChatbot.controller.js";
import {
    getChatbotFlowsList,
    createChatbotFlowList,
    updateChatbotFlowList,
    deleteChatbotFlowList,
    duplicateChatbotFlowList,
    testApiRequest
} from "../controllers/metaWhatsappChatbotFlow.controller.js";
import { verifyMetaWebhook, handleMetaWebhook } from "../controllers/metaWebhook.controller.js";
import {
    getTemplateLibrary,
    seedTemplateLibrary,
} from "../controllers/metaWhatsappTemplateLibrary.controller.js";
import { isAuthenticated } from "../../middleware/authMiddleware.js";
import { sendTemplateMessage } from "../services/metaWhatsapp.services.js";
import WhatsAppToken from "../models/metaWhatsappCampaignTokenSchema.js";
import metaNumberSettingsRoutes from "./metaNumberSettings.routes.js";

const metaWhatsappRouter = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

metaWhatsappRouter.get("/webhook", verifyMetaWebhook);
metaWhatsappRouter.post("/webhook", handleMetaWebhook);

metaWhatsappRouter.post("/connect", isAuthenticated, connectMeta);

metaWhatsappRouter.get("/callback", metaCallback);

metaWhatsappRouter.get("/connected-number", isAuthenticated, fetchConnectedNumber);
metaWhatsappRouter.delete("/connected-number/:id", isAuthenticated, disconnectConnectedNumber);
metaWhatsappRouter.post("/sync-limit/:id", isAuthenticated, syncNumberMessagingLimit);
metaWhatsappRouter.get("/template-library", isAuthenticated, getTemplateLibrary);
metaWhatsappRouter.post("/template-library/seed", isAuthenticated, seedTemplateLibrary);

// ── Business Profile ──
metaWhatsappRouter.get("/:phoneNumberId/business-profile", isAuthenticated, getBusinessProfile);
metaWhatsappRouter.post("/:phoneNumberId/business-profile", isAuthenticated, updateBusinessProfile);
metaWhatsappRouter.post("/:phoneNumberId/business-profile/photo", isAuthenticated, upload.single("photo"), uploadProfilePhoto);

// ── Phone Settings (Retry, MM Lite, Auto Disable, etc.) ──
metaWhatsappRouter.use("/settings", isAuthenticated, metaNumberSettingsRoutes);

// ── Logs ──
metaWhatsappRouter.get("/test-credit-line", testCreditLineId);

metaWhatsappRouter.post("/fetch-waba", fetchWabaNumbers);

metaWhatsappRouter.post("/embedded/connect", isAuthenticated, connectEmbeddedWhatsappOnboarding);

metaWhatsappRouter.get("/:phoneNumberId/conversational-automation", isAuthenticated, getConversationalAutomation);
metaWhatsappRouter.post("/:phoneNumberId/conversational-automation", isAuthenticated, updateConversationalAutomation);

metaWhatsappRouter.get("/:phoneNumberId/interactive", isAuthenticated, getInteractiveMessages);
metaWhatsappRouter.post("/:phoneNumberId/interactive", isAuthenticated, createInteractiveMessage);
metaWhatsappRouter.delete("/:phoneNumberId/interactive/:id", isAuthenticated, deleteInteractiveMessage);
metaWhatsappRouter.put("/:phoneNumberId/interactive/:id", isAuthenticated, updateInteractiveMessage);
metaWhatsappRouter.post("/:phoneNumberId/interactive/:id/send", isAuthenticated, sendInteractiveMessage);

// Chatbot Flow Builder Routes
metaWhatsappRouter.get("/:phoneNumberId/chatbot", isAuthenticated, getChatbotFlows);
metaWhatsappRouter.post("/:phoneNumberId/chatbot", isAuthenticated, createChatbotFlow);
metaWhatsappRouter.put("/:phoneNumberId/chatbot/:id", isAuthenticated, updateChatbotFlow);
metaWhatsappRouter.delete("/:phoneNumberId/chatbot/:id", isAuthenticated, deleteChatbotFlow);

// Chatbot Flow List Routes
metaWhatsappRouter.get("/:phoneNumberId/chatbot-flows", isAuthenticated, getChatbotFlowsList);
metaWhatsappRouter.post("/:phoneNumberId/chatbot-flows", isAuthenticated, createChatbotFlowList);
metaWhatsappRouter.put("/:phoneNumberId/chatbot-flows/:id", isAuthenticated, updateChatbotFlowList);
metaWhatsappRouter.delete("/:phoneNumberId/chatbot-flows/:id", isAuthenticated, deleteChatbotFlowList);
metaWhatsappRouter.post("/:phoneNumberId/chatbot-flows/:id/duplicate", isAuthenticated, duplicateChatbotFlowList);
metaWhatsappRouter.post("/:phoneNumberId/chatbot-flows/test-api-request", isAuthenticated, testApiRequest);

// Demo API for Chatbot integration testing
metaWhatsappRouter.post("/demo-register", (req, res) => {
    console.log("[Demo API] Received chatbot request body:", req.body);
    const incomingName = req.body.name || req.body.Name || "";
    return res.status(200).json({
        status: "success",
        name: incomingName,
        city: "Mumbai",
        rate: "500",
        EnquiryNumber: "EQ-" + Math.floor(Math.random() * 900000 + 100000),
        district: "Thane",
        unit: "4",
        pincode: "400601",
        state: "Maharashtra"
    });
});

// Supplier Lookup API for Chatbot Meta Template Flow
metaWhatsappRouter.post("/supplier-lookup", (req, res) => {
    console.log("[Supplier Lookup API] Received body:", req.body);
    const email = req.body.email || "";
    const phone = req.body.senderPhone || req.body.phone || "919876543210";
    
    return res.status(200).json({
        status: "success",
        name: req.body.name || "Rahul Sharma",
        company: "Acme Procurement Pvt Ltd",
        phone: phone,
        gst: "27AAAAA0000A1Z5",
        pan: "ABCDE1234F"
    });
});

metaWhatsappRouter.post("/send-template-reply", async (req, res) => {
    try {
        console.log("[Send Template API] Received request:", req.body);
        const { to, templateName, templateLanguage, phoneNumberId, components } = req.body;

        if (!to || !templateName || !phoneNumberId) {
            return res.status(400).json({ error: "Missing required fields: to, templateName, phoneNumberId" });
        }

        // Fetch credentials
        const credentials = await WhatsAppToken.findOne({ phoneNumberId }).select("+accessToken");
        const accessToken = credentials?.accessToken || process.env.META_WHATSAPP_ACCESS_TOKEN;

        if (!accessToken) {
            return res.status(401).json({ error: "No Meta access token available" });
        }

        const result = await sendTemplateMessage({
            phoneNumberId,
            to,
            templateName,
            templateLanguage: templateLanguage || "en",
            components: components || [],
            accessToken
        });

        return res.status(200).json({ status: "success", result });
    } catch (err) {
        console.error("[Send Template API] Error:", err.message);
        return res.status(500).json({ error: err.message });
    }
});

// ── API Key Management (Developers) ───────────────────────────
import {
    listApiKeys,
    generateApiKey,
    regenerateApiKey,
    revokeApiKey,
} from "../controllers/whatsappApiKey.controller.js";

metaWhatsappRouter.get("/api-keys", isAuthenticated, listApiKeys);
metaWhatsappRouter.post("/api-keys/generate", isAuthenticated, generateApiKey);
metaWhatsappRouter.post("/api-keys/:id/regenerate", isAuthenticated, regenerateApiKey);
metaWhatsappRouter.post("/api-keys/:id/revoke", isAuthenticated, revokeApiKey);

export default metaWhatsappRouter;
