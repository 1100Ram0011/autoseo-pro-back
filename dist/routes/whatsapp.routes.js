"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const whatsapp_controller_1 = require("../controllers/whatsapp.controller");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
// Core WhatsApp Management
router.post('/connect', whatsapp_controller_1.connectWhatsApp);
router.get('/connections/:accountId', whatsapp_controller_1.getWhatsAppConnections);
router.get('/qr/:connectionId', whatsapp_controller_1.getWhatsAppQRCode);
router.get('/status/:connectionId', whatsapp_controller_1.getWhatsappConnectionStatus);
router.post('/check-number', whatsapp_controller_1.checkWhatsAppNumber);
router.post('/logout', whatsapp_controller_1.logoutWhatsApp);
router.post('/logout-all', whatsapp_controller_1.logoutAllWhatsApp);
// Validation
router.post('/validator/upload', upload.single('file'), whatsapp_controller_1.uploadValidationFile);
router.get('/validator/status/:jobId', whatsapp_controller_1.getValidationStatus);
exports.default = router;
//# sourceMappingURL=whatsapp.routes.js.map