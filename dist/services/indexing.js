"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBatch = exports.getMetadata = exports.submitUrl = void 0;
const googleapis_1 = require("googleapis");
const getIndexingClient = async () => {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        throw new Error('GOOGLE_APPLICATION_CREDENTIALS missing');
    }
    const auth = new googleapis_1.google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/indexing'],
    });
    const client = await auth.getClient();
    return googleapis_1.google.indexing({ version: 'v3', auth: client });
};
const submitUrl = async (url, type = 'URL_UPDATED') => {
    try {
        const indexing = await getIndexingClient();
        const response = await indexing.urlNotifications.publish({
            requestBody: { url, type }
        });
        return response.data;
    }
    catch (error) {
        console.error(`Error submitting URL ${url}:`, error.message);
        throw error;
    }
};
exports.submitUrl = submitUrl;
const getMetadata = async (url) => {
    try {
        const indexing = await getIndexingClient();
        const response = await indexing.urlNotifications.getMetadata({ url });
        return response.data;
    }
    catch (error) {
        console.error(`Error getting metadata for ${url}:`, error.message);
        // If it's a 404, it just means no notification was sent before
        return null;
    }
};
exports.getMetadata = getMetadata;
const submitBatch = async (urls, type = 'URL_UPDATED') => {
    // Limit to 100 per batch as per Google API limits
    const batchUrls = urls.slice(0, 100);
    try {
        console.log(`Submitting batch of ${batchUrls.length} URLs...`);
        // Simulate batch using Promise.allSettled for robustness
        const results = await Promise.allSettled(batchUrls.map(url => (0, exports.submitUrl)(url, type)));
        const successful = [];
        const failed = [];
        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successful.push({ url: batchUrls[index], data: result.value });
            }
            else {
                failed.push({ url: batchUrls[index], error: result.reason.message });
            }
        });
        return { successful, failed };
    }
    catch (error) {
        console.error('Batch submission failed:', error);
        throw error;
    }
};
exports.submitBatch = submitBatch;
//# sourceMappingURL=indexing.js.map