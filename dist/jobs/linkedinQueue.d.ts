import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const LINKEDIN_QUEUE_NAME = "linkedin-api-lead-generation-queue";
export declare const linkedinQueue: Queue<any, any, string, any, any, string>;
export declare const linkedinQueueEvents: QueueEvents;
interface LinkedinJobData {
    companyName: string;
    userId: string;
    mapLeadId: string;
}
export declare const linkedinWorker: Worker<LinkedinJobData, any, string>;
export {};
//# sourceMappingURL=linkedinQueue.d.ts.map