"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSuggestionStatus = exports.generateSuggestions = exports.getSuggestions = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getSuggestions = async (req, res) => {
    try {
        const suggestions = await prisma_1.default.internalLinkSuggestion.findMany({
            where: { siteId: req.params.id },
            orderBy: { createdAt: 'desc' }
        });
        res.json(suggestions);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch link suggestions' });
    }
};
exports.getSuggestions = getSuggestions;
const generateSuggestions = async (req, res) => {
    try {
        const siteId = req.params.id;
        // In a real implementation, we would:
        // 1. Fetch all indexed pages for the site
        // 2. Fetch all content for these pages
        // 3. Send to an NLP engine to find context overlaps
        // 4. Save the generated suggestions to DB
        // For MVP, we will generate some mock realistic suggestions
        const mockSuggestions = [
            {
                sourcePageUrl: '/blog/what-is-seo',
                targetPageUrl: '/services/seo-audit',
                suggestedAnchorText: 'comprehensive SEO audit',
            },
            {
                sourcePageUrl: '/blog/10-tips-for-link-building',
                targetPageUrl: '/blog/what-is-seo',
                suggestedAnchorText: 'search engine optimization basics',
            },
            {
                sourcePageUrl: '/about-us',
                targetPageUrl: '/contact',
                suggestedAnchorText: 'get in touch with our team',
            }
        ];
        // Delete old pending suggestions to avoid clutter for demo purposes
        await prisma_1.default.internalLinkSuggestion.deleteMany({
            where: { siteId, status: 'Pending' }
        });
        const createdSuggestions = [];
        for (const sug of mockSuggestions) {
            const created = await prisma_1.default.internalLinkSuggestion.create({
                data: {
                    siteId,
                    sourcePageUrl: sug.sourcePageUrl,
                    targetPageUrl: sug.targetPageUrl,
                    suggestedAnchorText: sug.suggestedAnchorText,
                    status: 'Pending'
                }
            });
            createdSuggestions.push(created);
        }
        res.json(createdSuggestions);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate suggestions' });
    }
};
exports.generateSuggestions = generateSuggestions;
const updateSuggestionStatus = async (req, res) => {
    try {
        const { suggestionId } = req.params;
        const { status } = req.body; // 'Accepted' or 'Rejected'
        if (!['Accepted', 'Rejected'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const updated = await prisma_1.default.internalLinkSuggestion.update({
            where: { id: suggestionId },
            data: { status }
        });
        // In a real tool, if 'Accepted', we might trigger a webhook to a CMS (WordPress, Webflow) 
        // to actually inject the anchor text link automatically.
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update suggestion status' });
    }
};
exports.updateSuggestionStatus = updateSuggestionStatus;
//# sourceMappingURL=links.controller.js.map