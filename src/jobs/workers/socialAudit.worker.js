import { Worker } from "bullmq";
import logger from "../../config/logger.js";
import redisClient from "../../config/redis.js";
import SocialLinkAnalysis from "../../models/SocialLinkAnalysis.js";
import { processSocialLinkAnalysis } from "../../controllers/socialLinkAnalysis.controller.js";
import { deductDynamicCredit } from "../../utils/creditTracker.js";
import {
  calculateSocialDiscoveryClaudeCost,
  calculateSocialAuditCost,
  calculateYouTubeDataApiCost,
} from "../../utils/socialAuditPricingCalculate.js";
import axios from "axios";
import { calculateActualCost } from "../../controllers/socialGrowth.controller.js";
import { date } from "zod";

const connection = redisClient;

const socialAuditWorker = new Worker(
  "social-audit-queue",
  async (job) => {
    const { userId, websiteHash, requestedPlatform, url, publicFetchOptions } =
      job.data || {};

    if (!userId || !websiteHash || !url) {
      throw new Error(
        "Social audit job requires userId, websiteHash, and url.",
      );
    }

    logger.info("[SocialAuditWorker] Job started", {
      jobId: job.id,
      userId,
      websiteHash,
      requestedPlatform,
      url,
      publicFetchOptions,
    });

    await SocialLinkAnalysis.findOneAndUpdate(
      {
        userId,
        websiteHash,
        platform: requestedPlatform,
        url,
      },
      {
        $set: {
          status: "processing",
          errorMessage: "",
          "rawContext.processingStartedAt": new Date(),
        },
      },
    );

    const {
      savedAudit,
      runIds,
      providerUsage,
      publicDataRunAudit,
      socialLinkDiscoveryUsage,
    } =
      await processSocialLinkAnalysis({
        userId,
        websiteHash,
        requestedPlatform,
        url,
        publicFetchOptions,
      });

    let totalUsageUsd = 0;
    if (runIds && runIds.length > 0) {
      for (const run of runIds) {
        totalUsageUsd += run?.usageTotalUsd || 0;
      }
    }

    const youtubeQuotaUsage =
      providerUsage?.type === "quota_units"
        ? providerUsage
        : providerUsage?.youtubeDataApi || null;
    const youtubeCostDetails = youtubeQuotaUsage
      ? await calculateYouTubeDataApiCost(youtubeQuotaUsage.units)
      : null;
    const apifyCostDetails = totalUsageUsd
      ? await calculateSocialAuditCost(requestedPlatform, totalUsageUsd)
      : null;
    // A cached discovery contains historical usage. Never bill it again.
    const currentDiscoveryUsage = socialLinkDiscoveryUsage?.cacheHit
      ? null
      : socialLinkDiscoveryUsage;
    const hasClaudeDiscoveryUsage = Boolean(
      currentDiscoveryUsage &&
        (Number(currentDiscoveryUsage.claudeInputTokens || 0) > 0 ||
          Number(currentDiscoveryUsage.claudeOutputTokens || 0) > 0 ||
          Number(currentDiscoveryUsage.claudeSearches || 0) > 0),
    );
    const claudeDiscoveryCost = hasClaudeDiscoveryUsage
      ? await calculateSocialDiscoveryClaudeCost({
          model:
            currentDiscoveryUsage.claudeModel ||
            "claude-haiku-4-5-20251001",
          inputTokens: currentDiscoveryUsage.claudeInputTokens,
          outputTokens: currentDiscoveryUsage.claudeOutputTokens,
          searches: currentDiscoveryUsage.claudeSearches,
        })
      : null;
    const apifyDiscoveryUsageUsd = Number(
      currentDiscoveryUsage?.apifyUsageUsd || 0,
    );
    const apifyDiscoveryCostDetails = apifyDiscoveryUsageUsd
      ? await calculateSocialAuditCost(
          requestedPlatform,
          apifyDiscoveryUsageUsd,
        )
      : null;
    const providerCredits =
      (youtubeCostDetails?.credits || 0) +
      (apifyCostDetails?.credits || 0) +
      (apifyDiscoveryCostDetails?.credits || 0);
    const providerCostDetails = {
      ...(youtubeCostDetails ? { youtubeDataApi: youtubeCostDetails } : {}),
      ...(apifyCostDetails ? { apify: apifyCostDetails } : {}),
      ...(apifyDiscoveryCostDetails
        ? { socialLinkDiscoveryApify: apifyDiscoveryCostDetails }
        : {}),
    };

    const mainClaudeCost = await calculateActualCost(
      publicDataRunAudit,
      "claude-sonnet-4-6",
    );
    const claudeCostInr =
      (mainClaudeCost?.totalCostINR || 0) +
      (claudeDiscoveryCost?.totalCostINR || 0);
    const ClaudeCost = {
      inputTokens:
        Number(mainClaudeCost?.inputTokens || 0) +
        Number(claudeDiscoveryCost?.inputTokens || 0),
      outputTokens:
        Number(mainClaudeCost?.outputTokens || 0) +
        Number(claudeDiscoveryCost?.outputTokens || 0),
      totalTokens:
        Number(mainClaudeCost?.totalTokens || 0) +
        Number(claudeDiscoveryCost?.totalTokens || 0),
      inputCostUSD:
        Number(mainClaudeCost?.inputCostUSD || 0) +
        Number(claudeDiscoveryCost?.inputCostUSD || 0),
      outputCostUSD:
        Number(mainClaudeCost?.outputCostUSD || 0) +
        Number(claudeDiscoveryCost?.outputCostUSD || 0),
      webSearchCostUSD: Number(claudeDiscoveryCost?.webSearchCostUSD || 0),
      totalCostUSD:
        Number(mainClaudeCost?.totalCostUSD || 0) +
        Number(claudeDiscoveryCost?.totalCostUSD || 0),
      totalCostINR: claudeCostInr,
      mainAudit: mainClaudeCost,
      socialLinkDiscovery: claudeDiscoveryCost,
      formatted: {
        inputCost: `$${(
          Number(mainClaudeCost?.inputCostUSD || 0) +
          Number(claudeDiscoveryCost?.inputCostUSD || 0)
        ).toFixed(6)}`,
        outputCost: `$${(
          Number(mainClaudeCost?.outputCostUSD || 0) +
          Number(claudeDiscoveryCost?.outputCostUSD || 0)
        ).toFixed(6)}`,
        webSearchCost: `$${Number(
          claudeDiscoveryCost?.webSearchCostUSD || 0,
        ).toFixed(6)}`,
        totalCost: `$${(
          Number(mainClaudeCost?.totalCostUSD || 0) +
          Number(claudeDiscoveryCost?.totalCostUSD || 0)
        ).toFixed(6)}`,
        totalINR: `₹${claudeCostInr.toFixed(4)}`,
      },
    };

    if (savedAudit?.publicDataStatus === "unavailable" || savedAudit?.status === "unavailable") {
      logger.info("[SocialAuditWorker] Audit unavailable. Skipped billing.", {
        jobId: job.id,
        auditId: savedAudit?._id,
      });
      return { auditId: savedAudit?._id?.toString(), status: "unavailable" };
    }

    const creditMetadata = {
      platform: requestedPlatform,
      providerUsageUsd: totalUsageUsd,
      providerUsageUnits: providerUsage?.units ?? null,
      providerUsage: providerUsage || null,
      providerCostDetails,
      providerCredits,
      claudeCredits: claudeCostInr,
      socialLinkDiscoveryUsage: currentDiscoveryUsage,
      socialLinkDiscoveryClaudeCost: claudeDiscoveryCost,
      url,
      runIds,
    };

    console.log("[SocialAuditWorker] Provider cost calculated", {
      jobId: job.id,
      userId,
      platform: requestedPlatform,
      providerUsageUsd: totalUsageUsd,
      providerUsageUnits: providerUsage?.units ?? null,
      providerUsage: providerUsage || null,
      providerCredits,
      runIds,
    });
    logger.info("[SocialAuditWorker] Provider cost calculated", {
      jobId: job.id,
      userId,
      platform: requestedPlatform,
      providerUsageUsd: totalUsageUsd,
      providerUsageUnits: providerUsage?.units ?? null,
      providerUsage: providerUsage || null,
      providerCredits,
      runIds,
    });

    const safeProviderCredits = providerCredits || 0;
    const ClaudePlusProviderCost = claudeCostInr + safeProviderCredits;
    console.log("[SocialAuditWorker] Total cost calculated", {
      ClaudePlusProviderCost,
      ClaudeCost,
      providerCostDetails,
      providerCredits,
    });

    const res = await deductDynamicCredit({
      userId,
      featureKey: "socialMediaAudit",
      usageCount: 1,
      referenceId: savedAudit._id,
      creditAmount: Number(ClaudePlusProviderCost.toFixed(2)),
      serviceName: "Social Media Audit",
      referenceModel: "socialMediaAudit",
      description: `Social Media Audit`,
      idempotencyKey: `ai-${savedAudit._id}${new Date().toISOString()}-social-media-audit`,
      metadata: {
        referenceId: savedAudit._id,
        referenceModel: "socialMediaAudit",
        mediaType: "social audit",
        source: "social-media-audit",
        extra: {
          platform: requestedPlatform,
          costBreakdown: creditMetadata,
        },
      },
    });

    console.log("social Media Audit", res);

    logger.info("[SocialAuditWorker] Job completed", {
      jobId: job.id,
      auditId: savedAudit?._id,
      userId,
      websiteHash,
      platform: requestedPlatform,
    });

    return { auditId: savedAudit?._id?.toString(), status: "completed" };
  },
  {
    connection,
    concurrency: 2,
    skipVersionCheck: true,
  },
);

socialAuditWorker.on("failed", async (job, err) => {
  const { userId, websiteHash, requestedPlatform, url } = job?.data || {};
  logger.error("[SocialAuditWorker] Job failed", {
    jobId: job?.id,
    userId,
    websiteHash,
    requestedPlatform,
    url,
    error: err?.message,
  });

  if (!userId || !websiteHash || !requestedPlatform || !url) return;

  await SocialLinkAnalysis.findOneAndUpdate(
    {
      userId,
      websiteHash,
      platform: requestedPlatform,
      url,
    },
    {
      $set: {
        status: "failed",
        errorMessage: err?.message || "Social audit failed.",
        "rawContext.error": err?.message || "Social audit failed.",
        "rawContext.failedAt": new Date(),
      },
    },
  );
});
