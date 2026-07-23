import { Queue, Worker, QueueEvents } from 'bullmq';
export declare const WHATSAPP_VALIDATION_QUEUE_NAME = "whatsapp-number-validation-queue";
export declare const whatsappValidationQueue: Queue<any, any, string, any, any, string>;
export declare const whatsappValidationQueueEvents: QueueEvents;
export declare const whatsappValidationWorker: Worker<any, any, string>;
//# sourceMappingURL=whatsappValidationQueue.d.ts.map