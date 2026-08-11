import { Router } from "express";
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from "../controllers/emailCampaign/emailTemplate.controller";
import {
  getCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaignStatus,
  deleteCampaign,
  getCampaignLogs,
  trackEmailOpen,
  trackEmailClick,
} from "../controllers/emailCampaign/emailCampaign.controller";
import {
  getEmailTokens,
  connectCustomSmtp,
  disconnectEmailToken,
  saveGoogleToken,
  saveMicrosoftToken,
  unsubscribeEmail,
  getUnsubscribes,
} from "../controllers/emailCampaign/emailToken.controller";
import {
  createAITemplate,
  updateAITemplate,
  getAITemplates,
  useAITemplate,
  deleteAITemplate,
} from "../controllers/emailCampaign/aiEmailTemplate.controller";
import { excelUpload, handleUploadError } from "../middlewares/upload.middleware";
import {
  googleOAuthRedirect,
  googleOAuthCallback,
  microsoftOAuthRedirect,
  microsoftOAuthCallback,
} from "../controllers/emailCampaign/emailOAuth.controller";

const router = Router();

// ─── PUBLIC Routes (no auth needed) ──────────────────────────────────
// Open tracking pixel
router.get("/track/open/:logId", trackEmailOpen);
// Click tracking redirect
router.get("/track/click/:logId", trackEmailClick);
// Unsubscribe link
router.get("/unsubscribe/:token", unsubscribeEmail);

// ─── OAuth Routes (no JWT auth — redirect flow) ────────────────────
router.get("/auth/google", googleOAuthRedirect);
router.get("/auth/google/callback", googleOAuthCallback);
router.get("/auth/microsoft", microsoftOAuthRedirect);
router.get("/auth/microsoft/callback", microsoftOAuthCallback);

// ─── Email Account (Token) Routes ───────────────────────────
router.get("/accounts", getEmailTokens);
router.post("/accounts/custom", connectCustomSmtp);
router.post("/accounts/google", saveGoogleToken);
router.post("/accounts/microsoft", saveMicrosoftToken);
router.delete("/accounts/:id", disconnectEmailToken);
router.get("/unsubscribes", getUnsubscribes);

// ─── Email Template Routes ──────────────────────────────────
router.get("/templates", getTemplates);
router.get("/templates/:id", getTemplateById);
router.post("/templates", createTemplate);
router.put("/templates/:id", updateTemplate);
router.delete("/templates/:id", deleteTemplate);

// ─── AI Email Template Routes ────────────────────────────────
router.get("/ai-templates", getAITemplates);
router.post("/ai-templates", createAITemplate);
router.put("/ai-templates/:id", updateAITemplate);
router.delete("/ai-templates/:id", deleteAITemplate);
router.post("/ai-templates/:id/use", useAITemplate);

// ─── Campaign Routes ─────────────────────────────────────────
router.get("/campaigns", getCampaigns);
router.get("/campaigns/:id", getCampaignById);
router.post("/campaigns", excelUpload.single("recipientFile"), createCampaign);
router.patch("/campaigns/:id/status", updateCampaignStatus);
router.delete("/campaigns/:id", deleteCampaign);
router.get("/campaigns/:id/logs", getCampaignLogs);

// ─── Upload Error Handler ───────────────────────────────────
router.use(handleUploadError);

export default router;
