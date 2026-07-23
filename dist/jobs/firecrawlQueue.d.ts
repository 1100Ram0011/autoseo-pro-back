import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const FIRECRAWL_QUEUE_NAME = "firecrawl-queue";
export declare const firecrawlQueue: Queue<any, any, string, any, any, string>;
export declare const firecrawlQueueEvents: QueueEvents;
export declare const firecrawlWorker: Worker<any, any, string>;
//# sourceMappingURL=firecrawlQueue.d.ts.map