import express from "express";
import upload from "../../../utils/upload.js";
import {
    createCampaign,
    deleteCampaign,
    getCampaignById,
    getCampaigns,
    getCampaignLogs,
    stopCampaign,
} from "../../../controllers/Campaign/EmailCampaign/campaign.controller.js";
import { isAuthenticated } from "../../../middleware/authMiddleware.js";
import { handleUnsubscribe, handleUnsubscribeConfirm } from "../../../controllers/Campaign/EmailConnectors/unsubscribeController.js";
import { checkPlanAccess } from "../../../middleware/planMiddleware.js";

const CampaignRouter = express.Router();

// CampaignRouter.get('/api/unsubscribe', handleUnsubscribeConfirm);

// CampaignRouter.get("/unsubscribe", handleUnsubscribe);

import { trackOpen, trackClick } from "../../../controllers/Campaign/EmailCampaign/trackingController.js";

CampaignRouter.get("/unsubscribe", handleUnsubscribeConfirm);
CampaignRouter.post("/unsubscribe", handleUnsubscribe);

CampaignRouter.get("/track/open/:logId", trackOpen);
CampaignRouter.get("/track/click/:logId", trackClick);

CampaignRouter.post("/create", upload.single("file"), isAuthenticated, checkPlanAccess("campaigns"), createCampaign);
CampaignRouter.get("/", isAuthenticated, getCampaigns);
CampaignRouter.get("/:id", isAuthenticated, getCampaignById);
CampaignRouter.get("/:id/logs", isAuthenticated, getCampaignLogs);
CampaignRouter.post("/:id/stop", isAuthenticated, stopCampaign);
CampaignRouter.delete("/:id", isAuthenticated, deleteCampaign);



export default CampaignRouter;
