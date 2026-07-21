import express from 'express';
import multer from 'multer';
import {
  connectWhatsApp,
  getWhatsAppConnections,
  getWhatsAppQRCode,
  getWhatsappConnectionStatus,
  checkWhatsAppNumber,
  logoutWhatsApp,
  logoutAllWhatsApp,
  uploadValidationFile,
  getValidationStatus
} from '../controllers/whatsapp.controller';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Core WhatsApp Management
router.post('/connect', connectWhatsApp);
router.get('/connections/:accountId', getWhatsAppConnections);
router.get('/qr/:connectionId', getWhatsAppQRCode);
router.get('/status/:connectionId', getWhatsappConnectionStatus);
router.post('/check-number', checkWhatsAppNumber);
router.post('/logout', logoutWhatsApp);
router.post('/logout-all', logoutAllWhatsApp);

// Validation
router.post('/validator/upload', upload.single('file'), uploadValidationFile);
router.get('/validator/status/:jobId', getValidationStatus);

export default router;
