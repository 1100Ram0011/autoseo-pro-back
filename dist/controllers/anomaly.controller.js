"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerScan = exports.executeAction = exports.getAnomalies = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const autoFixer_1 = require("../services/autoFixer");
const anomalyDetector_1 = require("../services/anomalyDetector");
const getAnomalies = async (req, res) => {
    const siteId = req.params.siteId;
    try {
        const anomalies = await prisma_1.default.aiAnomaly.findMany({
            where: { siteId, status: { not: 'RESOLVED' } },
            include: { actions: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(anomalies);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch anomalies' });
    }
};
exports.getAnomalies = getAnomalies;
const executeAction = async (req, res) => {
    const { actionId } = req.body;
    try {
        const result = await (0, autoFixer_1.executeAiAction)(actionId);
        if (!result)
            return res.status(404).json({ error: 'Action not found' });
        res.json({ success: true, message: 'Action executed successfully' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to execute action' });
    }
};
exports.executeAction = executeAction;
// Expose a manual trigger for testing
const triggerScan = async (req, res) => {
    const siteId = req.params.siteId;
    try {
        // Run the anomaly detection on-demand
        await (0, anomalyDetector_1.runAnomalyDetection)(siteId);
        res.json({ success: true, message: 'Scan complete. Check anomalies.' });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Scan failed' });
    }
};
exports.triggerScan = triggerScan;
// Force TS re-evaluation
//# sourceMappingURL=anomaly.controller.js.map