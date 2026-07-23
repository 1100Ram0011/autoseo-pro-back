"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoSeoEngine = exports.autoSeoEmitter = void 0;
const events_1 = require("events");
const genai_1 = require("@google/genai");
const axios_1 = __importDefault(require("axios"));
const prisma_1 = __importDefault(require("../config/prisma"));
const ga4_1 = require("./ga4");
const gsc_1 = require("./gsc");
const pagespeed_1 = require("./pagespeed");
const mockData_1 = require("../config/mockData");
const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MOCK_KEY' });
// Global event emitter for SSE
exports.autoSeoEmitter = new events_1.EventEmitter();
class AutoSeoEngine {
    reportId;
    siteId;
    userId;
    url;
    constructor(reportId, siteId, userId, url) {
        this.reportId = reportId;
        this.siteId = siteId;
        this.userId = userId;
        this.url = url;
    }
    emit(step, status, message) {
        exports.autoSeoEmitter.emit(`update-${this.reportId}`, { step, status, message });
    }
    async generateAiReport(prompt) {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(r => setTimeout(r, 2000)); // Simulate delay
            return `Mock AI Report for: ${prompt.substring(0, 50)}...\n\n- Ensure tags are optimized.\n- Improve page speed.\n- Fix broken links.`;
        }
        try {
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-pro',
                contents: prompt
            });
            return response.text || "No report generated.";
        }
        catch (error) {
            console.error("Gemini Error:", error);
            return "Error generating AI report.";
        }
    }
    async runScan() {
        try {
            // 1. Initializing
            this.emit('init', 'running', 'Initializing Auto SEO scan...');
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { status: 'InProgress' }
            });
            this.emit('init', 'completed', 'Initialized successfully.');
            // 2. Google Analytics
            this.emit('ga', 'running', 'Fetching Google Analytics data & generating AI report...');
            let gaData = mockData_1.MOCK_GA4.overview;
            try {
                const site = await prisma_1.default.site.findUnique({ where: { id: this.siteId } });
                if (site?.ga4PropertyId) {
                    gaData = await (0, ga4_1.getGa4Overview)(site.ga4PropertyId, this.userId) || mockData_1.MOCK_GA4.overview;
                }
            }
            catch (e) {
                console.warn('GA4 fetch failed, using mock data', e);
            }
            const gaReport = await this.generateAiReport(`Analyze this Google Analytics data for ${this.url} and provide a comprehensive report and solutions for improvement. Data: ${JSON.stringify(gaData)}`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { gaData: JSON.stringify(gaData), gaReport }
            });
            this.emit('ga', 'completed', 'GA analysis complete.');
            // 3. Google Search Console
            this.emit('gsc', 'running', 'Fetching Google Search Console data & generating AI report...');
            let gscData = mockData_1.MOCK_GSC.overview;
            try {
                const site = await prisma_1.default.site.findUnique({ where: { id: this.siteId } });
                const gscUrl = site?.gscPropertyId || this.url;
                gscData = await (0, gsc_1.getGscOverview)(gscUrl, this.userId) || mockData_1.MOCK_GSC.overview;
            }
            catch (e) {
                console.warn('GSC overview fetch failed, using mock data', e);
            }
            const gscReport = await this.generateAiReport(`Analyze this Google Search Console data for ${this.url} and provide a comprehensive report and SEO solutions. Data: ${JSON.stringify(gscData)}`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { gscData: JSON.stringify(gscData), gscReport }
            });
            this.emit('gsc', 'completed', 'GSC analysis complete.');
            // 4. Robots & Sitemap
            this.emit('robots', 'running', 'Fetching Robots.txt & Sitemap & generating AI report...');
            let robotsContent = '';
            try {
                const parsedUrl = new URL(this.url);
                const robotsUrl = `${parsedUrl.origin}/robots.txt`;
                const res = await axios_1.default.get(robotsUrl, { timeout: 5000 });
                robotsContent = res.data;
            }
            catch (e) {
                robotsContent = "Could not fetch robots.txt";
            }
            const robotsReport = await this.generateAiReport(`Analyze this robots.txt and sitemap context for ${this.url} and provide solutions. Robots content: \n${robotsContent}`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { robotsData: JSON.stringify({ robots: robotsContent }), robotsReport }
            });
            this.emit('robots', 'completed', 'Robots & Sitemap analysis complete.');
            // 5. Keywords
            this.emit('keywords', 'running', 'Analyzing keyword data & generating AI report...');
            let keywordsData = mockData_1.MOCK_GSC.keywords.keywords.slice(0, 5);
            try {
                const site = await prisma_1.default.site.findUnique({ where: { id: this.siteId } });
                const gscUrl = site?.gscPropertyId || this.url;
                const gscKeywordsRes = await (0, gsc_1.getGscKeywords)(gscUrl, this.userId, this.siteId);
                if (gscKeywordsRes?.keywords?.length > 0) {
                    keywordsData = gscKeywordsRes.keywords.slice(0, 10);
                }
            }
            catch (e) {
                console.warn('GSC keywords fetch failed, using mock data', e);
            }
            const keywordReport = await this.generateAiReport(`Analyze these ranking keywords for ${this.url} and provide content ideas and solutions to improve rankings. Keywords: ${JSON.stringify(keywordsData)}`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { keywordData: JSON.stringify(keywordsData), keywordReport }
            });
            this.emit('keywords', 'completed', 'Keyword analysis complete.');
            // 6. Lighthouse
            this.emit('lighthouse', 'running', 'Running Lighthouse audit & generating AI solutions...');
            let lhData = (0, mockData_1.generateMockPageSpeed)(this.url, 'mobile');
            try {
                if (process.env.PAGESPEED_API_KEY && process.env.PAGESPEED_API_KEY !== 'MOCK_KEY') {
                    lhData = await (0, pagespeed_1.runFullAnalysis)(this.url);
                }
            }
            catch (e) {
                console.warn('Lighthouse fetch failed, using mock data', e);
            }
            const lighthouseReport = await this.generateAiReport(`Analyze this Lighthouse performance data for ${this.url} and provide specific technical solutions for each metric. Data: ${JSON.stringify(lhData)}`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { lighthouseData: JSON.stringify(lhData), lighthouseReport }
            });
            this.emit('lighthouse', 'completed', 'Lighthouse analysis complete.');
            // 7. Overall Summary
            this.emit('summary', 'running', 'Generating comprehensive final summary...');
            const overallSummary = await this.generateAiReport(`You are an expert SEO consultant. Create a final, comprehensive executive summary for ${this.url} based on the fact that GA, GSC, Keywords, and Lighthouse have been analyzed. Highlight the top 3 most critical action items.`);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { overallSummary, status: 'Completed' }
            });
            this.emit('summary', 'completed', 'Scan finished successfully.');
        }
        catch (error) {
            console.error("Auto SEO Scan Error:", error);
            await prisma_1.default.autoSeoReport.update({
                where: { id: this.reportId },
                data: { status: 'Failed' }
            });
            this.emit('error', 'failed', 'An error occurred during the scan.');
        }
    }
}
exports.AutoSeoEngine = AutoSeoEngine;
//# sourceMappingURL=autoSeoEngine.js.map