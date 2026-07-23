"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateDisavow = exports.markDisavow = exports.getBacklinks = exports.scanBacklinks = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const scanBacklinks = async (req, res) => {
    try {
        const siteId = req.params.id;
        // MVP: Check if backlinks exist, if not, create mock ones.
        const existing = await prisma_1.default.backlink.findMany({ where: { siteId } });
        if (existing.length === 0) {
            const mockBacklinks = [
                {
                    domain: 'good-seo-blog.com',
                    url: 'https://good-seo-blog.com/top-10-tools',
                    targetUrl: '/features',
                    toxicityScore: 12,
                },
                {
                    domain: 'news-portal-trust.org',
                    url: 'https://news-portal-trust.org/industry-update',
                    targetUrl: '/',
                    toxicityScore: 5,
                },
                {
                    domain: 'buy-cheap-links-now.net',
                    url: 'http://buy-cheap-links-now.net/spam/123',
                    targetUrl: '/',
                    toxicityScore: 92, // Toxic
                },
                {
                    domain: 'shady-casino-reviews.biz',
                    url: 'https://shady-casino-reviews.biz/hidden-link',
                    targetUrl: '/pricing',
                    toxicityScore: 85, // Toxic
                },
                {
                    domain: 'tech-reviewer.io',
                    url: 'https://tech-reviewer.io/auto-seo-pro-review',
                    targetUrl: '/',
                    toxicityScore: 18,
                }
            ];
            for (const bl of mockBacklinks) {
                await prisma_1.default.backlink.create({
                    data: {
                        siteId,
                        domain: bl.domain,
                        url: bl.url,
                        targetUrl: bl.targetUrl,
                        toxicityScore: bl.toxicityScore
                    }
                });
            }
        }
        const backlinks = await prisma_1.default.backlink.findMany({
            where: { siteId },
            orderBy: { toxicityScore: 'desc' }
        });
        res.json(backlinks);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to scan backlinks' });
    }
};
exports.scanBacklinks = scanBacklinks;
const getBacklinks = async (req, res) => {
    try {
        const siteId = req.params.id;
        const backlinks = await prisma_1.default.backlink.findMany({
            where: { siteId },
            orderBy: { toxicityScore: 'desc' }
        });
        res.json(backlinks);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch backlinks' });
    }
};
exports.getBacklinks = getBacklinks;
const markDisavow = async (req, res) => {
    try {
        const { linkId } = req.params;
        const { isDisavowed } = req.body;
        const updated = await prisma_1.default.backlink.update({
            where: { id: linkId },
            data: { isDisavowed }
        });
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to update disavow status' });
    }
};
exports.markDisavow = markDisavow;
const generateDisavow = async (req, res) => {
    try {
        const siteId = req.params.id;
        const disavowedLinks = await prisma_1.default.backlink.findMany({
            where: { siteId, isDisavowed: true }
        });
        if (disavowedLinks.length === 0) {
            return res.status(400).json({ error: 'No links marked for disavowal.' });
        }
        // Google Disavow File Format expects:
        // domain:spamdomain.com
        // OR
        // http://spam.com/exact-page.html
        let fileContent = "# AutoSEO Pro Generated Disavow File\n";
        fileContent += `# Generated on: ${new Date().toISOString()}\n\n`;
        disavowedLinks.forEach((link) => {
            // Disavow at domain level is safer and recommended by Google for spam networks
            fileContent += `domain:${link.domain}\n`;
        });
        res.setHeader('Content-disposition', 'attachment; filename=disavow.txt');
        res.setHeader('Content-type', 'text/plain');
        res.send(fileContent);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to generate disavow file' });
    }
};
exports.generateDisavow = generateDisavow;
//# sourceMappingURL=backlinks.controller.js.map