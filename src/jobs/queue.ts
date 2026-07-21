import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import { AutoSeoEngine, autoSeoEmitter } from '../services/autoSeoEngine';
import prisma from '../config/prisma';

export const SEO_QUEUE_NAME = 'seo-analysis-queue';

export const seoQueue = new Queue(SEO_QUEUE_NAME, {
  connection: redis
});

export const seoQueueEvents = new QueueEvents(SEO_QUEUE_NAME, {
  connection: redis
});

interface SeoJobData {
  reportId: string;
  siteId: string;
  userId: string;
  url: string;
}

// Background Worker processing jobs
export const seoWorker = new Worker<SeoJobData>(
  SEO_QUEUE_NAME,
  async (job) => {
    console.log(`[BullMQ] Processing Job ${job.id} for site ${job.data.siteId}`);
    
    try {
      const engine = new AutoSeoEngine(job.data.reportId, job.data.siteId, job.data.userId, job.data.url);
      
      const listener = (update: any) => {
        job.updateProgress({ step: update.step, status: update.status, message: update.message });
      };
      
      autoSeoEmitter.on(`update-${job.data.reportId}`, listener);
      
      const report = await engine.runScan();
      
      autoSeoEmitter.off(`update-${job.data.reportId}`, listener);
      
      console.log(`[BullMQ] Job ${job.id} completed successfully`);
      return report;
    } catch (error: any) {
      console.error(`[BullMQ] Job ${job.id} failed:`, error.message);
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 5, // Process up to 5 sites concurrently
  }
);

seoWorker.on('completed', (job) => {
  console.log(`[Worker] Job ${job.id} has completed!`);
});

seoWorker.on('failed', (job, err) => {
  console.error(`[Worker] Job ${job?.id} has failed with ${err.message}`);
});
