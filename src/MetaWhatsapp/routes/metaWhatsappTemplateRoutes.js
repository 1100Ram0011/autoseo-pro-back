import express from "express";

import {
    upload,
    metaUploadMedia,
    metaGetTemplates,
    metaCreateTemplate,
    metaUpdateTemplate,
    metaSubmitTemplate,
    metaCloneTemplate,
    metaSyncTemplate,
    getMetaActivation,
    metaDeleteTemplate
} from "../controllers/metaWhatsappTemplate.controller.js";

import { isAuthenticated } from "../../middleware/authMiddleware.js";

const metaWhatsappTemplateRouter = express.Router();

// All routes require authentication
metaWhatsappTemplateRouter.use(isAuthenticated);

// ── Utility routes (no :id — must be declared before /:id) ────────────────────
metaWhatsappTemplateRouter.get("/activation", getMetaActivation);
metaWhatsappTemplateRouter.post("/upload-media", upload.single("media"), metaUploadMedia);

// ── Collection routes ──────────────────────────────────────────────────────────
metaWhatsappTemplateRouter
    .route("/")
    .get(metaGetTemplates)
    .post(metaCreateTemplate);

// ── Action routes (declared before /:id to avoid param collision) ──────────────
metaWhatsappTemplateRouter.post("/:id/submit", metaSubmitTemplate);
metaWhatsappTemplateRouter.post("/:id/clone", metaCloneTemplate);
metaWhatsappTemplateRouter.post("/:id/sync", metaSyncTemplate);

// ── Single resource routes ─────────────────────────────────────────────────────
metaWhatsappTemplateRouter
    .route("/:id")
    .patch(metaUpdateTemplate)
    .delete(metaDeleteTemplate);

export default metaWhatsappTemplateRouter;