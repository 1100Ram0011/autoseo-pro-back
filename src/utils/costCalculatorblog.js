/**
 * Gemini 2.5 Flash aur Image Model ki cost Rupees (INR) mein calculate karne ke liye utility function
 * @param {Object} usageMetadata - Gemini response se mila usageMetadata object
 * @param {boolean} hasImage - Kya is run mein image generate hui hai?
 * @returns {Object} Cost breakdown in INR
 */
export function calculateExecutionCost(usageMetadata, hasImage = false) {
  if (!usageMetadata) return { total: "₹0.00", textCost: "0.00", imageCost: "0.00" };

  const { promptTokenCount = 0, candidatesTokenCount = 0, totalTokenCount = 0 } = usageMetadata;

  // 2026 Standard USD to INR Exchange Rate
  const USD_TO_INR = 95.70  ;

  // Gemini 2.5 Flash Pricing (per 1 Million tokens in USD)
  const INPUT_PER_MILLION_USD = 0.075;
  const OUTPUT_PER_MILLION_USD = 0.30;
  const CACHE_PER_MILLION_USD = INPUT_PER_MILLION_USD * 0.25; // Context caching 75% sasta hota hai

  // Background context/cached tokens calculate karein (total - input - output)
  const cacheTokenCount = Math.max(0, totalTokenCount - (promptTokenCount + candidatesTokenCount));

  // Individual USD calculations
  const inputUSD = (promptTokenCount / 1000000) * INPUT_PER_MILLION_USD;
  const outputUSD = (candidatesTokenCount / 1000000) * OUTPUT_PER_MILLION_USD;
  const cacheUSD = (cacheTokenCount / 1000000) * CACHE_PER_MILLION_USD;

  // INR Conversion
  const textCostINR = (inputUSD + outputUSD + cacheUSD) * USD_TO_INR;
  const imageCostINR = hasImage ? 2.00 : 0.00; // Standard Gemini Image base price approx ₹2.00

  const totalCostINR = textCostINR + imageCostINR;

  return {
    textCost: textCostINR.toFixed(4),      // Paise fractions dekhne ke liye 4 decimals
    imageCost: imageCostINR.toFixed(2),
    totalCost: totalCostINR.toFixed(2),
    formattedTotal: `₹${totalCostINR.toFixed(2)}`
  };
}