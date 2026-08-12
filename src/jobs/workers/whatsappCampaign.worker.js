import { Worker } from "bullmq";
import logger from "../../config/logger.js";
import { connection } from "../index.js";
import CampaignLog from "../../models/Campaign/WhatsappCampaign/Msg91/whatsappCampaignLogSchema.js";
import { sendBulkCampaign } from "../../services/msg91.service.js";
import { trackAndDeductFeatureCredit, checkBulkFeatureCapacity } from "../../utils/creditTracker.js";

const RATE_DELAY_MS = 5000;
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ── Helper: finalize campaign status atomically ───────────────────────────────
const finalizeIfComplete = async (campaignId) => {
  const campaign = await CampaignLog.findById(campaignId)
    .select("sentCount failedCount totalCount status")
    .lean();

  if (!campaign) return;

  const { sentCount, failedCount, totalCount, status } = campaign;

  // Already finalized by another concurrent worker — skip
  if (["COMPLETED", "FAILED", "PARTIAL"].includes(status)) return;

  if (sentCount + failedCount < totalCount) return; // still more jobs running

  const finalStatus =
    failedCount === 0 ? "COMPLETED" : sentCount === 0 ? "FAILED" : "PARTIAL";

  // $nin guard prevents double-write if two workers race here simultaneously
  await CampaignLog.updateOne(
    { _id: campaignId, status: { $nin: ["COMPLETED", "FAILED", "PARTIAL"] } },
    { $set: { status: finalStatus, completedAt: new Date() } },
  );

  logger.info(`[Campaign:${campaignId}] Marked ${finalStatus}`);
};

// ── Worker ────────────────────────────────────────────────────────────────────
const worker = new Worker(
  "whatsapp-campaign-queue",
  async (job) => {
    const { campaignId, template, fromNumber, recipients } = job.data;
    const start = Date.now();

    if (!recipients || !recipients.length) {
      throw new Error("Recipients missing");
    }

    logger.info(`[JOB:${job.id}] Sending bulk campaign to ${recipients.length} recipients`);

    const campaign = await CampaignLog.findById(campaignId)
      .select("userId")
      .lean();

    if (campaign?.userId) {
      /* ─────────────────────────────────────────────
         PRE-CHECK — FREE LIMITS / CREDITS
      ───────────────────────────────────────────── */
      const capacityCheck = await checkBulkFeatureCapacity({
        userId: campaign.userId,
        featureKey: "whatsappMessage",
        requiredCount: 1,
      });

      if (!capacityCheck.canAfford) {
        throw new Error(
          "whatsapp message not send due to you have free plan limits"
        );
      }
    }

    // ── Mark campaign as PROCESSING (only transitions from QUEUED) ────────
    await CampaignLog.updateOne(
      { _id: campaignId, status: "QUEUED" },
      { $set: { status: "PROCESSING", startedAt: new Date() } },
    );

    await sleep(RATE_DELAY_MS);

    try {
      // ── Send via MSG91 — capture the full API response ─────────────────
      const msg91Response = await sendBulkCampaign(template, fromNumber, recipients);

      // MSG91 returns `requestId` or `request_id` or `message`
      const reqId = msg91Response.request_id || msg91Response.requestId || msg91Response.message || null;

      // ── Atomically mark campaign COMPLETED + save requestId ──────────
      const updated = await CampaignLog.findOneAndUpdate(
        { _id: campaignId },
        {
          $set: {
            status: "COMPLETED",
            msg91RequestId: reqId,
            msg91BulkResponse: msg91Response,
            sentCount: recipients.length, // Assume all accepted by MSG91 API for queuing
            completedAt: new Date(),
          },
        },
        { new: true }
      );

      // Also mark all individual recipients as SENT since MSG91 accepted the bulk payload
      await CampaignLog.updateOne(
        { _id: campaignId },
        {
          $set: { 
            "recipients.$[].status": "SENT",
            "recipients.$[].msg91RequestId": reqId
          },
        }
      );

      logger.info(
        `[JOB:${job.id}] Bulk Campaign sent in ${Date.now() - start}ms | RequestId: ${reqId}`
      );

      // ── Deduct credit for WhatsApp message ────────────────────────────
      if (campaign?.userId) {
        await trackAndDeductFeatureCredit({
          userId: campaign.userId,
          featureKey: "whatsappMessage",
          usageCount: recipients.length,
          referenceId: campaignId,
          referenceModel: "WhatsappCampaignLog",
          description: `Sent Bulk WhatsApp to ${recipients.length} recipients`,
          metadata: {
            referenceId: campaignId,
            referenceModel: "WhatsappMessage",
            title: `WhatsApp Campaign Message`,
            extra: {
              recipientCount: recipients.length,
              templateName: template?.name || null,
            },
          },
        });
      }

      return { success: true, msg91Response, reqId };
    } catch (error) {
      // ── Atomically mark campaign FAILED ──────
      await CampaignLog.updateOne(
        { _id: campaignId },
        {
          $set: {
            status: "FAILED",
            completedAt: new Date(),
            "recipients.$[].status": "FAILED",
            "recipients.$[].error": error.message,
          },
          $inc: { failedCount: recipients.length },
        }
      );

      logger.error(
        `[JOB:${job.id}] Bulk Campaign Failed: ${error.message}`
      );

      throw error; // BullMQ retries
    }
  },
  {
    connection,
    concurrency: 5,
    lockDuration: 60_000,
    skipVersionCheck: true,
  },
);

worker.on("completed", (job) => {
  logger.info(`[JOB:${job.id}] Completed`);
});

worker.on("failed", (job, err) => {
  logger.error(`[JOB:${job?.id}] Failed: ${err.message}`);
});

export default worker;
