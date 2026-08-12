// routes/whatsappTemplate.routes.js

import express from "express";

import {
  createTemplate,
  getTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/whatsappTemplate.controller.js";
import { isAuthenticated } from "../middleware/authMiddleware.js";

const router =
  express.Router();

router.use(isAuthenticated)

router.post(
  "/",
  createTemplate
);

router.get(
  "/",
  getTemplates
);

router.get(
  "/:templateId",
  getTemplate
);

router.put(
  "/:templateId",
  updateTemplate
);

router.delete(
  "/:templateId",
  deleteTemplate
);

export default router;