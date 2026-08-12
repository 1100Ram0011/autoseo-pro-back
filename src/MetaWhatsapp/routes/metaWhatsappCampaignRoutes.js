import express from "express";

import {
    getCampaigns,
    getCampaignById,
    createCampaign,
    launchCampaign,
    pauseCampaignCtrl,
    resumeCampaignCtrl,
    cancelCampaign,
    deleteCampaign,
    getCampaignStats,
    estimateMetaCampaign,
} from "../controllers/metaWhatsappCampaign.controller.js";

import { isAuthenticated } from "../../middleware/authMiddleware.js";

const metaWhatsappCampaignRouter = express.Router();

// All routes require authentication
metaWhatsappCampaignRouter.use(isAuthenticated);

metaWhatsappCampaignRouter.post("/estimate", estimateMetaCampaign);

// ── Collection routes ──────────────────────────────────────────────────────────
metaWhatsappCampaignRouter
    .route("/")
    .get(getCampaigns)
    .post(createCampaign);

// ── Action routes (must be before /:id) ───────────────────────────────────────
metaWhatsappCampaignRouter.post("/:id/launch", launchCampaign);
metaWhatsappCampaignRouter.post("/:id/pause", pauseCampaignCtrl);
metaWhatsappCampaignRouter.post("/:id/resume", resumeCampaignCtrl);
metaWhatsappCampaignRouter.post("/:id/cancel", cancelCampaign);
metaWhatsappCampaignRouter.get("/:id/stats", getCampaignStats);

// ── Single resource routes ─────────────────────────────────────────────────────
metaWhatsappCampaignRouter
    .route("/:id")
    .get(getCampaignById)
    .delete(deleteCampaign);

export default metaWhatsappCampaignRouter;