// @ts-nocheck
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import socketService from "../socket.js";

const FREE_FEATURE_MAPPING: Record<string, string> = {
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
  whatsappMessage: "whatsappMessage"
};

export async function checkBulkFeatureCapacity({
  userId,
  featureKey,
  requiredCount,
  metadata = {},
}: any) {
  const freeKey = FREE_FEATURE_MAPPING[featureKey];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  
  if (!user) {
    throw { status: 404, message: "User not found" };
  }

  let freeRemaining = 0;
  let freeLimit = 0;
  let freeUsed = 0;
  let isLimitExplicitlyZero = false;

  if (freeKey) {
    const master = await prisma.freeUsageMaster.findUnique({ where: { featureKey: freeKey } });
    if (master) {
      freeLimit = master.freeLimit;
      if (freeLimit === 0) {
        isLimitExplicitlyZero = true;
      }
      
      const usage = await prisma.freeUsage.findUnique({
        where: { userId_featureKey: { userId, featureKey: freeKey } }
      });
      
      freeUsed = usage ? usage.usageCount : 0;
      
      if (freeLimit === -1) {
        freeRemaining = Infinity;
      } else {
        freeRemaining = Math.max(0, freeLimit - freeUsed);
      }
    }
  }

  const walletCapacity = user.isUnlimited ? Infinity : user.credits;
  const canAfford = !isLimitExplicitlyZero && (freeRemaining >= requiredCount || walletCapacity >= requiredCount);

  let message = "";
  let insufficientCredits = false;

  if (!canAfford) {
    insufficientCredits = true;
    message = "Insufficient credits or free limits. Please upgrade your plan.";
  }

  return {
    canAfford,
    message,
    insufficientCredits,
    available: Math.max(walletCapacity, freeRemaining),
    freeRemaining,
    walletCapacity,
    required: requiredCount,
    freeLimit,
    freeUsed,
  };
}

export const verifyFeatureAccess = async ({ userId, featureKey, usageCount = 1 }: any) => {
  const capacity = await checkBulkFeatureCapacity({ userId, featureKey, requiredCount: usageCount });
  if (!capacity.canAfford) {
    throw { status: 403, message: capacity.message, insufficientCredits: true };
  }
  return { success: true };
};

export const trackAndDeductFeatureCredit = async ({
  userId,
  featureKey,
  usageCount = 1,
  skipWalletDeduction = false,
}: any) => {
  const freeKey = FREE_FEATURE_MAPPING[featureKey];
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  let balanceAfter = user.credits;
  let usedFree = false;

  if (freeKey) {
    const master = await prisma.freeUsageMaster.findUnique({ where: { featureKey: freeKey } });
    if (master) {
      const usage = await prisma.freeUsage.findUnique({
        where: { userId_featureKey: { userId, featureKey: freeKey } }
      });
      
      const currentUsed = usage ? usage.usageCount : 0;
      if (master.freeLimit === -1 || (master.freeLimit - currentUsed) >= usageCount) {
        await prisma.freeUsage.upsert({
          where: { userId_featureKey: { userId, featureKey: freeKey } },
          update: { usageCount: { increment: usageCount } },
          create: { userId, featureKey: freeKey, usageCount: usageCount }
        });
        usedFree = true;
      }
    }
  }

  if (!usedFree && !skipWalletDeduction) {
    if (!user.isUnlimited && user.credits < usageCount) {
      throw { status: 403, message: "Insufficient credits" };
    }
    
    if (!user.isUnlimited) {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { credits: { decrement: usageCount } }
      });
      balanceAfter = updatedUser.credits;
    }
  }

  // Socket notification disabled if it requires socketService, or we can just call it
  try {
    if (socketService?.emitCreditsUpdated) {
      socketService.emitCreditsUpdated(userId, { balance: balanceAfter });
    }
  } catch(e) {}

  return { success: true, balanceAfter };
};

export const deductDynamicCredit = async ({ userId, creditAmount }: any) => {
  if (!creditAmount || creditAmount <= 0) return { success: true, balanceAfter: 0, skipped: true };
  
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || (!user.isUnlimited && user.credits < creditAmount)) {
    throw { status: 403, message: "Insufficient credits" };
  }

  let balanceAfter = user.credits;
  if (!user.isUnlimited) {
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { credits: { decrement: creditAmount } }
    });
    balanceAfter = updatedUser.credits;
  }

  return { success: true, balanceAfter };
};

export const refundDynamicCredit = async ({ userId, creditAmount }: any) => {
  if (!creditAmount || creditAmount <= 0) return { success: true, balanceAfter: 0, skipped: true };
  
  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { credits: { increment: creditAmount } }
  });

  return { success: true, balanceAfter: updatedUser.credits };
};

