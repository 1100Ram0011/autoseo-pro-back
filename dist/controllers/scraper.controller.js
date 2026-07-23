"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkJobStatus = exports.startScrapeJob = void 0;
const firecrawlQueue_1 = require("../jobs/firecrawlQueue");
const startScrapeJob = async (req, res) => {
    try {
        const { websiteUrl, userId } = req.body;
        if (!websiteUrl) {
            res.status(400).json({ error: 'websiteUrl is required' });
            return;
        }
        const uid = userId || 'anonymous';
        const job = await firecrawlQueue_1.firecrawlQueue.add('scrape-job', {
            websiteUrl,
            userId: uid
        });
        res.status(200).json({ message: 'Scraping job added to queue', jobId: job.id });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.startScrapeJob = startScrapeJob;
const checkJobStatus = async (req, res) => {
    try {
        const jobId = req.params.jobId;
        const job = await firecrawlQueue_1.firecrawlQueue.getJob(jobId);
        if (!job) {
            res.status(404).json({ error: 'Job not found' });
            return;
        }
        const state = await job.getState();
        const progress = job.progress;
        const result = job.returnvalue;
        const failedReason = job.failedReason;
        res.status(200).json({
            id: job.id,
            state,
            progress,
            result,
            failedReason,
        });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
};
exports.checkJobStatus = checkJobStatus;
//# sourceMappingURL=scraper.controller.js.map