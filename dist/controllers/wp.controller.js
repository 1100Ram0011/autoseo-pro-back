"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncToWordPress = void 0;
const axios_1 = __importDefault(require("axios"));
const prisma_1 = __importDefault(require("../config/prisma"));
/**
 * Push AI-generated meta tags to WordPress via REST API
 * Assumes the WordPress site has Application Passwords enabled or uses a custom plugin.
 */
const syncToWordPress = async (req, res) => {
    const siteId = req.params.id;
    const { pageId, metaTitle, metaDescription } = req.body;
    try {
        const site = await prisma_1.default.site.findUnique({ where: { id: siteId } });
        if (!site)
            return res.status(404).json({ error: 'Site not found' });
        // In a real scenario, these would be stored securely in the DB per site
        const wpUrl = process.env.WP_API_URL || `${site.url}/wp-json/wp/v2`;
        const wpUser = process.env.WP_USER;
        const wpAppPassword = process.env.WP_APP_PASSWORD;
        if (!wpUser || !wpAppPassword) {
            return res.status(400).json({ error: 'WordPress credentials not configured for this site.' });
        }
        const authHeader = `Basic ${Buffer.from(`${wpUser}:${wpAppPassword}`).toString('base64')}`;
        // Update the specific page or post in WordPress using standard WP REST API
        // (This might require Yoast/RankMath REST API extensions depending on the site setup)
        const response = await axios_1.default.post(`${wpUrl}/pages/${pageId}`, {
            meta: {
                _yoast_wpseo_title: metaTitle,
                _yoast_wpseo_metadesc: metaDescription,
            }
        }, {
            headers: {
                'Authorization': authHeader,
                'Content-Type': 'application/json'
            }
        });
        res.json({ message: 'Successfully synced to WordPress', data: response.data });
    }
    catch (error) {
        console.error('WP Sync Error:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to sync with WordPress' });
    }
};
exports.syncToWordPress = syncToWordPress;
//# sourceMappingURL=wp.controller.js.map