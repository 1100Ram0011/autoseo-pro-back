// whatsapp.routes.js

import express from 'express';
import { checkWhatsAppNumber, connectWhatsApp, getStatus, getWhatsAppConnections, getWhatsAppQRCode, getWhatsappConnectionStatus, logoutAllWhatsApp, logoutWhatsApp, uploadFile, whatsappWebhook } from '../controllers/whatsapp.controller.js';
import { isAuthenticated } from '../middleware/authMiddleware.js';
import { uploadValidator } from '../middleware/uploadValidator.js';

const router = express.Router();
// router.use(isAuthenticated)
router.post("/connect", isAuthenticated, connectWhatsApp);

router.get(
  "/connections",
  isAuthenticated,
  getWhatsAppConnections
);

router.get(
  "/qr/:connectionId",
  isAuthenticated,
  getWhatsAppQRCode
);

router.get(
  "/status/:connectionId",
  isAuthenticated,
  getWhatsappConnectionStatus
);

router.post(
  "/logout",
  isAuthenticated,
  logoutWhatsApp
);

router.post(
  "/logout-all",
  isAuthenticated,
  logoutAllWhatsApp
);

router.post(
  "/check-number",
  isAuthenticated,  
  checkWhatsAppNumber
);

router.post(
  "/webhook",
  whatsappWebhook
);


router.post(
  "/validator/upload",
  isAuthenticated,
  uploadValidator.single(
    "file"
  ),
  uploadFile
);


router.get(
  "/validator/status/:jobId",
  isAuthenticated,
  getStatus
);



export default router;