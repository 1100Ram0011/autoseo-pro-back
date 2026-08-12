import {
  Plan,
  UserSubscription,
  FreeUsage,
  FreeUsageMaster,
  CreditBalance,
} from "../models/credits/index.js";

import { agenda } from "../jobs/agenda/agenda.js";

export const assignFreePlanToUser = async (userId, session = null) => {
  const freePlan = await Plan.findOne({ name: "Free" }).session(session);

  if (!freePlan) {
    throw new Error("Free plan not found");
  }

  const validityType = freePlan.validityType;
  const validityValue = freePlan.validityValue;
  const now = new Date();
  let expiryDate = new Date(now);

  if (validityType === "DAYS") {
    expiryDate.setDate(expiryDate.getDate() + validityValue);
  } else if (validityType === "MONTHS") {
    expiryDate.setMonth(expiryDate.getMonth() + validityValue);
  } else if (validityType === "YEARS") {
    expiryDate.setFullYear(expiryDate.getFullYear() + validityValue);
  } else {
    expiryDate.setFullYear(expiryDate.getFullYear() + 100);
  }

  // Create subscription
  const subArray = await UserSubscription.create(
    [
      {
        userId,
        planId: freePlan._id,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: expiryDate,
        planHistory: [{ planId: freePlan._id, changeType: "initial" }],
      },
    ],
    { session },
  );

  const sub = subArray[0];

  // Schedule agenda job for expiry (If session is provided, this might need care,
  // but usually agenda is outside transaction)
  const job = await agenda.schedule(expiryDate, "subscription-expiry", {
    subscriptionId: sub._id,
  });

  if (job) {
    sub.agendaJobId = job.attrs._id.toString();
    await sub.save({ session });
  }

  // 1. Fetch Master Limits
  const masterLimits = await FreeUsageMaster.find({ isActive: true }).session(
    session,
  );

  const usage = {};

  if (masterLimits.length > 0) {
    masterLimits.forEach((m) => {
      let featureLimit = m.limit || 0;

      // If limit is 0 but freeDays is set, make it "unlimited" (-1)
      if (featureLimit === 0 && m.freeDays > 0) {
        featureLimit = -1;
      }

      // Initialize usage record
      usage[m.featureKey] = {
        used: 0,
        limit: featureLimit,
        freeDays: m.freeDays || 0,
      };
    });
  }

  await FreeUsage.create(
    [
      {
        userId,
        usage,
      },
    ],
    { session },
  );

  const newWalletConfig = {
    userId,
    planType: "FREE",
    subscriptionId: sub._id,
    balance: 0,
    priority: freePlan.priority,
    validUntil: expiryDate,
  };
  await CreditBalance.create([newWalletConfig], {
    session,
  });
};
