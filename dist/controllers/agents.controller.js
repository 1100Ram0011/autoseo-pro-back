"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentW3 = exports.runAgentW2 = exports.runAgentW1 = void 0;
const auditGenerator_1 = require("../services/auditGenerator");
const trendJacker_1 = require("../services/trendJacker");
const securePurge_1 = require("../services/securePurge");
const runAgentW1 = async (req, res) => {
    const { location = 'Mumbai', industry = 'Cafe' } = req.body;
    try {
        const agentW1 = new auditGenerator_1.AutonomousLocalBusinessCloser();
        agentW1.executePipeline(location, industry).catch(console.error);
        res.json({
            message: 'Agent W1 Pipeline Started successfully.',
            status: 'Processing in background',
            target: { location, industry }
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start Agent W1' });
    }
};
exports.runAgentW1 = runAgentW1;
const runAgentW2 = async (req, res) => {
    const { siteId } = req.body;
    if (!siteId)
        return res.status(400).json({ error: 'siteId is required' });
    try {
        const agentW2 = new trendJacker_1.AiTrendJacker();
        agentW2.executePipeline(siteId).catch(console.error);
        res.json({
            message: 'Agent W2 Pipeline Started successfully.',
            status: 'Scanning trends and generating multimodal content...'
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start Agent W2' });
    }
};
exports.runAgentW2 = runAgentW2;
const runAgentW3 = async (req, res) => {
    const { userId } = req.body;
    if (!userId)
        return res.status(400).json({ error: 'userId is required' });
    try {
        const agentW3 = new securePurge_1.SecureHardwarePurgeEngine();
        const result = await agentW3.executePurge(userId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to execute Agent W3 Purge' });
    }
};
exports.runAgentW3 = runAgentW3;
//# sourceMappingURL=agents.controller.js.map