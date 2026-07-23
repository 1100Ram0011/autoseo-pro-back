"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFullSeoGsc = exports.getSitesList = exports.getInsights = exports.inspectUrlEndpoint = exports.getSitemaps = exports.getQuery = exports.getDevices = exports.getCountries = exports.getCoverage = exports.getPages = exports.getKeywords = exports.getOverview = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const googleapis_1 = require("googleapis");
const gsc_1 = require("../services/gsc");
const getOverview = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscOverview)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC overview' });
    }
};
exports.getOverview = getOverview;
const getKeywords = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscKeywords)(site.gscPropertyId || site.url, site.userId, site.id);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC keywords' });
    }
};
exports.getKeywords = getKeywords;
const getPages = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscPages)(site.gscPropertyId || site.url, site.userId, site.id);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC pages' });
    }
};
exports.getPages = getPages;
const getCoverage = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscCoverage)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC coverage' });
    }
};
exports.getCoverage = getCoverage;
const getCountries = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscCountries)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC countries' });
    }
};
exports.getCountries = getCountries;
const getDevices = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscDevices)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC devices' });
    }
};
exports.getDevices = getDevices;
const getQuery = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const { startDate, endDate, dimensions, rowLimit, dimensionFilterGroups } = req.body;
        const data = await (0, gsc_1.getGscQuery)(site.gscPropertyId || site.url, site.userId, { startDate, endDate, dimensions, rowLimit, dimensionFilterGroups });
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to execute GSC dynamic query' });
    }
};
exports.getQuery = getQuery;
const getSitemaps = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.getGscSitemaps)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC sitemaps' });
    }
};
exports.getSitemaps = getSitemaps;
const inspectUrlEndpoint = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const { url } = req.body;
        if (!url)
            return res.status(400).json({ error: 'URL is required' });
        const data = await (0, gsc_1.inspectUrl)(site.gscPropertyId || site.url, url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to inspect URL' });
    }
};
exports.inspectUrlEndpoint = inspectUrlEndpoint;
const getInsights = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const data = await (0, gsc_1.analyzeInsights)(site.gscPropertyId || site.url, site.userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to analyze GSC insights' });
    }
};
exports.getInsights = getInsights;
const getSitesList = async (req, res) => {
    const userId = req.query.userId || '1';
    try {
        const data = await (0, gsc_1.getGscSites)(userId);
        res.json(data);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch GSC sites' });
    }
};
exports.getSitesList = getSitesList;
const getFullSeoGsc = async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader)
        return res.status(401).json({ error: 'No authorization token' });
    const accessToken = authHeader.split(' ')[1] || null;
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.siteId } });
        if (!site)
            return res.status(404).send('Site not found');
        const oauth2Client = new googleapis_1.google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: accessToken });
        const sc = googleapis_1.google.searchconsole({ version: 'v1', auth: oauth2Client });
        const today = new Date();
        const ago28 = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
        const ago90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
        const startDate28 = ago28.toISOString().split('T')[0];
        const endDate = today.toISOString().split('T')[0];
        const startDate90 = ago90.toISOString().split('T')[0];
        const base = { siteUrl: site.gscPropertyId || site.url, requestBody: { startDate: startDate28, endDate, rowLimit: 25 } };
        // Run all 5 queries in parallel
        const [queries, pages, countries, devices, dates] = await Promise.all([
            sc.searchanalytics.query({ ...base, requestBody: { ...base.requestBody, dimensions: ['query'] } }),
            sc.searchanalytics.query({ ...base, requestBody: { ...base.requestBody, dimensions: ['page'] } }),
            sc.searchanalytics.query({ ...base, requestBody: { ...base.requestBody, dimensions: ['country'] } }),
            sc.searchanalytics.query({ ...base, requestBody: { ...base.requestBody, dimensions: ['device'] } }),
            sc.searchanalytics.query({ siteUrl: site.gscPropertyId || site.url, requestBody: { startDate: startDate90, endDate, dimensions: ['date'], rowLimit: 90 } }),
        ]);
        // Summary totals from queries
        const allRows = queries.data.rows || [];
        const totalClicks = allRows.reduce((s, r) => s + (r.clicks || 0), 0);
        const totalImpressions = allRows.reduce((s, r) => s + (r.impressions || 0), 0);
        const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0';
        const avgPos = allRows.length > 0
            ? (allRows.reduce((s, r) => s + (r.position || 0), 0) / allRows.length).toFixed(1)
            : '0.0';
        res.json({
            summary: {
                clicks: totalClicks,
                impressions: totalImpressions,
                ctr: avgCtr + '%',
                position: '#' + avgPos,
                dateRange: startDate28 + ' to ' + endDate,
            },
            queries: (queries.data.rows || []).map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%', position: r.position.toFixed(1) })),
            pages: (pages.data.rows || []).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%', position: r.position.toFixed(1) })),
            countries: (countries.data.rows || []).map((r) => ({ country: r.keys[0].toUpperCase(), clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%' })),
            devices: (devices.data.rows || []).map((r) => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
            dates: (dates.data.rows || []).map((r) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
        });
    }
    catch (error) {
        console.error('GSC API Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch GSC data', detail: error.message });
    }
};
exports.getFullSeoGsc = getFullSeoGsc;
//# sourceMappingURL=gsc.controller.js.map