import { Queue, QueueEvents } from 'bullmq';
import redisClient from '../../config/redis.js';

// Initialize the queue
export const onboardingQueue = new Queue('whatsapp-onboarding', { connection: redisClient });
export const onboardingQueueEvents = new QueueEvents('whatsapp-onboarding', { connection: redisClient });

export const connectEmbeddedWhatsappOnboarding = async (req, res, next) => {
  try {
    const { code, wabaId, phoneNumberId } = req.body;
    const userId = req.user?.id || req.user?._id;

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
    } catch (jobErr) {
      // Catch any error thrown by the worker
      console.error(`[Onboarding] Worker job failed:`, jobErr.message);
      return res.status(400).json({ 
        success: false, 
        message: jobErr.message || "Failed to complete WhatsApp onboarding" 
      });
    }

  } catch (err) {
    console.error("[Onboarding Controller] Error:", err.message);
    next(err);
  }
};
