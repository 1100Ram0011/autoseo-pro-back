"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAnomalyDetection = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const ga4_1 = require("./ga4");
const gsc_1 = require("./gsc");
const autoFixer_1 = require("./autoFixer");
const runAnomalyDetection = async (siteId) => {
    try {
        const site = await prisma_1.default.site.findUnique({
            where: { id: siteId },
            include: { pages: true, clarityMetrics: true }
        });
        if (!site)
            return;
        console.log(`[AnomalyDetector] Fetching omnichannel data for ${site.url}...`);
        // 1. Fetch GA4 (Traffic, Engagement)
        const ga4Data = await (0, ga4_1.getGa4Overview)(site.ga4PropertyId || site.url, site.userId);
        // 2. Fetch GSC (Keywords, CTR)
        const gscKeywords = await (0, gsc_1.getGscKeywords)(site.gscPropertyId || site.url, site.userId, site.id);
        // 3. Fetch Lighthouse (PageSpeed, Core Web Vitals)
        // We'll extract the latest PSI data from the site's pages
        const pagesWithSpeedData = site.pages.filter(p => p.psi_data || p.lighthouse_data).map(p => {
            let speedScore = 0;
            let seoScore = 0;
            try {
                if (p.lighthouse_data) {
                    const lh = JSON.parse(p.lighthouse_data);
                    seoScore = lh.categories?.seo?.score || 0;
                }
                if (p.psi_data) {
                    const psi = JSON.parse(p.psi_data);
                    speedScore = psi.lighthouseResult?.categories?.performance?.score || 0;
                }
            }
            catch (e) { }
            return { url: p.url, speedScore, seoScore };
        });
        // 4. Fetch Clarity (Visitor Behavior)
        const clarityData = site.clarityMetrics?.slice(-5) || []; // Last 5 days of data
        // 5. Fetch Sitemaps/Technical (Basic status)
        const technical = {
            sitemapUrl: site.sitemap_url,
            lastCrawled: site.last_crawled,
            indexedPages: site.pages.filter(p => p.indexed).length,
            totalKnownPages: site.pages.length
        };
        // Construct Master State
        const masterState = {
            domain: site.url,
            analytics: ga4Data,
            searchConsole: gscKeywords?.keywords?.slice(0, 10), // Top 10 keywords
            lighthouse: pagesWithSpeedData,
            visitorBehavior: clarityData,
            technicalSEO: technical
        };
        console.log(`[AnomalyDetector] Master state compiled. Sending to AI...`);
        // 6. Pass to Gemini AI for Cross-Platform Correlation
        await (0, autoFixer_1.analyzeOmnichannelState)(site.id, masterState);
        console.log(`[AnomalyDetector] Completed run for site ${site.url}`);
    }
    catch (error) {
        console.error('[AnomalyDetector] Error:', error);
    }
};
exports.runAnomalyDetection = runAnomalyDetection;
//# sourceMappingURL=anomalyDetector.js.map