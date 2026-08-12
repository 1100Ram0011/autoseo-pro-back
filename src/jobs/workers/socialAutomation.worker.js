import { Worker } from "bullmq";
import redisClient from "../../config/redis.js";
import logger from "../../config/logger.js";
import SocialAutomationRun from "../../models/SocialAutomationRun.js";
import { executeAutomationRun } from "../../services/socialAutomation.service.js";

export const socialAutomationWorker = new Worker(
  "social-automation-queue",
  async (job) => {
    const { runId } = job.data || {};
    if (!runId) throw new Error("runId is required");

    logger.info("Social automation job started", {
      jobId: job.id,
      runId,
    });

    try {
      const run = await executeAutomationRun({ runId });
      logger.info("Social automation job completed", {
        jobId: job.id,
        runId,
        status: run.status,
      });
      return { runId, status: run.status };
    } catch (err) {
      await SocialAutomationRun.updateOne(
        { _id: runId },
        {
          $set: {
            status: "failed",
            error: err.message,
            finishedAt: new Date(),
          },
        },
      );

      logger.error("Social automation job failed", {
        jobId: job.id,
        runId,
        error: err.message,
        details: err?.response?.data || err?.data || null,
      });

      throw err;
    }
  },
  {
    connection: redisClient,
    concurrency: 3,
  },
);

socialAutomationWorker.on("failed", (job, err) => {
  logger.error("Social automation worker failed handler", {
    jobId: job?.id,
    runId: job?.data?.runId,
    error: err.message,
  });
});
