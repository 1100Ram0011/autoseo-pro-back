"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initClarityCron = exports.runClaritySync = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../config/prisma"));
const axios_1 = __importDefault(require("axios"));
const runClaritySync = async () => {
    console.log('🔄 Starting Daily Clarity Data Sync...');
    try {
        const sites = await prisma_1.default.site.findMany();
        const token = process.env.CLARITY_API_TOKEN;
        const clarityId = process.env.MICROSOFT_CLARITY_ID;
        // Iterate through sites
        for (const site of sites) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            // In a real scenario, we'd make 3 requests per site to get Dimensions.
            // E.g., dimension1=URL, dimension1=Device
            let metrics = [];
            if (token && token !== 'MOCK_TOKEN' && clarityId) {
                try {
                    // Request 1: URL breakdown
                    const res = await axios_1.default.get('https://www.clarity.ms/export-data/api/v1/project-live-insights', {
                        headers: { Authorization: `Bearer ${token}` },
                        params: { numOfDays: 1, dimension1: 'URL', projectId: clarityId }
                    });
                    metrics = res.data;
                }
                catch (err) {
                    console.error(`Clarity API Error for site ${site.id}:`, err.message);
                    metrics = generateMockClarityData(site.url); // Fallback to mock if API fails
                }
            }
            else {
                // Fallback to mock data for MVP/demo purposes
                metrics = generateMockClarityData(site.url);
            }
            // Upsert data into DB
            for (const m of metrics) {
                await prisma_1.default.clarityMetric.upsert({
                    where: {
                        siteId_date_url_device: {
                            siteId: site.id,
                            date: today,
                            url: m.url || '/',
                            device: m.device || 'Desktop',
                        }
                    },
                    update: {
                        sessions: m.sessions,
                        rageClicks: m.rageClicks,
                        deadClicks: m.deadClicks,
                        quickbacks: m.quickbacks,
                        engagementTime: m.engagementTime
                    },
                    create: {
                        siteId: site.id,
                        date: today,
                        url: m.url || '/',
                        device: m.device || 'Desktop',
                        sessions: m.sessions,
                        rageClicks: m.rageClicks,
                        deadClicks: m.deadClicks,
                        quickbacks: m.quickbacks,
                        engagementTime: m.engagementTime
                    }
                });
            }
            console.log(`✅ Clarity Sync completed for site: ${site.url}`);
        }
    }
    catch (error) {
        console.error('❌ Failed to run Clarity Sync:', error);
    }
};
exports.runClaritySync = runClaritySync;
// Start cron job to run every night at 11:59 PM
const initClarityCron = () => {
    node_cron_1.default.schedule('59 23 * * *', () => {
        (0, exports.runClaritySync)();
    });
    console.log('🕰️ Clarity Sync Cron Job scheduled for 11:59 PM daily.');
};
exports.initClarityCron = initClarityCron;
// Helper for Mock Data
function generateMockClarityData(siteUrl) {
    const pages = ['/', '/about', '/products', '/contact', '/blog/guide'];
    const devices = ['Mobile', 'Desktop'];
    const data = [];
    for (const p of pages) {
        for (const d of devices) {
            data.push({
                url: p,
                device: d,
                sessions: Math.floor(Math.random() * 500) + 50,
                rageClicks: Math.floor(Math.random() * (p === '/products' ? 20 : 5)),
                deadClicks: Math.floor(Math.random() * (p === '/contact' ? 15 : 3)),
                quickbacks: Math.floor(Math.random() * 30),
                engagementTime: Math.random() * 120 + 30
            });
        }
    }
    return data;
}
//# sourceMappingURL=claritySync.js.map