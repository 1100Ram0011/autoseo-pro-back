import express from "express";
import {
    createAITemplate,
    updateAITemplate,
    deleteAITemplate,
    getAllAITemplatesAdmin,
    getActiveAITemplates,
    getAITemplateById,
    useAITemplate,
    generateAITemplate,
} from "../../../controllers/Campaign/EmailCampaign/aiTemplate.controller.js";

import {
    isAuthenticated,
    authorizeRoles,
} from "../../../middleware/authMiddleware.js";
import { restrictGuestAccess } from "../../../middleware/restrictGuestAccess.js";

const AIEmailTemplateRouter = express.Router();

// ─────────────────────────────────────────────
//  PUBLIC / USER ROUTES (authenticated users)
// ─────────────────────────────────────────────

// Browse active AI templates
AIEmailTemplateRouter.get(
    "/",
    isAuthenticated,
    authorizeRoles("user", "admin"),
    getActiveAITemplates
);

// Get single AI template details
AIEmailTemplateRouter.get(
    "/:id",
    isAuthenticated,
    authorizeRoles("user", "admin"),
    getAITemplateById
);

// Copy AI template to user's own templates
AIEmailTemplateRouter.post(
    "/:id/use",
    isAuthenticated,
    authorizeRoles("user", "admin"),
    restrictGuestAccess,
    useAITemplate
);

// Generate AI template from prompt (user gets personal, admin gets global)
AIEmailTemplateRouter.post(
    "/generate",
    isAuthenticated,
    authorizeRoles("user", "admin"),
    restrictGuestAccess,
    generateAITemplate
);

// ─────────────────────────────────────────────
//  ADMIN ROUTES
// ─────────────────────────────────────────────

// Get all AI templates (admin view, includes inactive)
AIEmailTemplateRouter.get(
    "/admin/all",
    isAuthenticated,
    authorizeRoles("admin"),
    getAllAITemplatesAdmin
);

// Create new AI template
AIEmailTemplateRouter.post(
    "/admin",
    isAuthenticated,
    authorizeRoles("admin"),
    createAITemplate
);

// Update AI template
AIEmailTemplateRouter.put(
    "/admin/:id",
    isAuthenticated,
    authorizeRoles("admin"),
    updateAITemplate
);

// Delete AI template (soft delete)
AIEmailTemplateRouter.delete(
    "/admin/:id",
    isAuthenticated,
    authorizeRoles("admin"),
    deleteAITemplate
);

export default AIEmailTemplateRouter;
