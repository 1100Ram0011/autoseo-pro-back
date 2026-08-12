import express from "express";
import {
    createTemplate,
    getTemplates,
    getTemplateById,
    updateTemplate,
    deleteTemplate,
} from "../../../controllers/Campaign/EmailCampaign/template.controller.js";

import { isAuthenticated, authorizeRoles, } from "../../../middleware/authMiddleware.js";
import { templateUpload } from "../../../utils/templateUpload.js";
import { checkPlanAccess } from "../../../middleware/planMiddleware.js";
import { restrictGuestAccess } from "../../../middleware/restrictGuestAccess.js";

const EmailTemplateRouter = express.Router();

// Protect all routes
EmailTemplateRouter.use(isAuthenticated, authorizeRoles("user", "admin"));


// Routes
EmailTemplateRouter.post(
  "/",
  templateUpload.array("attachments", 5),
  isAuthenticated,
  restrictGuestAccess,
  checkPlanAccess("createTemplates"),
  createTemplate,
);

EmailTemplateRouter.get("/", isAuthenticated, getTemplates);

EmailTemplateRouter.get("/:id", isAuthenticated, getTemplateById);

EmailTemplateRouter.patch(
  "/:id",
  templateUpload.array("attachments", 5),
  isAuthenticated,
  restrictGuestAccess,
  updateTemplate,
);

EmailTemplateRouter.delete("/:id", isAuthenticated, restrictGuestAccess, deleteTemplate);

export default EmailTemplateRouter;
