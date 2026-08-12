import express from "express";
import { handleMsg91Webhook } from "../../../../controllers/Campaign/WhatsappCampaign/Msg91/msg91Webhook.controller.js";

const router = express.Router();

// Webhooks don't use authentication middleware because they are called by MSG91
router.post("/", handleMsg91Webhook);

export default router;
