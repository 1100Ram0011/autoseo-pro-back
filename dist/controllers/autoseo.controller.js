"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReport = exports.streamProgress = exports.startScan = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const autoSeoEngine_1 = require("../services/autoSeoEngine");
const startScan = async (req, res) => {
    const { url, siteId } = req.body;
    if (!url || !siteId) {
        return res.status(400).json({ error: 'URL and Site ID are required' });
    }
    try {
        // Check if site exists
        const site = await prisma_1.default.site.findUnique({ where: { id: siteId } });
        if (!site) {
            return res.status(404).json({ error: 'Site not found' });
        }
        // Create a new report entry
        const report = await prisma_1.default.autoSeoReport.create({
            data: {
                siteId,
                url,
                status: 'Pending'
            }
        });
        // Start engine in background
        const engine = new autoSeoEngine_1.AutoSeoEngine(report.id, siteId, site.userId, url);
        engine.runScan(); // async without awaiting to not block response
        res.json({ reportId: report.id, message: 'Scan started successfully' });
    }
    catch (error) {
        console.error("Start Scan Error:", error);
        res.status(500).json({ error: 'Failed to start scan' });
    }
};
exports.startScan = startScan;
const streamProgress = (req, res) => {
    const { reportId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const eventName = `update-${reportId}`;
    // Send initial connected message
    sendEvent({ step: 'connection', status: 'connected', message: 'Connected to scan stream...' });
    const listener = (data) => {
        sendEvent(data);
        if (data.status === 'completed' && data.step === 'summary') {
            res.end(); // Close stream on success
        }
        if (data.status === 'failed') {
            res.end();
        }
    };
    autoSeoEngine_1.autoSeoEmitter.on(eventName, listener);
    req.on('close', () => {
        autoSeoEngine_1.autoSeoEmitter.off(eventName, listener);
    });
};
exports.streamProgress = streamProgress;
const getReport = async (req, res) => {
    const { reportId } = req.params;
    try {
        const report = await prisma_1.default.autoSeoReport.findUnique({
            where: { id: String(reportId) },
            include: { site: true }
        });
        if (!report) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json(report);
    }
    catch (error) {
        console.error("Get Report Error:", error);
        res.status(500).json({ error: 'Failed to fetch report' });
    }
};
exports.getReport = getReport;
//# sourceMappingURL=autoseo.controller.js.map