// @ts-nocheck
import { Worker } from "bullmq";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { logger } from "../../config/logger.js";
import { connection } from "../index.js";
import { sendBulkCampaign } from "../../services/msg91.service.js";
import { trackAndDeductFeatureCredit, checkBulkFeatureCapacity } from "../../utils/creditTracker.js";

const RATE_DELAY_MS = 5000;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const worker = new Worker(
  "whatsapp-campaign-queue",
  async (job) => {
    const { campaignId, template, fromNumber, recipients } = job.data;
    const start = Date.now();

    if (!recipients || !recipients.length) {
      throw new Error("Recipients missing");
    }

    logger.info(`[JOB:${job.id}] Sending bulk campaign to ${recipients.length} recipients`);

    const campaign = await prisma.whatsAppCampaign.findUnique({
      where: { id: campaignId },
      select: { userId: true, status: true }
    });

    if (campaign?.userId) {
      const capacityCheck = await checkBulkFeatureCapacity({
        userId: campaign.userId,
        featureKey: "whatsappMessage",
        requiredCount: recipients.length,
      });

      if (!capacityCheck.canAfford) {
        throw new Error("whatsapp message not send due to you have free plan limits");
      }
    }

    // Transition QUEUED -> PROCESSING
    if (campaign?.status === "QUEUED") {
      await prisma.whatsAppCampaign.update({
        where: { id: campaignId },
        data: { status: "PROCESSING" } // removed startedAt as it's not in schema
      });
    }

    await sleep(RATE_DELAY_MS);

    try {
      const msg91Response = await sendBulkCampaign(template, fromNumber, recipients);
      const reqId = msg91Response.request_id || msg91Response.requestId || msg91Response.message || null;

      await prisma.$transaction([
        prisma.whatsAppCampaign.update({
          where: { id: campaignId },
          data: {
            status: "COMPLETED",
            sent: recipients.length,
          }
        }),
        prisma.whatsAppLog.updateMany({
          where: { campaignId: campaignId, status: "PENDING" },
          data: {
            status: "SENT",
            messageId: reqId,
            sentAt: new Date()
          }
        })
      ]);

      logger.info(`[JOB:${job.id}] Bulk Campaign sent in ${Date.now() - start}ms | RequestId: ${reqId}`);

      if (campaign?.userId) {
        await trackAndDeductFeatureCredit({
          userId: campaign.userId,
          featureKey: "whatsappMessage",
          usageCount: recipients.length,
          referenceId: campaignId,
          referenceModel: "WhatsAppCampaign",
          description: `Sent Bulk WhatsApp to ${recipients.length} recipients`,
          metadata: {
            referenceId: campaignId,
            referenceModel: "WhatsAppMessage",
            title: `WhatsApp Campaign Message`,
            extra: {
              recipientCount: recipients.length,
              templateName: template?.name || null,
            },
          },
        });
      }

      return { success: true, msg91Response, reqId };
    } catch (error: any) {
      await prisma.$transaction([
        prisma.whatsAppCampaign.update({
          where: { id: campaignId },
          data: {
            status: "FAILED",
            failed: { increment: recipients.length }
          }
        }),
        prisma.whatsAppLog.updateMany({
          where: { campaignId: campaignId, status: "PENDING" },
          data: {
            status: "FAILED",
            errorMessage: error.message,
            failedAt: new Date()
          }
        })
      ]);

      logger.error(`[JOB:${job.id}] Bulk Campaign Failed: ${error.message}`);
      throw error;
    }
  },
  {
    connection,
    concurrency: 5,
    lockDuration: 60_000,
    skipVersionCheck: true,
  }
);

worker.on("completed", (job) => {
  logger.info(`[JOB:${job.id}] Completed`);
});

worker.on("failed", (job, err) => {
  logger.error(`[JOB:${job?.id}] Failed: ${err.message}`);
});

export default worker;

