import {
  checkBulkFeatureCapacity,
  trackAndDeductFeatureCredit,
} from "./creditTracker.js";
import { CreditBalance } from "../models/credits/index.js";

const SOCIAL_ANALYTICS_FEATURE_KEY = "socialMediaAudit";

export async function assertSocialAnalyticsCredit({
  userId,
  platform,
  usageCount = 1,
}) {
  const capacity = await checkBulkFeatureCapacity({
    userId,
    featureKey: SOCIAL_ANALYTICS_FEATURE_KEY,
    requiredCount: usageCount,
    metadata: { platform, source: "private_social_analytics" },
  });

  if (!capacity.canAfford) {
    const err = new Error(
      capacity.message || "Insufficient credits to refresh social analytics.",
    );
    err.statusCode = 402;
    err.insufficientCredits = true;
    throw err;
  }

  return capacity;
}

export async function deductSocialAnalyticsCredit({
  userId,
  platform,
  referenceId = null,
  description,
  idempotencyKey,
  metadata = {},
}) {
  return trackAndDeductFeatureCredit({
    userId,
    featureKey: SOCIAL_ANALYTICS_FEATURE_KEY,
    usageCount: 1,
    referenceId,
    referenceModel: "socialMediaAnalytics",
    description:
      description || `Refreshed ${platform || "social"} private analytics`,
    idempotencyKey,
    metadata: {
      ...metadata,
      platform,
      source: "private_social_analytics",
      referenceModel: "socialMediaAnalytics",
      extra: {
        ...metadata.extra,
        platform,
      },
    },
  });
}

export async function assertDynamicSocialAnalyticsCredit({
  userId,
  creditAmount,
  label = "social analytics",
}) {
  const safeAmount = Number(creditAmount || 0);
  if (!safeAmount || safeAmount <= 0) return { canAfford: true };

  const wallet = await CreditBalance.findOne({
    userId,
    isActive: true,
    validUntil: { $gt: new Date() },
    balance: { $gte: safeAmount },
  }).sort({ priority: 1, validUntil: 1 });

  if (!wallet) {
    const err = new Error(
      `Insufficient credits. This ${label} costs ${safeAmount} credits. Please upgrade your plan.`,
    );
    err.statusCode = 402;
    err.insufficientCredits = true;
    throw err;
  }

  return {
    canAfford: true,
    balance: wallet.balance,
    walletId: wallet._id,
  };
}
