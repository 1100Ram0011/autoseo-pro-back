"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCompetitor = exports.addCompetitor = exports.getCompetitors = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getCompetitors = async (req, res) => {
    try {
        const competitors = await prisma_1.default.competitor.findMany({
            where: { siteId: req.params.id },
            include: {
                keywords: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json(competitors);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch competitors' });
    }
};
exports.getCompetitors = getCompetitors;
const addCompetitor = async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'Competitor URL is required' });
        }
        const newCompetitor = await prisma_1.default.competitor.create({
            data: {
                siteId: req.params.id,
                url
            }
        });
        // Mocking the analysis part for MVP
        // In reality, this would trigger an async job to Ahrefs/DataForSEO API
        await mockCompetitorAnalysis(newCompetitor.id);
        const updatedCompetitor = await prisma_1.default.competitor.findUnique({
            where: { id: newCompetitor.id },
            include: { keywords: true }
        });
        res.json(updatedCompetitor);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to add competitor' });
    }
};
exports.addCompetitor = addCompetitor;
const deleteCompetitor = async (req, res) => {
    try {
        await prisma_1.default.competitor.delete({
            where: { id: req.params.competitorId }
        });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete competitor' });
    }
};
exports.deleteCompetitor = deleteCompetitor;
// Helper function to mock API response
const mockCompetitorAnalysis = async (competitorId) => {
    const mockKeywords = [
        { keyword: 'seo services', position: 3, volume: 15000, traffic: 4000 },
        { keyword: 'local seo', position: 8, volume: 8000, traffic: 1200 },
        { keyword: 'best seo tools', position: 1, volume: 22000, traffic: 8500 },
        { keyword: 'how to do seo', position: 12, volume: 5000, traffic: 300 }
    ];
    for (const kw of mockKeywords) {
        await prisma_1.default.competitorKeyword.create({
            data: {
                competitorId,
                keyword: kw.keyword,
                position: kw.position,
                volume: kw.volume,
                traffic: kw.traffic
            }
        });
    }
    const aiStrategy = `## How to Beat This Competitor
1. **Target Low-Difficulty Keywords**: They are ignoring long-tail variations like "affordable seo services for small business".
2. **Improve Page Speed**: Their Core Web Vitals are failing. A faster site will outrank them.
3. **Content Gap**: You are missing "local seo" which brings them 1,200 monthly visits.
`;
    const contentGap = JSON.stringify([
        { keyword: 'local seo', theirPosition: 8, searchVolume: 8000 },
        { keyword: 'best seo tools', theirPosition: 1, searchVolume: 22000 }
    ]);
    await prisma_1.default.competitor.update({
        where: { id: competitorId },
        data: { aiStrategy, contentGap }
    });
};
//# sourceMappingURL=competitors.controller.js.map