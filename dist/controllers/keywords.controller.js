"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getKeywordIdeas = exports.deleteKeyword = exports.createSiteKeyword = exports.getSiteKeywords = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const googleAds_1 = require("../services/googleAds");
const getSiteKeywords = async (req, res) => {
    try {
        const keywords = await prisma_1.default.keyword.findMany({
            where: { siteId: req.params.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(keywords);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch keywords' });
    }
};
exports.getSiteKeywords = getSiteKeywords;
const createSiteKeyword = async (req, res) => {
    try {
        const { keyword, volume, position } = req.body;
        const newKw = await prisma_1.default.keyword.create({
            data: {
                siteId: req.params.id,
                keyword,
                volume: volume ? parseInt(volume) : null,
                position: position ? parseInt(position) : null
            }
        });
        res.json(newKw);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save keyword' });
    }
};
exports.createSiteKeyword = createSiteKeyword;
const deleteKeyword = async (req, res) => {
    try {
        await prisma_1.default.keyword.delete({
            where: { id: req.params.keywordId }
        });
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete keyword' });
    }
};
exports.deleteKeyword = deleteKeyword;
const getKeywordIdeas = async (req, res) => {
    try {
        const seed = req.query.seed;
        if (!seed)
            return res.status(400).json({ error: 'seed query parameter is required' });
        // Using the generateKeywordIdeas service from Google Ads API
        const data = await (0, googleAds_1.generateKeywordIdeas)(seed);
        res.json(data);
    }
    catch (error) {
        console.error('Keyword Ideas Error:', error);
        res.status(500).json({ error: 'Failed to generate keyword ideas' });
    }
};
exports.getKeywordIdeas = getKeywordIdeas;
//# sourceMappingURL=keywords.controller.js.map