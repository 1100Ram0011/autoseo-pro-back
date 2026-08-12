import {
  CreditBalance,
  FreeUsage,
  FreeUsageMaster,
  CreditLog,
  ServiceCostConfig,
} from "../models/credits/index.js";
import mongoose from "mongoose";
import User from "../models/userModel.js";
import socketService from "../socket.js";

/**
 * Mapping for features that have a limited free tier.
 * Only these features will check the FreeUsage collection.
 */
const FREE_FEATURE_MAPPING = {
  websiteAnalysis: "websiteAnalysis",
  individualAnalysis: "individualAnalysis",
  imageGeneration: "aiImageGen",
  videoGeneration: "aiVideoGen",
  leads: "primaryLeads",
  primaryLeads: "primaryLeads",
  email: "sendEmail",
  sentEmails: "sendEmail",
  campaigns: "emailCampaign",
  createTemplates: "emailTemplate",
  templateCreation: "emailTemplate",
  socialConnections: "socialAccounts",
  connectSocialMedia: "socialAccounts",
  socialPosting: "socialPosting",
  emailTemplateAiGeneration: "aiEmailTemplateGen", 
  socialMediaAudit: "socialMediaAudit", 
};

/**
 * Check how many units of a feature the user can afford.
 * Returns { canAfford: boolean, available: number, required: number }
 */
export async function checkBulkFeatureCapacity({
  userId,
  featureKey,
  requiredCount,
  metadata = {},
}) {
  let freeKey = FREE_FEATURE_MAPPING[featureKey];

  let costLookupKey = featureKey;
  if (featureKey === "imagePromptGen" || featureKey === "videoPromptGen") {
    costLookupKey = "promptGeneration";
  }

  const serviceConfig = await ServiceCostConfig.findOne({
    serviceName: costLookupKey,
    isActive: true,
  });
  const costPerUnit = serviceConfig ? serviceConfig.creditCost : 0;
  const totalCost = costPerUnit * requiredCount;

  // 1. Check Wallet Capacity (for ALL features)
  let walletCapacity = 0;
  const eligibleWallets = await CreditBalance.find({
    userId,
    isActive: true,
    validUntil: { $gt: new Date() },
  }).sort({ priority: 1, validUntil: 1 });

  const hasAnyWallet = eligibleWallets.length > 0;
  const hasPaidWallet = eligibleWallets.some((w) => w.planType !== "FREE");

  // Removed restriction: Paid plans can now utilize free usage first.

  if (hasAnyWallet) {
    if (costPerUnit > 0) {
      const totalBalance = eligibleWallets.reduce(
        (sum, w) => sum + w.balance,
        0,
      );
      walletCapacity = Math.floor(totalBalance / costPerUnit);
    } else {
      walletCapacity = Infinity;
    }
  } else if (totalCost === 0) {
    walletCapacity = Infinity;
  }

  // 2. Check Free Capacity (only for free-plan users)
  let freeRemaining = 0;
  let freeUsageDoc = null;

  if (freeKey) {
    freeUsageDoc = await FreeUsage.findOne({ userId });
    if (freeUsageDoc && freeUsageDoc.usage[freeKey]) {
      const { used, limit } = freeUsageDoc.usage[freeKey];
      if (limit === -1) {
        freeRemaining = Infinity;
      } else {
        freeRemaining = Math.max(0, limit - used);
      }
    }
  }

  // Strict Block: If limit is explicitly 0 AND user is on free plan, the feature is disabled
  const isLimitExplicitlyZero =
    freeKey && freeUsageDoc?.usage[freeKey]?.limit === 0;

  // AFFORDABILITY: Combine free remaining and wallet capacity
  const canAfford =
    !isLimitExplicitlyZero &&
    (freeRemaining >= requiredCount || walletCapacity >= requiredCount);

  let message = "";
  let insufficientCredits = false;

  if (!canAfford) {
    insufficientCredits = true;

    if (!isLimitExplicitlyZero && (hasPaidWallet || hasAnyWallet)) {
      message = `Insufficient Credits! This action requires ${totalCost} credits. Please buy more credits or upgrade.`;
    } else {
      message =
        "Your free limits have expired or this feature requires credits. Please upgrade your plan.";

      // Specialized error messages
      if (featureKey === "websiteAnalysis")
        message =
          "website analysis not generate due to you have free plan limits";
      else if (featureKey === "videoGeneration")
        message =
          "video generation not allowed due to you have free plan limits";
      else if (featureKey === "imageGeneration")
        message =
          "image generation not allowed due to you have free plan limits";
      else if (featureKey === "primaryLeads" || featureKey === "leads")
        message =
          "lead generation not allowed due to you have free plan limits";
    }
  }

  return {
    canAfford,
    message,
    insufficientCredits,
    available: Math.max(walletCapacity, freeRemaining),
    freeRemaining,
    walletCapacity,
    required: requiredCount,
    freeLimit: freeKey ? (freeUsageDoc?.usage[freeKey]?.limit ?? 0) : 0,
    freeUsed: freeKey ? (freeUsageDoc?.usage[freeKey]?.used ?? 0) : 0,
  };
}

async function resolveServicePaymentRoute(
  userId,
  featureKey,
  usageCount = 1,
  metadata = {},
) {
  // 1. Determine if user has a paid plan by checking their active wallets
  //    (User model has no 'plan' field — plan is determined by CreditBalance)
  const activeWallets = await CreditBalance.find({
    userId,
    isActive: true,
    validUntil: { $gt: new Date() },
  }).sort({ priority: 1, validUntil: 1 });

  const hasPaidWallet = activeWallets.some((w) => w.planType !== "FREE");

  let freeKey = FREE_FEATURE_MAPPING[featureKey];

  // Removed restriction: Paid plans can now utilize free usage first.
  let costLookupKey = featureKey;
  if (featureKey === "imagePromptGen" || featureKey === "videoPromptGen") {
    costLookupKey = "promptGeneration";
  }

  let serviceConfig = await ServiceCostConfig.findOne({
    serviceName: costLookupKey,
    isActive: true,
  });

  if (!serviceConfig) {
    if (["connectSocialMedia", "socialConnections"].includes(featureKey)) {
      serviceConfig = { creditCost: 0 };
    } else {
      throw {
        status: 500,
        message: `Service configuration missing for ${featureKey}`,
      };
    }
  }

  const costPerUnit = serviceConfig.creditCost;
  const totalCost = costPerUnit * usageCount;

  // 3. Try Free Usage FIRST (for Big 4 only)
  if (freeKey) {
    let freeUsage = await FreeUsage.findOne({ userId });

    if (freeUsage && freeUsage.usage[freeKey]) {
      const { used, limit } = freeUsage.usage[freeKey];

      // Handle "Unlimited" case (-1)
      if (limit === -1) {
        return {
          route: "FREE_USAGE",
          freeKey,
          used,
          remaining: Infinity,
          limit: -1,
          cost: 0,
          wallet: null,
        };
      }

      // Strict Block: If limit is 0, don't allow even with credits
      if (limit === 0) {
        let blockMsg = `${featureKey} not allowed due to you have free plan limits`;
        if (featureKey === "websiteAnalysis")
          blockMsg =
            "website analysis not generate due to you have free plan limits";
        else if (featureKey === "videoGeneration")
          blockMsg =
            "video generation not allowed due to you have free plan limits";
        else if (featureKey === "imageGeneration")
          blockMsg =
            "image generation not allowed due to you have free plan limits";
        else if (featureKey === "primaryLeads" || featureKey === "leads")
          blockMsg =
            "lead generation not allowed due to you have free plan limits";

        throw {
          status: 403,
          message: blockMsg,
          insufficientCredits: true,
        };
      }

      const remaining = Math.max(0, limit - used);
      if (remaining >= usageCount) {
        // Reuse activeWallets from step 1
        const validWallet = activeWallets.find((w) => w.balance >= totalCost);

        return {
          route: "FREE_USAGE",
          freeKey,
          used,
          remaining,
          limit,
          cost: 0, // Free usage costs 0 credits
          serviceCost: totalCost, // The actual value of the service
          wallet:
            validWallet ||
            (activeWallets.length > 0 ? activeWallets[0] : null),
        };
      }
    }
  }

  // 4. Try Wallets (PAID_WALLET / PAID_ZERO_COST)
  // Reuse activeWallets from step 1
  const hasAnyWallet = activeWallets.length > 0;

  if (hasAnyWallet) {
    if (totalCost === 0) {
      return {
        route: "PAID_ZERO_COST",
        cost: 0,
        wallet: activeWallets[0],
        freeKey,
      };
    }

    const validWallet = activeWallets.find((w) => w.balance >= totalCost);
    if (validWallet) {
      return {
        route: "PAID_WALLET",
        cost: totalCost,
        wallet: validWallet,
        freeKey,
      };
    }
  }

  // 5. Special Case: Zero Cost for Free Users (If allowed by system)
  if (totalCost === 0) {
    return {
      route: "FREE_USAGE",
      freeKey: null,
      cost: 0,
      used: 0,
      remaining: Infinity,
      limit: Infinity,
    };
  }

  // 6. Fail
  let msg = "Insufficient credits or free limits. Please upgrade your plan.";
  if (freeKey && !hasAnyWallet) {
    if (featureKey === "websiteAnalysis")
      msg = "website analysis not generate due to you have free plan limits";
    else if (featureKey === "videoGeneration")
      msg = "video generation not allowed due to you have free plan limits";
    else if (featureKey === "imageGeneration")
      msg = "image generation not allowed due to you have free plan limits";
    else if (featureKey === "primaryLeads")
      msg = "lead generation not allowed due to you have free plan limits";
  } else {
    msg =
      "Insufficient Credits! This action requires more Credits. Please upgrade your plan.";
  }

  throw {
    status: 403,
    message: msg,
    insufficientCredits: true,
  };
}

export const verifyFeatureAccess = async ({
  userId,
  featureKey,
  usageCount = 1,
  metadata = {},
}) => {
  const paymentRoute = await resolveServicePaymentRoute(
    userId,
    featureKey,
    usageCount,
    metadata,
  );
  return {
    success: true,
    cost: paymentRoute.cost || 0,
    route: paymentRoute.route,
  };
};

export const trackAndDeductFeatureCredit = async ({
  userId,
  featureKey,
  usageCount = 1,
  referenceId = null,
  referenceModel = null,
  description = "",
  subFeature = null,
  idempotencyKey = null,
  metadata = {},
  skipWalletDeduction = false,
}) => {
  // 1. Idempotency Check
  if (idempotencyKey) {
    const existingLog = await CreditLog.findOne({
      idempotencyKey,
      status: "SUCCESS",
    });
    if (existingLog)
      return { success: true, balanceAfter: existingLog.balanceAfter };
  }

  // 2. Resolve where we pay from
  const paymentRoute = await resolveServicePaymentRoute(
    userId,
    featureKey,
    usageCount,
    metadata,
  );

  const _idempotencyKey =
    idempotencyKey || new mongoose.Types.ObjectId().toString();

  // 3. Perform execution and logging based on Route
  let balanceAfter = 0;
  let chargeAmount = skipWalletDeduction ? 0 : paymentRoute.cost || 0;
  let walletId = null;

  let claimed = null;
  if (paymentRoute.freeKey) {
    if (paymentRoute.route === "FREE_USAGE") {
      // Atomic update of free limit only if we are actually using free usage
      claimed = await FreeUsage.findOneAndUpdate(
        { userId },
        { $inc: { [`usage.${paymentRoute.freeKey}.used`]: usageCount } },
        { new: true },
      );

      if (!claimed) {
        throw {
          status: 409,
          message: "Failed to allocate free usage. Record missing.",
        };
      }
    } else {
      // If we are paying from the wallet, do NOT artificially inflate the used counter.
      // Just fetch the current usage to send back to the frontend.
      claimed = await FreeUsage.findOne({ userId });
    }
  }

  if (paymentRoute.route === "FREE_USAGE") {
    // If there's a cost, we must deduct from the provided wallet (PAID + FREE tracking)
    if (!skipWalletDeduction && paymentRoute.cost > 0 && paymentRoute.wallet) {
      const wallet = paymentRoute.wallet;
      const chargedWallet = await CreditBalance.findOneAndUpdate(
        { _id: wallet._id, balance: { $gte: paymentRoute.cost } },
        { $inc: { balance: -paymentRoute.cost } },
        { new: true },
      );

      if (!chargedWallet) {
        throw {
          status: 409,
          message:
            "Deduction failed due to concurrent wallet updates. Try again.",
        };
      }

      walletId = chargedWallet._id;
      balanceAfter = chargedWallet.balance;
      chargeAmount = paymentRoute.cost;
    } else {
      // Pure free usage (no wallet or cost 0)
      const walletForBalance = await CreditBalance.findOne({
        userId,
        isActive: true,
      }).sort({ priority: 1 });

      balanceAfter = walletForBalance ? walletForBalance.balance : 0;
      chargeAmount = paymentRoute.serviceCost || usageCount; // Log service cost as 'amount' for free usage
      walletId = walletForBalance ? walletForBalance._id : null;
    }

    socketService.emitCreditsUpdated(userId, {
      balance: balanceAfter,
      featureKey,
      freeUsed: claimed?.usage[paymentRoute.freeKey]?.used ?? 0,
      freeLimit: claimed?.usage[paymentRoute.freeKey]?.limit ?? 0,
    });
  } else {
    // PAID ROUTE
    const wallet = paymentRoute.wallet;
    let chargedWallet = wallet;

    if (!skipWalletDeduction && paymentRoute.cost > 0) {
      chargedWallet = await CreditBalance.findOneAndUpdate(
        { _id: wallet._id, balance: { $gte: paymentRoute.cost } },
        { $inc: { balance: -paymentRoute.cost } },
        { new: true },
      );

      if (!chargedWallet) {
        throw {
          status: 409,
          message:
            "Deduction failed due to concurrent wallet updates. Try again.",
        };
      }
    }

    walletId = chargedWallet?._id || wallet?._id;
    balanceAfter = chargedWallet?.balance || wallet?.balance || 0;
    chargeAmount = skipWalletDeduction ? 0 : paymentRoute.cost;

    socketService.emitCreditsUpdated(userId, {
      balance: balanceAfter,
      featureKey,
      freeUsed: claimed?.usage[paymentRoute.freeKey]?.used || 0,
      freeLimit: claimed?.usage[paymentRoute.freeKey]?.limit || 0,
    });
  }

  // Create Log (Skip for social media connections, unlimited free items, AND when explicitly skipping wallet deduction)
  const isSocial = ["socialConnections", "connectSocialMedia"].includes(
    featureKey,
  );
  const isUnlimitedFree = paymentRoute.limit === -1;

  if (!isSocial && !isUnlimitedFree && !skipWalletDeduction) {
    const isFreeUsage = paymentRoute.route === "FREE_USAGE";

    await CreditLog.create({
      idempotencyKey: _idempotencyKey,
      userId,
      walletId,
      type: "DEBIT",
      amount: chargeAmount,
      balanceAfter,
      serviceName: featureKey,
      isFreeUsage,
      description:
        description ||
        `Consumed ${chargeAmount} credits (via ${paymentRoute.route}) for ${featureKey}`,
      status: "SUCCESS",
      metadata: {
        referenceId: metadata.referenceId || referenceId || null,
        referenceModel: metadata.referenceModel || referenceModel || null,
        mediaType: metadata.mediaType || null,
        prompt: metadata.prompt || null,
        title: metadata.title || null,
        mediaUrl: metadata.mediaUrl || null,
        extra: metadata.extra || null,
        isFreeUsage: paymentRoute.route === "FREE_USAGE",
      },
    });
  }

  return {
    success: true,
    via: paymentRoute.route === "FREE_USAGE" ? "FREE_PLAN" : "PAID_PLAN",
    balanceAfter,
  };
};

export const deductDynamicCredit = async ({
  userId,
  creditAmount,
  serviceName = "claudeAPI",
  referenceId = null,
  referenceModel = null,
  description = "",
  metadata = {},
  idempotencyKey = null,
}) => {
  console.log("[CreditTracker] deductDynamicCredit requested", {
    userId,
    creditAmount,
    serviceName,
    referenceId,
    idempotencyKey,
    metadata,
  });

  // Idempotency check (prevents double-charging on retries)
  if (idempotencyKey) {
    const existingLog = await CreditLog.findOne({
      idempotencyKey,
      status: "SUCCESS",
      type: "DEBIT",
    });
    if (existingLog) {
      console.log("[CreditTracker] deductDynamicCredit deduped", {
        userId,
        creditAmount,
        serviceName,
        idempotencyKey,
        balanceAfter: existingLog.balanceAfter,
      });
      return { success: true, balanceAfter: existingLog.balanceAfter, deduped: true };
    }
  }

  if (!creditAmount || creditAmount <= 0) {
    console.log("[CreditTracker] deductDynamicCredit skipped", {
      userId,
      creditAmount,
      serviceName,
      reason: "missing_or_non_positive_amount",
    });
    return { success: true, balanceAfter: 0, skipped: true };
  }

  const eligibleWallets = await CreditBalance.find({
    userId,
    isActive: true,
    validUntil: { $gt: new Date() },
    balance: { $gte: creditAmount },
  }).sort({ priority: 1, validUntil: 1 });

  if (!eligibleWallets.length) {
    throw {
      status: 403,
      message: `Insufficient credits. This action costs ${creditAmount} credits. Please upgrade your plan.`,
      insufficientCredits: true,
    };
  }

  let chargedWallet = null;
  for (const wallet of eligibleWallets) {
    chargedWallet = await CreditBalance.findOneAndUpdate(
      { _id: wallet._id, balance: { $gte: creditAmount } },
      { $inc: { balance: -creditAmount } },
      { new: true },
    );
    if (chargedWallet) break;
  }

  if (!chargedWallet) {
    throw {
      status: 409,
      message: "Deduction failed due to concurrent wallet updates. Try again.",
    };
  }

  await CreditLog.create({
    idempotencyKey: idempotencyKey || new mongoose.Types.ObjectId().toString(),
    userId,
    walletId: chargedWallet._id,
    type: "DEBIT",
    amount: creditAmount,
    balanceAfter: chargedWallet.balance,
    serviceName,
    description:
      description || `Consumed ${creditAmount} credits for ${serviceName}`,
    status: "SUCCESS",
    metadata: {
      referenceId: metadata.referenceId || referenceId || null,
      referenceModel: metadata.referenceModel || referenceModel || null,
      mediaType: metadata.mediaType || null,
      prompt: metadata.prompt || null,
      title: metadata.title || null,
      mediaUrl: metadata.mediaUrl || null,
      extra: metadata.extra || null,
    },
  });

  socketService.emitCreditsUpdated(userId, { balance: chargedWallet.balance });

  console.log("[CreditTracker] deductDynamicCredit success", {
    userId,
    creditAmount,
    serviceName,
    walletId: chargedWallet._id,
    balanceAfter: chargedWallet.balance,
    idempotencyKey,
  });

  return { success: true, balanceAfter: chargedWallet.balance };
};

export const refundDynamicCredit = async ({
  userId,
  creditAmount,
  serviceName = "claudeAPI",
  referenceId = null,
  referenceModel = null,
  description = "",
  metadata = {},
}) => {
  console.log("[CreditTracker] refundDynamicCredit requested", {
    userId,
    creditAmount,
    serviceName,
    referenceId,
    metadata,
  });

  if (!creditAmount || creditAmount <= 0) {
    return { success: true, balanceAfter: 0, skipped: true };
  }

  // Find user's active wallet with the highest priority/expiry
  let wallet = await CreditBalance.findOne({
    userId,
    isActive: true,
    validUntil: { $gt: new Date() },
  }).sort({ priority: 1, validUntil: 1 });

  if (!wallet) {
    wallet = await CreditBalance.findOne({ userId }).sort({ priority: 1, validUntil: 1 });
  }

  if (!wallet) {
    console.error(`[CreditTracker] refundDynamicCredit failed: No wallet found for user ${userId}`);
    return { success: false, reason: "no_wallet_found" };
  }

  const updatedWallet = await CreditBalance.findOneAndUpdate(
    { _id: wallet._id },
    { $inc: { balance: creditAmount } },
    { new: true }
  );

  await CreditLog.create({
    userId,
    walletId: updatedWallet._id,
    type: "CREDIT",
    amount: creditAmount,
    balanceAfter: updatedWallet.balance,
    serviceName,
    description: description || `Refunded ${creditAmount} credits for ${serviceName}`,
    status: "SUCCESS",
    metadata: {
      referenceId: metadata.referenceId || referenceId || null,
      referenceModel: metadata.referenceModel || referenceModel || null,
      mediaType: metadata.mediaType || null,
      prompt: metadata.prompt || null,
      title: metadata.title || null,
      mediaUrl: metadata.mediaUrl || null,
      extra: metadata.extra || null,
    },
  });

  socketService.emitCreditsUpdated(userId, { balance: updatedWallet.balance });

  console.log("[CreditTracker] refundDynamicCredit success", {
    userId,
    creditAmount,
    serviceName,
    walletId: updatedWallet._id,
    balanceAfter: updatedWallet.balance,
  });

  return { success: true, balanceAfter: updatedWallet.balance };
};
