import ExchangeRate from "../models/ExchangeRate.js";
import ServiceCostConfig from "../models/credits/ServiceCostConfig.js";

export const CLAUDE_PRICING = {
  // per million tokens (USD)
  "claude-sonnet-4-5-20250929": {
    input: 3.0,
    output: 15.0,
    cache_creation_5m: 3.75, // 1.25x input
    cache_creation_1h: 6.0, // 2x input
    cache_read: 0.3,
  },

  "claude-opus-4-5-20251101": {
    input: 15.0,
    output: 75.0,
    cache_creation_5m: 18.75,
    cache_creation_1h: 30.0,
    cache_read: 1.5,
  },

  "claude-haiku-4-5-20251001": {
    input: 1.0,
    output: 5.0,
    cache_creation_5m: 1.25,
    cache_creation_1h: 2.0,
    cache_read: 0.1,
  },

  "claude-3-5-haiku-20241022": {
    input: 0.8,
    output: 4.0,
    cache_creation_5m: 1.0,
    cache_creation_1h: 1.6,
    cache_read: 0.08,
  },

  "claude-haiku-3-20240307": {
    input: 0.25,
    output: 1.25,
    cache_creation_5m: 0.3125,
    cache_creation_1h: 0.5,
    cache_read: 0.025,
  },
};

export async function calculateCost(
  usage,
  model = "claude-sonnet-4-5-20250929",
) {
  /*
  const pricing = CLAUDE_PRICING[model];

  if (!pricing) {
    throw new Error(
      `Unknown model: ${model}. Available: ${Object.keys(CLAUDE_PRICING).join(", ")}`,
    );
  }

  const {
    input_tokens = 0,
    output_tokens = 0,
    cache_creation_input_tokens = 0,
    cache_creation_1h_input_tokens = 0,
    cache_read_input_tokens = 0,
  } = usage;

  const inputCost = (input_tokens / 1_000_000) * pricing.input;
  const outputCost = (output_tokens / 1_000_000) * pricing.output;
  const cacheCreate5mCost =
    (cache_creation_input_tokens / 1_000_000) * pricing.cache_creation_5m;
  const cacheCreate1hCost =
    (cache_creation_1h_input_tokens / 1_000_000) * pricing.cache_creation_1h;
  const cacheReadCost =
    (cache_read_input_tokens / 1_000_000) * pricing.cache_read;

  let USD_TO_INR;
  try {
    const exchangeRateDoc = await ExchangeRate.findOne().sort({
      createdAt: -1,
    });
    if (exchangeRateDoc && exchangeRateDoc.conversion_rate) {
      USD_TO_INR = exchangeRateDoc.conversion_rate;
    } else {
      throw new Error("No valid exchange rate found in DB");
    }
  } catch (err) {
    console.error("Error fetching USD_TO_INR from DB", err);
    throw new Error("Cannot calculate correct pricing without exchange rate");
  }

  const totalUSD =
    inputCost +
    outputCost +
    cacheCreate5mCost +
    cacheCreate1hCost +
    cacheReadCost;
  const totalINR = totalUSD * USD_TO_INR;
  const credits = Math.ceil(totalINR * 100); // INR → paisa (1 credit = 1 paisa)
  */

  // NEW: Get fixed credit cost from Service Config DB
  let credits
  try {
    const serviceConfig = await ServiceCostConfig.findOne({
      serviceName: "promptGeneration",
    });
    if (serviceConfig && serviceConfig.isActive) {
      credits = serviceConfig.creditCost;
    }
  } catch (err) {
    console.error("Error fetching fixed credit cost from DB:", err.message);
  }

  return {
    model,
    tokens: usage,
    cost: {
      input: 0,
      output: 0,
      cache_create_5m: 0,
      cache_create_1h: 0,
      cache_read: 0,
      totalUSD: 0,
      totalINR: 0,
      credits, // Fixed cost from DB
    },
    formatted: `${credits} credits`,
  };
}
