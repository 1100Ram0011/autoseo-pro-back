"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerManualSync = exports.getHistoricalMetrics = exports.getUxIssues = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getUxIssues = async (req, res) => {
    const siteId = req.params.siteId;
    const days = parseInt(req.query.days) || 7;
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const metrics = await prisma_1.default.clarityMetric.findMany({
            where: {
                siteId,
                date: { gte: cutoffDate }
            }
        });
        // Aggregate by URL
        const urlMap = {};
        for (const m of metrics) {
            const url = m.url || '/';
            if (!urlMap[url])
                urlMap[url] = { url, rageClicks: 0, deadClicks: 0, sessions: 0 };
            urlMap[url].rageClicks += m.rageClicks;
            urlMap[url].deadClicks += m.deadClicks;
            urlMap[url].sessions += m.sessions;
        }
        // Convert to array and sort by worst UX (rage + dead)
        const issues = Object.values(urlMap)
            .filter(i => (i.rageClicks + i.deadClicks) > 0)
            .sort((a, b) => (b.rageClicks + b.deadClicks) - (a.rageClicks + a.deadClicks))
            .slice(0, 10);
        res.json(issues);
    }
    catch (error) {
        console.error('Clarity Controller Error:', error);
        res.status(500).json({ error: 'Failed to fetch UX issues' });
    }
};
exports.getUxIssues = getUxIssues;
const getHistoricalMetrics = async (req, res) => {
    const siteId = req.params.siteId;
    const days = parseInt(req.query.days) || 30;
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const metrics = await prisma_1.default.clarityMetric.groupBy({
            by: ['date'],
            where: {
                siteId,
                date: { gte: cutoffDate }
            },
            _sum: {
                sessions: true,
                rageClicks: true,
                deadClicks: true,
            },
            orderBy: { date: 'asc' }
        });
        res.json(metrics.map(m => ({
            date: m.date,
            sessions: m._sum.sessions || 0,
            rageClicks: m._sum.rageClicks || 0,
            deadClicks: m._sum.deadClicks || 0
        })));
    }
    catch (error) {
        console.error('Clarity Historical Metrics Error:', error);
        res.status(500).json({ error: 'Failed to fetch historical metrics' });
    }
};
exports.getHistoricalMetrics = getHistoricalMetrics;
const triggerManualSync = async (req, res) => {
    // In a real app, do not block the request. Just trigger the function.
    Promise.resolve().then(() => __importStar(require('../services/claritySync'))).then(module => {
        module.runClaritySync();
    });
    res.json({ message: 'Clarity manual sync started in background.' });
};
exports.triggerManualSync = triggerManualSync;
//# sourceMappingURL=clarity.controller.js.map