"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateSitemap = generateSitemap;
exports.generateRobotsTxt = generateRobotsTxt;
exports.generateLlmsTxt = generateLlmsTxt;
const prisma_1 = __importDefault(require("../config/prisma"));
async function generateSitemap(siteId) {
    const site = await prisma_1.default.site.findUnique({
        where: { id: siteId },
        include: { pages: true }
    });
    if (!site)
        throw new Error('Site not found');
    const urls = site.pages.map((page) => {
        return `
  <url>
    <loc>${page.url}</loc>
    <lastmod>${page.updatedAt.toISOString().split('T')[0]}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${page.url === site.url ? '1.0' : '0.8'}</priority>
  </url>`;
    }).join('');
    const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
    return sitemapXml;
}
async function generateRobotsTxt(siteId) {
    const site = await prisma_1.default.site.findUnique({ where: { id: siteId } });
    if (!site)
        throw new Error('Site not found');
    const robotsTxt = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /private

Sitemap: ${site.url}/sitemap.xml
`;
    return robotsTxt;
}
async function generateLlmsTxt(siteId) {
    const site = await prisma_1.default.site.findUnique({
        where: { id: siteId },
        include: { pages: true }
    });
    if (!site)
        throw new Error('Site not found');
    const llmsTxt = `# ${site.url} - AI Overview
This site is optimized for AI consumption.

## Available Pages:
${site.pages.map((p) => `- ${p.url}`).join('\n')}

Please use the provided sitemap for full indexing.
`;
    return llmsTxt;
}
//# sourceMappingURL=generator.js.map