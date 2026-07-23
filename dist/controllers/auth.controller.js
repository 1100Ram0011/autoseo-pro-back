"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGscProperties = exports.getGoogleProperties = exports.checkGoogleAuthStatus = exports.googleAuthCallback = exports.googleAuth = exports.oauth2Client = void 0;
const googleapis_1 = require("googleapis");
const prisma_1 = __importDefault(require("../config/prisma"));
exports.oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.BACKEND_URL ? `${process.env.BACKEND_URL}/api/auth/google/callback` : 'http://localhost:4000/api/auth/google/callback');
const googleAuth = (req, res) => {
    const email = req.query.email;
    if (!email)
        return res.status(400).json({ error: 'Email required' });
    const redirectTarget = req.query.redirect || "search-console";
    const siteId = req.query.siteId || "";
    const url = exports.oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required to receive a refresh token
        prompt: 'consent', // Force consent to get refresh token
        scope: [
            'https://www.googleapis.com/auth/webmasters.readonly',
            'https://www.googleapis.com/auth/webmasters',
            'https://www.googleapis.com/auth/analytics.readonly'
        ],
        state: `${email}:${redirectTarget}:${siteId}` // Pass email, redirect target and siteId
    });
    res.redirect(url);
};
exports.googleAuth = googleAuth;
const googleAuthCallback = async (req, res) => {
    const { code, state } = req.query;
    const [email, redirectTarget, siteId] = (state || "").split(':');
    try {
        const { tokens } = await exports.oauth2Client.getToken(code);
        // Save refresh token to user in database
        if (tokens && tokens.refresh_token && email) {
            await prisma_1.default.user.update({
                where: { email: email },
                data: { googleRefreshToken: tokens.refresh_token }
            });
        }
        // Auto-fetch and save first GA4 property if siteId exists
        if (siteId) {
            try {
                const tempClient = new googleapis_1.google.auth.OAuth2();
                tempClient.setCredentials(tokens);
                const admin = googleapis_1.google.analyticsadmin({ version: 'v1beta', auth: tempClient });
                const adminRes = await admin.accountSummaries.list();
                if (adminRes.data.accountSummaries) {
                    let firstProperty = null;
                    for (const account of adminRes.data.accountSummaries) {
                        if (account.propertySummaries && account.propertySummaries.length > 0) {
                            firstProperty = account.propertySummaries[0].property || null;
                            break;
                        }
                    }
                    if (firstProperty) {
                        await prisma_1.default.site.update({
                            where: { id: siteId },
                            data: { ga4PropertyId: firstProperty }
                        });
                        console.log(`Auto-saved GA4 property ${firstProperty} for site ${siteId}`);
                    }
                }
            }
            catch (propErr) {
                console.error('Auto-fetch properties failed during callback:', propErr);
            }
        }
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        res.redirect(`${frontendUrl}/dashboard/${redirectTarget || 'search-console'}?success=true`);
    }
    catch (error) {
        console.error('Error during Google OAuth callback:', error);
        res.status(500).send('Authentication failed');
    }
};
exports.googleAuthCallback = googleAuthCallback;
const checkGoogleAuthStatus = async (req, res) => {
    const email = req.query.email;
    if (!email)
        return res.json({ connected: false });
    try {
        const user = await prisma_1.default.user.findUnique({
            where: { email },
            select: { googleRefreshToken: true }
        });
        res.json({ connected: !!user?.googleRefreshToken });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to check status' });
    }
};
exports.checkGoogleAuthStatus = checkGoogleAuthStatus;
const getGoogleProperties = async (req, res) => {
    const email = req.query.email;
    if (!email)
        return res.status(400).json({ error: 'Email required' });
    try {
        const user = await prisma_1.default.user.findUnique({ where: { email } });
        if (!user || !user.googleRefreshToken) {
            return res.status(400).json({ error: 'Not connected to Google' });
        }
        const tempClient = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        tempClient.setCredentials({ refresh_token: user.googleRefreshToken });
        const admin = googleapis_1.google.analyticsadmin({ version: 'v1beta', auth: tempClient });
        const adminRes = await admin.accountSummaries.list();
        const properties = [];
        if (adminRes.data.accountSummaries) {
            for (const account of adminRes.data.accountSummaries) {
                if (account.propertySummaries) {
                    for (const prop of account.propertySummaries) {
                        if (prop.property && prop.displayName) {
                            properties.push({ id: prop.property, name: prop.displayName });
                        }
                    }
                }
            }
        }
        res.json({ properties });
    }
    catch (error) {
        console.error('Error fetching GA4 properties:', error);
        res.status(500).json({ error: 'Failed to fetch properties' });
    }
};
exports.getGoogleProperties = getGoogleProperties;
const getGscProperties = async (req, res) => {
    const email = req.query.email;
    if (!email)
        return res.status(400).json({ error: 'Email required' });
    try {
        const user = await prisma_1.default.user.findUnique({ where: { email } });
        if (!user || !user.googleRefreshToken) {
            return res.status(400).json({ error: 'Not connected to Google' });
        }
        const tempClient = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        tempClient.setCredentials({ refresh_token: user.googleRefreshToken });
        const searchconsole = googleapis_1.google.searchconsole({ version: 'v1', auth: tempClient });
        const resData = await searchconsole.sites.list({});
        const entries = resData.data.siteEntry || [];
        const properties = entries.map(e => ({
            id: e.siteUrl,
            name: e.siteUrl,
            permissionLevel: e.permissionLevel
        }));
        res.json({ properties });
    }
    catch (error) {
        console.error('Error fetching GSC properties:', error);
        res.status(500).json({ error: 'Failed to fetch GSC properties' });
    }
};
exports.getGscProperties = getGscProperties;
//# sourceMappingURL=auth.controller.js.map