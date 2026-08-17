// @ts-nocheck
import cron from "node-cron";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import { bulkEmailQueue } from "./index.js";
import moment from "moment";
import logger from "../config/logger.js";
import { getTierDailyLimit } from "../utils/emailTypeDetector.js";
import { scheduleEmailLimitReset, REFILL_WINDOW_MS } from "./resetEmailDailyLimits.job.js";
import { emitCampaignUpdated } from "../utils/campaignSocketHelper.js";

export const dispatchEmailCampaigns = async () => {
  const job = { id: "cron" };
  logger.info("[Dispatcher] Running email campaign dispatcher job...");

  try {
    const campaigns = await prisma.emailCampaign.findMany({
      where: {
        OR: [
          { status: { in: ["queued", "processing", "sending"] } },
          { status: "paused", resumeAt: { lte: new Date() } },
          { status: "paused", holdReason: "No active connected email accounts found. Please reconnect or configure your accounts." },
        ],
      },
      orderBy: { createdAt: "asc" }
    });

    if (!campaigns.length) {
      logger.info("[Dispatcher] No active email campaigns to process.");
      return;
    }

    const todayStr = moment().utcOffset("+05:30").format("YYYY-MM-DD");

    for (const campaign of campaigns) {
      logger.info(`[Dispatcher] Processing campaign: ${campaign.name} (${campaign.id})`);

      const tokenQuery: any = {
        userId: campaign.userId,
        isActive: true,
        status: "active",
      };

      if (campaign.provider && campaign.provider !== "multi" && campaign.provider !== "system") {
        tokenQuery.provider = campaign.provider;
        if (campaign.campaignMail) {
          tokenQuery.email = campaign.campaignMail.toLowerCase();
        }
      }

      const tokens = await prisma.emailToken.findMany({ where: tokenQuery });

      if (!tokens.length) {
        if (campaign.provider !== "system") {
          logger.warn(`[Dispatcher] No active email connections found for campaign ${campaign.id}. Pausing campaign.`);
          await prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: {
              status: "paused",
              holdReason: "No active connected email accounts found. Please reconnect or configure your accounts.",
            }
          });
          continue;
        }
      }

      const activeSenders: any[] = [];
      let totalRemainingCapacity = 0;
      let earliestRefillTime: Date | null = null;

      if (campaign.provider === "system") {
        totalRemainingCapacity = 10000;
        activeSenders.push({
          isSystem: true,
          remaining: 10000,
          email: "info@borade.ai",
          provider: "system",
        });
      } else {
        for (const token of tokens) {
          const metadata: any = token.metadata || {};
          const quotaExceededAt = metadata.quotaExceededAt ? new Date(metadata.quotaExceededAt) : null;

          if (quotaExceededAt && Date.now() - quotaExceededAt.getTime() < 24 * 60 * 60 * 1000) {
            continue;
          }

          const inFlightCount = await prisma.campaignRecipientLog.count({
            where: { senderTokenId: token.id, status: "dispatching" },
          });

          const rawLimit = Math.max(0, token.dailyLimit || 0);
          const effectiveRemaining = Math.max(0, rawLimit - inFlightCount);

          if (effectiveRemaining > 0) {
            activeSenders.push({
              token,
              remaining: effectiveRemaining,
              email: token.email,
              provider: token.provider,
              idStr: token.id,
            });
            totalRemainingCapacity += effectiveRemaining;
          } else {
            await scheduleEmailLimitReset(token);
            let depletedAt = metadata.limitDepletedAt ? new Date(metadata.limitDepletedAt) : 
                             metadata.quotaExceededAt ? new Date(metadata.quotaExceededAt) : new Date();
            let refill = new Date(depletedAt.getTime() + REFILL_WINDOW_MS);
            if (!earliestRefillTime || refill < earliestRefillTime) earliestRefillTime = refill;
          }
        }
      }

      const queuedRemainingCount = await prisma.campaignRecipientLog.count({
        where: { campaignId: campaign.id, status: { in: ["queued", "scheduled"] } },
      });

      if (totalRemainingCapacity > 0 && campaign.rolloverAttempts > 0) {
        await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { rolloverAttempts: 0 } });
      }

      if (totalRemainingCapacity === 0 && queuedRemainingCount > 0) {
        const currentAttempts = campaign.rolloverAttempts || 0;
        if (currentAttempts >= 1) {
          await prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: {
              status: "failed",
              holdReason: `Daily sending limit is still 0 after ${currentAttempts} rollover attempt(s).`,
              completedAt: new Date()
            }
          });

          await prisma.campaignRecipientLog.updateMany({
            where: { campaignId: campaign.id, status: { in: ["queued", "scheduled"] } },
            data: { status: "rejected", errorReason: "Campaign failed after 1 rollover attempt." }
          });

          const totalFailed = await prisma.campaignRecipientLog.count({
            where: { campaignId: campaign.id, status: { in: ["rejected", "bounced"] } },
          });
          await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { failedCount: totalFailed } });
          continue;
        }

        const nextRefillTime = earliestRefillTime && earliestRefillTime > new Date() ? earliestRefillTime : new Date(Date.now() + REFILL_WINDOW_MS);
        
        await prisma.emailCampaign.update({
          where: { id: campaign.id },
          data: {
            status: "paused",
            holdReason: `Daily sending limits reached. Emails will be sent when limits refill.`,
            resumeAt: nextRefillTime,
            rolloverAttempts: currentAttempts + 1
          }
        });

        emitCampaignUpdated(campaign.userId, campaign.id);

        await prisma.campaignRecipientLog.updateMany({
          where: { campaignId: campaign.id, status: "queued" },
          data: {
            status: "scheduled",
            errorReason: `Scheduled to send on ${nextRefillTime.toISOString()} IST when limits refill.`,
          }
        });
        continue;
      }

      const pendingRecipients = await prisma.campaignRecipientLog.findMany({
        where: { campaignId: campaign.id, status: { in: ["queued", "scheduled"] } },
        take: totalRemainingCapacity
      });

      if (pendingRecipients.length === 0) {
        const activeOrQueuedCount = await prisma.campaignRecipientLog.count({
          where: { campaignId: campaign.id, status: { in: ["queued", "scheduled", "dispatching"] } },
        });

        if (activeOrQueuedCount === 0) {
          await prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: { status: "completed", completedAt: new Date() }
          });
          emitCampaignUpdated(campaign.userId, campaign.id);
        }
        continue;
      }

      const bulkJobs = [];
      let senderIndex = 0;

      for (const recipient of pendingRecipients) {
        while (senderIndex < activeSenders.length && activeSenders[senderIndex].remaining <= 0) {
          senderIndex++;
        }
        if (senderIndex >= activeSenders.length) break;

        const sender = activeSenders[senderIndex];
        sender.remaining--;

        await prisma.campaignRecipientLog.update({
          where: { id: recipient.id },
          data: {
            status: "dispatching",
            senderEmail: sender.email,
            senderTokenId: sender.isSystem ? null : sender.idStr,
          }
        });

        const rawDataFile = typeof recipient.dataFile === 'string' ? JSON.parse(recipient.dataFile) : (recipient.dataFile || {});

        bulkJobs.push({
          name: "send-email",
          data: {
            campaignId: campaign.id,
            templateId: campaign.templateId,
            recipientData: {
              email: recipient.recipientEmail,
              name: recipient.recipientName,
              companyName: recipient.companyName,
              ...rawDataFile,
            },
            senderEmail: sender.email,
            senderProvider: sender.provider,
            senderTokenId: sender.isSystem ? null : sender.idStr,
          },
          opts: {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        });
      }

      if (bulkJobs.length > 0) {
        if (campaign.status !== "sending") {
          await prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: {
              status: "sending",
              startedAt: campaign.startedAt || new Date(),
              rolloverAttempts: 0,
              holdReason: null,
              resumeAt: null,
            }
          });
        }

        await bulkEmailQueue.addBulk(bulkJobs);

        if (queuedRemainingCount > bulkJobs.length) {
          const leftovers = queuedRemainingCount - bulkJobs.length;
          const nextRefillTime = earliestRefillTime && earliestRefillTime > new Date() ? earliestRefillTime : new Date(Date.now() + REFILL_WINDOW_MS);
          
          await prisma.emailCampaign.update({
            where: { id: campaign.id },
            data: {
              status: "paused",
              holdReason: `Daily sending limits reached. ${leftovers} remaining emails will be sent when limits refill.`,
              resumeAt: nextRefillTime
            }
          });

          await prisma.campaignRecipientLog.updateMany({
            where: { campaignId: campaign.id, status: "queued" },
            data: {
              status: "scheduled",
              errorReason: `Scheduled to send on ${nextRefillTime.toISOString()} IST when limits refill.`
            }
          });
        }
      }
    }
  } catch (error: any) {
    logger.error(`[Dispatcher] Error in campaign dispatcher job: ${error.message}`, error);
  }
};

export const initEmailDispatcherCron = () => {
  cron.schedule("*/5 * * * *", dispatchEmailCampaigns);
  logger.info("Email Dispatcher Cron initialized.");
};

