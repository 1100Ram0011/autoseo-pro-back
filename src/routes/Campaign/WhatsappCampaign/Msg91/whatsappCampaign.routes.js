import express from "express";
import {
  addWhatsappClient,
  connectEmbeddedWhatsapp,
  getAllCampaigns,
  getCampaignStatus,
  getMsg91WhatsappLogs,
  sendCampaign,
  syncMsg91CampaignLogs,
} from "../../../../controllers/Campaign/WhatsappCampaign/Msg91/whatsappCampaign.controller.js";
import { isAuthenticated } from "../../../../middleware/authMiddleware.js";
import { checkPlanAccess } from "../../../../middleware/planMiddleware.js";

const waCampaignRouter = express.Router();

waCampaignRouter.post("/sync-logs/:campaignId", isAuthenticated, syncMsg91CampaignLogs);

// POST /api/whatsapp/campaign/send
waCampaignRouter.post(
  "/send",
  isAuthenticated,
  // checkPlanAccess("campaigns"),
  sendCampaign,
);

// GET /api/whatsapp/campaign/
// ⚠️ Must be defined BEFORE /:campaignId — otherwise Express matches "/" as a param
waCampaignRouter.get("/", isAuthenticated, getAllCampaigns);

waCampaignRouter.get("/msg91-logs", isAuthenticated, getMsg91WhatsappLogs);

// GET /api/whatsapp/campaign/:campaignId
waCampaignRouter.get("/:campaignId", isAuthenticated, getCampaignStatus);

waCampaignRouter.post("/add-client", isAuthenticated, addWhatsappClient);

// ADD this route alongside your existing WhatsApp routes
waCampaignRouter.post('/connect-embedded', isAuthenticated, connectEmbeddedWhatsapp)

export default waCampaignRouter;
