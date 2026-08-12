import express
    from "express";

import {
    estimateCampaign,
    createCampaign,
    getCampaigns,
    getCampaign,
    pauseCampaign,
    resumeCampaign,
    stopCampaign,
    getCampaignAnalytics,
    getCampaignConnections,
} from "../controllers/whatsappCampaign.controller.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const router =
    express.Router();

router.use(isAuthenticated)

router.post(
    "/estimate",
    estimateCampaign
);

router.get(
    "/campaign-connections",
    getCampaignConnections
);


router.post(
    "/",
    createCampaign
);

router.get(
    "/",
    getCampaigns
);

router.get(
    "/:campaignId",
    getCampaign
);

router.patch(
    "/:campaignId/pause",
    pauseCampaign
);

router.patch(
    "/:campaignId/resume",
    resumeCampaign
);

router.patch(
    "/:campaignId/stop",
    stopCampaign
);

router.get(
    "/:campaignId/analytics",
    getCampaignAnalytics
);


export default router;