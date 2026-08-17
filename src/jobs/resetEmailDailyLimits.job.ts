// @ts-nocheck
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { resetEmailLimitsQueue } from "./index.js";
import { getTierDailyLimit } from "../utils/emailTypeDetector.js";
import logger from "../config/logger.js";
import config from "../config/config.js";

export const REFILL_WINDOW_MS = Number(process.env.EMAIL_REFILL_WINDOW_MS) || (config.NODE_ENV === "development" ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000);

export const scheduleEmailLimitReset = async (token: any, customMs: number | null = null) => {
  if (!token || !token.id) return;
  const tokenIdStr = token.id;

  try {
    let depletedAt = null;
    const metadata: any = token.metadata || {};
    if (metadata.limitDepletedAt) {
      depletedAt = new Date(metadata.limitDepletedAt);
    } else if (metadata.quotaExceededAt) {
      depletedAt = new Date(metadata.quotaExceededAt);
    } else {
      depletedAt = new Date();
      await prisma.emailToken.update({
        where: { id: token.id },
        data: { metadata: { ...metadata, limitDepletedAt: depletedAt } }
      });
    }

    let runAt;
    if (customMs !== null) {
      runAt = new Date(Date.now() + customMs);
    } else {
      const targetTime = depletedAt.getTime() + REFILL_WINDOW_MS;
      if (targetTime > Date.now()) {
        runAt = new Date(targetTime);
      } else {
        runAt = new Date();
      }
    }

    const delay = Math.max(0, runAt.getTime() - Date.now());
    await resetEmailLimitsQueue.add("reset-limit", { tokenId: tokenIdStr, email: token.email }, { delay, jobId: `reset-${tokenIdStr}` });

    logger.info(`Targeted Refill Job Registered for ${token.email}`);
  } catch (err: any) {
    logger.error(`Failed to schedule email limit reset job for ${token.email}: ${err.message}`);
  }
};

import { Worker } from "bullmq";
import redisClient from "../config/redis.js";

export const resetEmailLimitsWorker = new Worker(
  "reset-email-limits-queue",
  async (job) => {
    logger.info("[BullMQ] Running reset email daily limits job...");
    const targetTokenId = job.data?.tokenId;

    try {
      let query: any = { sentAt: { lte: new Date(Date.now() - REFILL_WINDOW_MS + 5000) } };
      if (targetTokenId) {
        query.tokenId = targetTokenId;
      }

      const expiredUsages = await prisma.emailRollingUsage.findMany({ where: query });

      if (!expiredUsages.length) {
        logger.info("[BullMQ] No expired email rolling usages found for limit reset.");
        return;
      }

      const countsByToken: Record<string, number> = {};
      for (const usage of expiredUsages) {
        countsByToken[usage.tokenId] = (countsByToken[usage.tokenId] || 0) + 1;
      }

      let resetCount = 0;

      for (const [tokenIdStr, count] of Object.entries(countsByToken)) {
        const token = await prisma.emailToken.findUnique({ where: { id: tokenIdStr } });
        if (!token) continue;

        const metadata: any = token.metadata || {};
        const maxLimit = metadata.maxDailyLimit ?? getTierDailyLimit(token.tier || "unknown");
        const newLimit = Math.min(maxLimit, (token.dailyLimit || 0) + count);

        if (newLimit !== token.dailyLimit) {
          delete metadata.limitDepletedAt;
          delete metadata.quotaExceededAt;
          delete metadata.limitDiscoveredAt;

          await prisma.emailToken.update({
            where: { id: token.id },
            data: { dailyLimit: newLimit, metadata }
          });

          logger.info(`[BullMQ] Limits refilled for ${token.email} (${token.provider}) by +${count}. New limit: ${newLimit}/${maxLimit}.`);
          resetCount++;

          const pausedCampaigns = await prisma.emailCampaign.findMany({
            where: {
              userId: token.userId,
              status: "paused",
              holdReason: { contains: "daily" }
            },
            select: { id: true }
          });

          if (pausedCampaigns.length > 0) {
            const campaignIds = pausedCampaigns.map((c) => c.id);
            await prisma.emailCampaign.updateMany({
              where: { id: { in: campaignIds } },
              data: { status: "queued", holdReason: null, resumeAt: null }
            });

            await prisma.campaignRecipientLog.updateMany({
              where: { campaignId: { in: campaignIds }, status: "scheduled" },
              data: { status: "queued", errorReason: null }
            });
          }
        }
      }

      const usageIds = expiredUsages.map((u) => u.id);
      await prisma.emailRollingUsage.deleteMany({ where: { id: { in: usageIds } } });

      logger.info(`[BullMQ] Reset complete. Processed ${usageIds.length} rolling logs, refilled limits for ${resetCount} email account(s).`);

      if (resetCount > 0) {
        const { dispatchEmailCampaigns } = await import("./emailCampaignDispatcher.job.js");
        setTimeout(() => dispatchEmailCampaigns(), 5000);
      }
    } catch (error: any) {
      logger.error(`[BullMQ] Error in reset email daily limits job: ${error.message}`, error);
    }
  },
  { connection: redisClient, concurrency: 1 }
);

