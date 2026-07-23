"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getValidationStatus = exports.uploadValidationFile = exports.logoutAllWhatsApp = exports.logoutWhatsApp = exports.checkWhatsAppNumber = exports.getWhatsappConnectionStatus = exports.getWhatsAppQRCode = exports.getWhatsAppConnections = exports.connectWhatsApp = void 0;
const whatsappEngine_service_1 = __importDefault(require("../services/whatsappEngine.service"));
const prisma_1 = __importDefault(require("../config/prisma"));
const upload_service_1 = require("../services/upload.service");
const crypto_1 = __importDefault(require("crypto"));
const whatsappValidationQueue_1 = require("../jobs/whatsappValidationQueue");
const connectWhatsApp = async (req, res) => {
    try {
        const accountId = req.user?.id?.toString() || '1';
        const response = await whatsappEngine_service_1.default.post('/connect', { accountId });
        return res.json(response.data);
    }
    catch (error) {
        console.error('CONNECT ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to connect WhatsApp' });
    }
};
exports.connectWhatsApp = connectWhatsApp;
const getWhatsAppConnections = async (req, res) => {
    try {
        const accountId = req.user?.id?.toString() || '1';
        const response = await whatsappEngine_service_1.default.get(`/connections/${accountId}`);
        return res.json(response.data);
    }
    catch (error) {
        console.error('CONNECTIONS ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch connections' });
    }
};
exports.getWhatsAppConnections = getWhatsAppConnections;
const getWhatsAppQRCode = async (req, res) => {
    try {
        const { connectionId } = req.params;
        const accountId = req.user?.id?.toString() || '1';
        const response = await whatsappEngine_service_1.default.get(`/qr/${connectionId}`, { headers: { 'x-account-id': accountId } });
        return res.json(response.data);
    }
    catch (error) {
        console.error('QR ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch QR' });
    }
};
exports.getWhatsAppQRCode = getWhatsAppQRCode;
const getWhatsappConnectionStatus = async (req, res) => {
    try {
        const { connectionId } = req.params;
        const response = await whatsappEngine_service_1.default.get(`/status/${connectionId}`);
        return res.json(response.data);
    }
    catch (error) {
        console.error('STATUS ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to fetch status' });
    }
};
exports.getWhatsappConnectionStatus = getWhatsappConnectionStatus;
const checkWhatsAppNumber = async (req, res) => {
    const accountId = req.user?.id?.toString() || '1';
    try {
        const { connectionId, number } = req.body;
        if (!number)
            return res.status(400).json({ success: false, message: 'Number is required' });
        const response = await whatsappEngine_service_1.default.post('/check-number', { accountId, connectionId, number });
        return res.json(response.data);
    }
    catch (error) {
        console.error('CHECK NUMBER ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: error.response?.data?.message || error.message || 'Failed to check number' });
    }
};
exports.checkWhatsAppNumber = checkWhatsAppNumber;
const logoutWhatsApp = async (req, res) => {
    try {
        const { connectionId } = req.body;
        const response = await whatsappEngine_service_1.default.post('/logout', { connectionId });
        return res.json(response.data);
    }
    catch (error) {
        console.error('LOGOUT ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to logout' });
    }
};
exports.logoutWhatsApp = logoutWhatsApp;
const logoutAllWhatsApp = async (req, res) => {
    try {
        const accountId = req.user?.id?.toString() || '1';
        const response = await whatsappEngine_service_1.default.post('/logout-all', { accountId });
        return res.json(response.data);
    }
    catch (error) {
        console.error('LOGOUT ALL ERROR:', error.response?.data || error.message);
        return res.status(500).json({ success: false, message: 'Failed to logout all' });
    }
};
exports.logoutAllWhatsApp = logoutAllWhatsApp;
const uploadValidationFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "File required" });
        }
        const accountId = req.user?.id?.toString() || '1';
        const extension = req.file.originalname.split(".").pop()?.toLowerCase();
        const key = `${Date.now()}-${crypto_1.default.randomBytes(6).toString("hex")}.${extension}`;
        const sourceFileUrl = await (0, upload_service_1.uploadToS3)(req.file.buffer, key, "whatsapp-validator/source", req.file.mimetype);
        const job = await prisma_1.default.whatsappValidationJob.create({
            data: {
                accountId,
                originalFileName: req.file.originalname,
                sourceFileUrl,
            }
        });
        await whatsappValidationQueue_1.whatsappValidationQueue.add("validate-whatsapp", {
            jobId: job.id,
            accountId,
        });
        return res.json({ success: true, jobId: job.id });
    }
    catch (error) {
        console.error("[VALIDATOR] Upload Failed", error);
        return res.status(500).json({ success: false, message: error.message });
    }
};
exports.uploadValidationFile = uploadValidationFile;
const getValidationStatus = async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const job = await prisma_1.default.whatsappValidationJob.findUnique({
            where: { id: jobId }
        });
        if (!job)
            return res.status(404).json({ success: false, message: 'Job not found' });
        return res.json({
            success: true,
            data: {
                status: job.status,
                totalRows: job.totalRows,
                processedRows: job.processedRows,
                downloadUrl: job.resultFileUrl,
            }
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
exports.getValidationStatus = getValidationStatus;
//# sourceMappingURL=whatsapp.controller.js.map