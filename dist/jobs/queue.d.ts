import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const SEO_QUEUE_NAME = "seo-analysis-queue";
export declare const seoQueue: Queue<any, any, string, any, any, string>;
export declare const seoQueueEvents: QueueEvents;
interface SeoJobData {
    reportId: string;
    siteId: string;
    userId: string;
    url: string;
}
export declare const seoWorker: Worker<SeoJobData, any, string>;
export {};
//# sourceMappingURL=queue.d.ts.map