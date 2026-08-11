import { Router } from "express";
import {
  getWhatsAppNumbers,
  addWhatsAppNumber,
  deleteWhatsAppNumber,
  getTemplates,
  syncTemplates,
  getContactLists,
  createContactList,
  uploadContacts,
  getCampaigns,
  createCampaign,
} from "../controllers/metaWhatsapp.controller";

import {
  getChatbotFlowsList,
  createChatbotFlowList,
  updateChatbotFlowList,
  deleteChatbotFlowList,
  testApiRequest
} from "../controllers/metaWhatsappChatbotFlow.controller";

import {
  getChatbotFlows,
  createChatbotFlow,
  updateChatbotFlow,
  deleteChatbotFlow
} from "../controllers/metaWhatsappChatbot.controller";

import {
  getInteractiveMessages,
  createInteractiveMessage,
  updateInteractiveMessage,
  deleteInteractiveMessage,
  sendInteractiveMessage
} from "../controllers/metaWhatsappInteractive.controller";

import {
  connectEmbeddedWhatsappOnboarding
} from "../controllers/metaWhatsappOnboarding.controller";

import {
  listApiKeys,
  generateApiKey,
  regenerateApiKey,
  revokeApiKey
} from "../controllers/whatsappApiKey.controller";

import {
  getLogs,
  getLogStats,
  getAnalytics,
  syncAnalytics,
  exportLogs,
  getLogById
} from "../controllers/metaWhatsappLog.controller";

import {
  getAllPricings,
  createPricing,
  updatePricing,
  deletePricing
} from "../controllers/metaWhatsappPricing.controller";

import {
  getTemplateLibrary,
  seedTemplateLibrary
} from "../controllers/metaWhatsappTemplateLibrary.controller";

import {
  publicSendTemplate,
  publicSendInteractive
} from "../controllers/metaWhatsappPublic.controller";

import {
  verifyWebhook,
  handleWebhook
} from "../controllers/metaWebhook.controller";

const router = Router();

// ─── NUMBERS ──────────────────────────────────────────────
router.get("/numbers", getWhatsAppNumbers);
router.post("/numbers", addWhatsAppNumber);
router.delete("/numbers/:id", deleteWhatsAppNumber);

// ─── TEMPLATES ────────────────────────────────────────────
router.get("/templates", getTemplates);
router.post("/templates/sync", syncTemplates);

// ─── CONTACT LISTS ────────────────────────────────────────
router.get("/lists", getContactLists);
router.post("/lists", createContactList);
router.post("/lists/:listId/contacts", uploadContacts);

// ─── CAMPAIGNS ────────────────────────────────────────────
router.get("/campaigns", getCampaigns);
router.post("/campaigns", createCampaign);

// ─── CHATBOT FLOWS & RULES ──────────────────────────────────
router.get("/:phoneNumberId/chatbot-flows", getChatbotFlowsList);
router.post("/:phoneNumberId/chatbot-flows", createChatbotFlowList);
router.put("/:phoneNumberId/chatbot-flows/:id", updateChatbotFlowList);
router.delete("/:phoneNumberId/chatbot-flows/:id", deleteChatbotFlowList);
router.post("/:phoneNumberId/chatbot-flows/test-api-request", testApiRequest);

router.get("/:phoneNumberId/chatbot", getChatbotFlows);
router.post("/:phoneNumberId/chatbot", createChatbotFlow);
router.put("/:phoneNumberId/chatbot/:id", updateChatbotFlow);
router.delete("/:phoneNumberId/chatbot/:id", deleteChatbotFlow);

// ─── INTERACTIVE MESSAGES ─────────────────────────────────
router.get("/:phoneNumberId/interactive", getInteractiveMessages);
router.post("/:phoneNumberId/interactive", createInteractiveMessage);
router.put("/:phoneNumberId/interactive/:id", updateInteractiveMessage);
router.delete("/:phoneNumberId/interactive/:id", deleteInteractiveMessage);
router.post("/:phoneNumberId/interactive/:id/send", sendInteractiveMessage);

// ─── ONBOARDING ───────────────────────────────────────────
router.post("/onboarding/connect", connectEmbeddedWhatsappOnboarding);

// ─── API KEYS ─────────────────────────────────────────────
router.get("/api-keys", listApiKeys);
router.post("/api-keys", generateApiKey);
router.post("/api-keys/:id/regenerate", regenerateApiKey);
router.post("/api-keys/:id/revoke", revokeApiKey);

// ─── LOGS & ANALYTICS ─────────────────────────────────────
router.get("/logs", getLogs);
router.get("/logs/stats", getLogStats);
router.get("/logs/analytics", getAnalytics);
router.post("/logs/analytics/sync", syncAnalytics);
router.post("/logs/export", exportLogs);
router.get("/logs/:id", getLogById);

// ─── PRICING ──────────────────────────────────────────────
router.get("/pricing", getAllPricings);
router.post("/pricing", createPricing);
router.put("/pricing/:id", updatePricing);
router.delete("/pricing/:id", deletePricing);

// ─── TEMPLATE LIBRARY ─────────────────────────────────────
router.get("/template-library", getTemplateLibrary);
router.post("/template-library/seed", seedTemplateLibrary);

// ─── PUBLIC API ───────────────────────────────────────────
// Note: These routes should be protected by an API Key middleware in a production setup
router.post("/send-template", publicSendTemplate);
router.post("/send-interactive", publicSendInteractive);

// ─── WEBHOOKS ─────────────────────────────────────────────
router.get("/webhook", verifyWebhook);
router.post("/webhook", handleWebhook);

export default router;
