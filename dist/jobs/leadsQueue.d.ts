import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const LEADS_QUEUE_NAME = "google-api-lead-generation-queue";
export declare const leadsQueue: Queue<any, any, string, any, any, string>;
export declare const leadsQueueEvents: QueueEvents;
interface LeadJobData {
    targetMarket: string;
    geographicFocus: string;
    numberOfLeads: number;
    userId: string;
}
export declare const leadsWorker: Worker<LeadJobData, any, string>;
export {};
//# sourceMappingURL=leadsQueue.d.ts.map