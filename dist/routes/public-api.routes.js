"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const prisma_1 = __importDefault(require("../config/prisma"));
const pagespeed_1 = require("../services/pagespeed");
const autoSeoEngine_1 = require("../services/autoSeoEngine");
const router = (0, express_1.Router)();
// Middleware to check API key
const verifyApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
        return res.status(401).json({ error: 'Missing x-api-key header' });
    }
    const user = await prisma_1.default.user.findUnique({ where: { apiKey } });
    if (!user || user.planId === 'free') {
        return res.status(403).json({ error: 'Invalid API key or insufficient plan (Requires PRO or AGENCY)' });
    }
    // @ts-ignore
    req.user = user;
    next();
};
// Rate limiter specifically for the public API
const publicApiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per 15 mins for API usage
    message: { error: 'API rate limit exceeded. Please try again later.' }
});
router.use(publicApiLimiter);
router.use(verifyApiKey);
// 1. Audit URL Endpoint
router.get('/audit', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'Valid URL parameter is required' });
        }
        // Run a real-time Lighthouse audit
        const lhData = await (0, pagespeed_1.runFullAnalysis)(url);
        res.json({ success: true, data: lhData });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to audit URL', details: error.message });
    }
});
// 2. Generate Report Endpoint
router.post('/generate-report', async (req, res) => {
    try {
        const { siteId } = req.body;
        // @ts-ignore
        const userId = req.user.id;
        if (!siteId)
            return res.status(400).json({ error: 'siteId is required' });
        // Enqueue or run engine
        const engine = new autoSeoEngine_1.AutoSeoEngine('api-trigger', siteId, userId, 'https://example.com');
        const report = await engine.runScan();
        res.json({ success: true, report });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to generate report', details: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=public-api.routes.js.map