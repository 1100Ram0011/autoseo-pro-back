import { Request, Response, NextFunction } from "express";
import { Queue, QueueEvents } from "bullmq";
import { redis as redisClient } from "../config/redis";

// Initialize the queue
export const onboardingQueue = new Queue('whatsapp-onboarding', { connection: redisClient as any });
export const onboardingQueueEvents = new QueueEvents('whatsapp-onboarding', { connection: redisClient as any });

export const connectEmbeddedWhatsappOnboarding = async (req: Request, res: Response, next: NextFunction): Promise<any> => {
    try {
        const { code, wabaId, phoneNumberId } = req.body;
        const userId = (req as any).user?.id;

        if (!userId) {
            return res.status(401).json({ success: false, message: "User not authenticated" });
        }

        if (!code || !wabaId) {
            return res.status(400).json({ success: false, message: "Missing code or wabaId" });
        }

        console.log(`[Onboarding] Enqueueing job for user ${userId}`);

        // Add job to BullMQ
        const job = await onboardingQueue.add('onboard-customer', {
            userId,
            code,
            wabaId,
            phoneNumberId
        }, {
            attempts: 1, // Fail fast for synchronous user feedback
        });

        try {
            // Wait for the job to finish so we can return the exact error/success to the frontend
            await job.waitUntilFinished(onboardingQueueEvents);
            
            return res.status(200).json({
                success: true,
                message: "WhatsApp connection established successfully!",
                data: { jobId: job.id }
            });
        } catch (jobErr: any) {
            // Catch any error thrown by the worker
            console.error(`[Onboarding] Worker job failed:`, jobErr.message);
            return res.status(400).json({ 
                success: false, 
                message: jobErr.message || "Failed to complete WhatsApp onboarding" 
            });
        }

    } catch (err: any) {
        console.error("[Onboarding Controller] Error:", err.message);
        next(err);
    }
};
