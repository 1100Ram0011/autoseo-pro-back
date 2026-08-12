import { ServiceCostConfig } from "../models/credits/index.js";
import ExchangeRate from "../models/ExchangeRate.js";

const getLatestUsdToInrRate = async (fallback = 85) => {
  try {
    const exchangeRateDoc = await ExchangeRate.findOne().sort({ createdAt: -1 });
    if (exchangeRateDoc && Number(exchangeRateDoc.conversion_rate) > 0) {
      return Number(exchangeRateDoc.conversion_rate);
    }
  } catch (error) {
    console.error("Error fetching USD to INR exchange rate:", error);
  }
  return fallback;
};

/**
 * Calculates the real Claude cost incurred by cross-platform profile discovery.
 * Web search is billed separately from model tokens by Anthropic.
 */
export const calculateSocialDiscoveryClaudeCost = async ({
  model = "claude-haiku-4-5-20251001",
  inputTokens = 0,
  outputTokens = 0,
  searches = 0,
} = {}) => {
  const safeInputTokens = Math.max(0, Number(inputTokens || 0));
  const safeOutputTokens = Math.max(0, Number(outputTokens || 0));
  const safeSearches = Math.max(0, Number(searches || 0));
  const isHaiku = String(model).toLowerCase().includes("haiku");
  const inputUsdPerMillion = Number(
    process.env.CLAUDE_SOCIAL_DISCOVERY_INPUT_USD_PER_MTOK ||
      (isHaiku ? 1 : 3),
  );
  const outputUsdPerMillion = Number(
    process.env.CLAUDE_SOCIAL_DISCOVERY_OUTPUT_USD_PER_MTOK ||
      (isHaiku ? 5 : 15),
  );
  const webSearchUsdPerRequest = Number(
    process.env.CLAUDE_WEB_SEARCH_USD_PER_REQUEST || 0.01,
  );
  const inputCostUSD =
    (safeInputTokens / 1_000_000) * inputUsdPerMillion;
  const outputCostUSD =
    (safeOutputTokens / 1_000_000) * outputUsdPerMillion;
  const webSearchCostUSD = safeSearches * webSearchUsdPerRequest;
  const totalCostUSD = inputCostUSD + outputCostUSD + webSearchCostUSD;
  const exchangeRateUsdToInr = await getLatestUsdToInrRate(85);
  const totalCostINR = totalCostUSD * exchangeRateUsdToInr;

  return {
    model,
    inputTokens: safeInputTokens,
    outputTokens: safeOutputTokens,
    totalTokens: safeInputTokens + safeOutputTokens,
    searches: safeSearches,
    inputUsdPerMillion,
    outputUsdPerMillion,
    webSearchUsdPerRequest,
    inputCostUSD,
    outputCostUSD,
    webSearchCostUSD,
    totalCostUSD,
    exchangeRateUsdToInr,
    totalCostINR,
    credits: totalCostINR,
    formatted: {
      inputCost: `$${inputCostUSD.toFixed(6)}`,
      outputCost: `$${outputCostUSD.toFixed(6)}`,
      webSearchCost: `$${webSearchCostUSD.toFixed(6)}`,
      totalCost: `$${totalCostUSD.toFixed(6)}`,
      totalINR: `₹${totalCostINR.toFixed(4)}`,
    },
  };
};

/**
 * Calculates dynamic social audit cost based on the total USD usage from Apify
 * @param {string} platform - e.g., 'instagram', 'linkedin', 'twitter' (optional for logic but kept for metadata)
 * @param {number} totalUsageUsd - The exact usageTotalUsd returned by Apify actor run API
 * @returns {Promise<{credits: number, totalUsageUsd: number, marginMultiplier: number, exchangeRateUsdToInr: number}>}
 */
export const calculateSocialAuditCost = async (platform, totalUsageUsd) => {
  if (!totalUsageUsd || totalUsageUsd <= 0) {
    return {
      credits: 0,
      totalUsageUsd: 0,
      marginMultiplier: 3,
      exchangeRateUsdToInr: 95,
    };
  }

  let marginMultiplier = 3; // Default to 3x profit margin
  let exchangeRateUsdToInr = 95; // Default exchange rate

  // Fetch margin multiplier from DB
  try {
    const marginConfig = await ServiceCostConfig.findOne({
      serviceName: "socialAuditMarginMultiplier",
      isActive: true,
    });
    if (marginConfig && marginConfig.creditCost) {
      marginMultiplier = marginConfig.creditCost;
    }
  } catch (err) {
    console.error("Error fetching social audit margin multiplier config:", err);
  }

  // Fetch exchange rate from DB
  try {
    const exchangeRateDoc = await ExchangeRate.findOne().sort({
      createdAt: -1,
    });
    if (exchangeRateDoc && exchangeRateDoc.conversion_rate) {
      exchangeRateUsdToInr = exchangeRateDoc.conversion_rate;
    } else {
      const exchangeConfig = await ServiceCostConfig.findOne({
        serviceName: "exchangeRate_usd_inr",
        isActive: true,
      });
      if (exchangeConfig && exchangeConfig.creditCost) {
        exchangeRateUsdToInr = exchangeConfig.creditCost;
      }
    }
  } catch (err) {
    console.error(
      "Error fetching USD to INR exchange rate from ExchangeRate model:",
      err,
    );
    try {
      const exchangeConfig = await ServiceCostConfig.findOne({
        serviceName: "exchangeRate_usd_inr",
        isActive: true,
      });
      if (exchangeConfig && exchangeConfig.creditCost) {
        exchangeRateUsdToInr = exchangeConfig.creditCost;
      }
    } catch (e) {}
  }

  // Formula: USD Cost * Margin * Exchange Rate
  const calculatedCreditsInr = Math.ceil(
    totalUsageUsd * marginMultiplier * exchangeRateUsdToInr,
  );
  const finalCredits = Math.max(1, calculatedCreditsInr);

  return {
    credits: finalCredits,
    totalUsageUsd,
    marginMultiplier,
    exchangeRateUsdToInr,
  };
};

export const calculateYouTubeDataApiCost = async (quotaUnits) => {
  const safeQuotaUnits = Math.max(0, Number(quotaUnits || 0));
  if (!safeQuotaUnits) {
    return {
      credits: 0,
      quotaUnits: 0,
      creditPerQuotaUnit: 0.01,
    };
  }

  let creditPerQuotaUnit = 0.01;

  try {
    const quotaConfig = await ServiceCostConfig.findOne({
      serviceName: "youtubeDataApiQuotaUnitCredit",
      isActive: true,
    });
    if (quotaConfig && Number.isFinite(Number(quotaConfig.creditCost))) {
      creditPerQuotaUnit = Number(quotaConfig.creditCost);
    }
  } catch (err) {
    console.error("Error fetching YouTube Data API quota unit config:", err);
  }

  const credits = Number((safeQuotaUnits * creditPerQuotaUnit).toFixed(4));

  return {
    credits,
    quotaUnits: safeQuotaUnits,
    creditPerQuotaUnit,
  };
};

export const calculateTwitterAnalyticsApiCost = async (usageData) => {
  const isTracker = typeof usageData === "object" && usageData !== null;
  const safeRequestCount = Math.max(
    0,
    Number(isTracker ? usageData.requests : usageData || 0),
  );
  const postsFetched = Math.max(
    0,
    Number(isTracker ? usageData.postsFetched : 0),
  );
  const usersFetched = Math.max(
    0,
    Number(isTracker ? usageData.usersFetched : 0),
  );

  if (!safeRequestCount && !postsFetched && !usersFetched) {
    return {
      credits: 0,
      requestCount: 0,
      creditPerRequest: 1,
    };
  }

  let creditPerRequest = 1;

  try {
    const requestConfig = await ServiceCostConfig.findOne({
      serviceName: "twitterAnalyticsApiRequestCredit",
      isActive: true,
    });
    if (requestConfig && Number.isFinite(Number(requestConfig.creditCost))) {
      creditPerRequest = Number(requestConfig.creditCost);
    }
  } catch (err) {
    console.error("Error fetching X Analytics API request config:", err);
  }

  let credits = 0;
  if (isTracker && (postsFetched > 0 || usersFetched > 0)) {
    credits = Number(
      (
        usersFetched * creditPerRequest +
        postsFetched * (creditPerRequest * 0.5)
      ).toFixed(4),
    );
  } else {
    credits = Number((safeRequestCount * creditPerRequest).toFixed(4));
  }

  return {
    credits,
    requestCount: safeRequestCount,
    postsFetched,
    usersFetched,
    creditPerRequest,
  };
};

export const calculateThreadsAnalyticsApiCost = async (requestCount) => {
  const safeRequestCount = Math.max(0, Number(requestCount || 0));
  if (!safeRequestCount) {
    return {
      credits: 0,
      requestCount: 0,
      creditPerRequest: 3,
    };
  }

  let creditPerRequest = 3;

  try {
    const requestConfig = await ServiceCostConfig.findOne({
      serviceName: "threadsAnalyticsApiRequestCredit",
      isActive: true,
    });
    if (requestConfig && Number.isFinite(Number(requestConfig.creditCost))) {
      creditPerRequest = Number(requestConfig.creditCost);
    }
  } catch (err) {
    console.error("Error fetching Threads Analytics API request config:", err);
  }

  const credits = Number((safeRequestCount * creditPerRequest).toFixed(4));

  return {
    credits,
    requestCount: safeRequestCount,
    creditPerRequest,
  };
};
