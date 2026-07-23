"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.seoWorker = exports.seoQueueEvents = exports.seoQueue = exports.SEO_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const autoSeoEngine_1 = require("../services/autoSeoEngine");
exports.SEO_QUEUE_NAME = 'seo-analysis-queue';
exports.seoQueue = new bullmq_1.Queue(exports.SEO_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.seoQueueEvents = new bullmq_1.QueueEvents(exports.SEO_QUEUE_NAME, {
    connection: redis_1.redis
});
// Background Worker processing jobs
exports.seoWorker = new bullmq_1.Worker(exports.SEO_QUEUE_NAME, async (job) => {
    console.log(`[BullMQ] Processing Job ${job.id} for site ${job.data.siteId}`);
    try {
        const engine = new autoSeoEngine_1.AutoSeoEngine(job.data.reportId, job.data.siteId, job.data.userId, job.data.url);
        const listener = (update) => {
            job.updateProgress({ step: update.step, status: update.status, message: update.message });
        };
        autoSeoEngine_1.autoSeoEmitter.on(`update-${job.data.reportId}`, listener);
        const report = await engine.runScan();
        autoSeoEngine_1.autoSeoEmitter.off(`update-${job.data.reportId}`, listener);
        console.log(`[BullMQ] Job ${job.id} completed successfully`);
        return report;
    }
    catch (error) {
        console.error(`[BullMQ] Job ${job.id} failed:`, error.message);
        throw error;
    }
}, {
    connection: redis_1.redis,
    concurrency: 5, // Process up to 5 sites concurrently
});
exports.seoWorker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} has completed!`);
});
exports.seoWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} has failed with ${err.message}`);
});
//# sourceMappingURL=queue.js.map