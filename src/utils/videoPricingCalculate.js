import { ServiceCostConfig, VideoPricingConfig } from "../models/credits/index.js";

/**
 * Calculates dynamic video cost based on model, quality, duration, and admin margin
 * @param {string} model - e.g., 'pixverse', 'veo'
 * @param {string} quality - e.g., '720p', '1080p'
 * @param {number} totalDurationSeconds - Total seconds (e.g., 8, 16, 24)
 * @returns {Promise<{credits: number, chunks: number, baseCostPerChunk: number, marginPercentage: number}>}
 */
export const calculateDynamicVideoCost = async (model, quality, totalDurationSeconds) => {
  const duration = totalDurationSeconds || 8;

  // Determine chunk duration
  let clipDuration = 8;
  if (model === 'pixverse') {
    if (duration % 10 === 0) clipDuration = 10;
    else if (duration % 8 === 0) clipDuration = 8;
    else if (duration % 5 === 0) clipDuration = 5;
    else clipDuration = 8; // fallback
  }
  else if (model === 'omni-flash') {
    clipDuration = 10
  }
  else {
    clipDuration = 8; // Veo
  }

  const chunks = Math.ceil(duration / clipDuration) || 1;
  let totalBaseCost = 0;
  let baseCostPerChunk = 0;

  try {
    const pricingConfig = await VideoPricingConfig.findOne({ engine: model, resolution: quality, duration: clipDuration });
    if (pricingConfig) {
      baseCostPerChunk = pricingConfig.creditCost;
      totalBaseCost = baseCostPerChunk * chunks;
    } else {
      // Fallback if exactly matching duration not found
      const fallbackConfig = await VideoPricingConfig.findOne({ engine: model, resolution: quality, duration: 8 });
      baseCostPerChunk = fallbackConfig ? fallbackConfig.creditCost : 135;
      totalBaseCost = baseCostPerChunk * chunks;
    }
  } catch (err) {
    console.error("Error fetching VideoPricingConfig:", err);
    baseCostPerChunk = 135;
    totalBaseCost = baseCostPerChunk * chunks;
  }

  let marginPercentage = 100;

  try {
    const configKey = `${model}VideoGenMargin`;
    const config = await ServiceCostConfig.findOne({ serviceName: configKey, isActive: true });

    if (config && config.creditCost) {
      marginPercentage = config.creditCost;
    }
  } catch (err) {
    console.error("Error fetching video generation margin config:", err);
  }

  // Fallback to 100 to absolutely prevent NaN
  const safeMargin = marginPercentage || 100;

  const finalCredits = Math.ceil(totalBaseCost * (safeMargin / 100));
  const finalCostPerChunk = Math.ceil(baseCostPerChunk * (safeMargin / 100));

  return {
    credits: finalCredits,
    chunks,
    baseCostPerChunk,
    finalCostPerChunk,
    marginPercentage,
    totalBaseCost,
    clipDuration
  };
};
