import express from "express";

import {
    getLogs,
    getLogById,
    getLogStats,
    exportLogs,
    getAnalytics,
    syncAnalytics,
} from "../controllers/metaWhatsappLog.controller.js";

import { isAuthenticated } from "../../middleware/authMiddleware.js";

const metaWhatsappLogRouter = express.Router();

// All routes require authentication
metaWhatsappLogRouter.use(isAuthenticated);

// ── Stats (must be before /:id to avoid matching "stats" as an ID) ───────────
metaWhatsappLogRouter.get("/stats", getLogStats);

// ── Export ────────────────────────────────────────────────────────────────────
metaWhatsappLogRouter.post("/export", exportLogs);

// ── Analytics ─────────────────────────────────────────────────────────────────
metaWhatsappLogRouter.get("/analytics", getAnalytics);
metaWhatsappLogRouter.post("/analytics/sync", syncAnalytics);

// ── Collection routes ─────────────────────────────────────────────────────────
metaWhatsappLogRouter.get("/", getLogs);

// ── Single resource routes ────────────────────────────────────────────────────
metaWhatsappLogRouter.get("/:id", getLogById);

export default metaWhatsappLogRouter;
