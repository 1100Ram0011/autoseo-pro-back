"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoDetectGa4Property = exports.autoDetectGscProperty = exports.updateSiteSettings = exports.getSitePages = exports.addSite = exports.getSites = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const getSites = async (req, res) => {
    const email = req.query.email;
    const userId = req.query.userId;
    try {
        if (email) {
            let user = await prisma_1.default.user.findUnique({ where: { email } });
            if (!user) {
                user = await prisma_1.default.user.create({
                    data: {
                        email,
                        name: email.split('@')[0] || 'User',
                    }
                });
            }
            const sites = await prisma_1.default.site.findMany({
                where: { userId: user.id },
                include: { pages: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json(sites);
        }
        else if (userId) {
            const sites = await prisma_1.default.site.findMany({
                where: { userId },
                include: { pages: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json(sites);
        }
        else {
            const sites = await prisma_1.default.site.findMany({
                include: { pages: true },
                orderBy: { createdAt: 'desc' }
            });
            return res.json(sites);
        }
    }
    catch (error) {
        console.error('Failed to fetch sites:', error);
        res.status(500).json({ error: 'Failed to fetch sites' });
    }
};
exports.getSites = getSites;
const addSite = async (req, res) => {
    const email = req.query.email;
    const { url } = req.body;
    if (!email || !url) {
        return res.status(400).json({ error: 'Email and URL are required' });
    }
    try {
        // Ensure User exists
        let user = await prisma_1.default.user.findUnique({ where: { email } });
        if (!user) {
            user = await prisma_1.default.user.create({
                data: { email, name: email.split('@')[0] || 'User' }
            });
        }
        const newSite = await prisma_1.default.site.create({
            data: {
                userId: user.id,
                url,
            }
        });
        res.json(newSite);
    }
    catch (error) {
        console.error('Failed to add site:', error);
        res.status(500).json({ error: 'Failed to add site' });
    }
};
exports.addSite = addSite;
const getSitePages = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({
            where: { id: req.params.id },
            include: { pages: { orderBy: { url: 'asc' } } }
        });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        res.json(site);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch pages' });
    }
};
exports.getSitePages = getSitePages;
const updateSiteSettings = async (req, res) => {
    try {
        const { ga4PropertyId, gscPropertyId } = req.body;
        const dataToUpdate = {};
        // Server-side normalization of Property ID
        if (ga4PropertyId !== undefined) {
            let normalizedId = ga4PropertyId;
            if (normalizedId && !normalizedId.startsWith('properties/')) {
                normalizedId = `properties/${normalizedId}`;
            }
            dataToUpdate.ga4PropertyId = normalizedId || null;
        }
        if (gscPropertyId !== undefined) {
            dataToUpdate.gscPropertyId = gscPropertyId || null;
        }
        const updatedSite = await prisma_1.default.site.update({
            where: { id: req.params.id },
            data: dataToUpdate
        });
        res.json(updatedSite);
    }
    catch (error) {
        console.error('Failed to update site settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
};
exports.updateSiteSettings = updateSiteSettings;
const autoDetectGscProperty = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const { getGscSites } = require('../services/gsc');
        const { siteEntry } = await getGscSites(site.userId);
        // Find matching GSC property
        const urlObj = new URL(site.url);
        const domain = urlObj.hostname;
        const match = siteEntry.find((s) => s.siteUrl === `sc-domain:${domain}` ||
            s.siteUrl === site.url ||
            s.siteUrl === site.url + '/');
        if (match) {
            const updatedSite = await prisma_1.default.site.update({
                where: { id: site.id },
                // @ts-ignore - Prisma Client needs to be generated
                data: { gscPropertyId: match.siteUrl }
            });
            return res.json({ success: true, propertyId: match.siteUrl, site: updatedSite });
        }
        res.status(404).json({ error: 'No matching GSC property found. Please add it manually.' });
    }
    catch (error) {
        console.error('Auto-detect GSC Error:', error);
        res.status(500).json({ error: 'Failed to auto-detect GSC property' });
    }
};
exports.autoDetectGscProperty = autoDetectGscProperty;
const autoDetectGa4Property = async (req, res) => {
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: req.params.id } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        const { getAuth } = require('../services/gsc');
        const auth = await getAuth(site.userId);
        if (!auth)
            return res.status(401).json({ error: 'Google Auth required' });
        const { getGa4AccountsAndProperties } = require('../services/ga4');
        const accounts = await getGa4AccountsAndProperties(auth);
        const { google } = require('googleapis');
        const admin = google.analyticsadmin({ version: 'v1beta', auth });
        const urlObj = new URL(site.url);
        const domain = urlObj.hostname.replace('www.', '');
        for (const account of accounts) {
            try {
                const propsRes = await admin.properties.list({ filter: `parent:${account.account}` });
                const properties = propsRes.data.properties || [];
                for (const prop of properties) {
                    if ((prop.displayName && prop.displayName.toLowerCase().includes(domain.toLowerCase())) ||
                        (prop.defaultUri && prop.defaultUri.includes(domain))) {
                        const updatedSite = await prisma_1.default.site.update({
                            where: { id: site.id },
                            // @ts-ignore
                            data: { ga4PropertyId: prop.name }
                        });
                        return res.json({ success: true, propertyId: prop.name, site: updatedSite });
                    }
                }
            }
            catch (e) {
                console.warn('Error fetching properties for account', account.account, e);
            }
        }
        res.status(404).json({ error: 'No matching GA4 property found. Please add it manually.' });
    }
    catch (error) {
        console.error('Auto-detect GA4 Error:', error);
        res.status(500).json({ error: 'Failed to auto-detect GA4 property' });
    }
};
exports.autoDetectGa4Property = autoDetectGa4Property;
//# sourceMappingURL=sites.controller.js.map