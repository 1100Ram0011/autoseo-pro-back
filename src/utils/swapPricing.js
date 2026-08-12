export function getSwapQualityRate(quality) {
  // PixVerse SWAP credits per second.
  // Can be overridden via env for production tuning.
  const envRates = {
    "360p": Number(process.env.SWAP_RATE_360P),
    "540p": Number(process.env.SWAP_RATE_540P),
    "720p": Number(process.env.SWAP_RATE_720P),
    "1080p": Number(process.env.SWAP_RATE_1080P),
  };

  const defaults = {
    "360p": 9,
    "540p": 9,
    "720p": 12,
    // 1080p SWAP not listed in current PixVerse table; allow override only.
    "1080p": NaN,
  };

  const v = envRates[quality];
  if (Number.isFinite(v) && v >= 0) return v;
  return defaults[quality];
}

export function getPlatformMultiplier() {
  const v = Number(process.env.SWAP_PLATFORM_MULTIPLIER);
  if (Number.isFinite(v) && v > 0) return v;
  return 3.0;
}

export function calculateSwapCredits({ durationSeconds, quality }) {
  const qualityRate = getSwapQualityRate(quality);
  if (!Number.isFinite(qualityRate) || qualityRate <= 0) {
    throw new Error(`Unsupported swap quality: ${quality}`);
  }

  const seconds = Math.max(1, Math.ceil(Number(durationSeconds) || 0));
  const maskSelectionCredits = Number(process.env.SWAP_MASK_SELECTION_CREDITS || 2);
  const pixverseCredits = Math.ceil(seconds * qualityRate + maskSelectionCredits);
  const platformMultiplier = getPlatformMultiplier();
  const totalCredits = Math.ceil(pixverseCredits * platformMultiplier);
  const totalInr = Number((totalCredits / 100).toFixed(2)); // 1 credit = 1 paisa

  return {
    durationSeconds: seconds,
    qualityRate,
    maskSelectionCredits,
    pixverseCredits,
    platformMultiplier,
    totalCredits,
    totalInr,
  };
}

export function getEarningSplits() {
  // Defaults to 70% creator, 0% parent, 30% platform.
  // You can set SWAP_CREATOR_PCT and SWAP_PARENT_PCT. Platform gets the remainder.
  const creatorPct = clampPct(Number(process.env.SWAP_CREATOR_PCT), 70);
  const parentPct = clampPct(Number(process.env.SWAP_PARENT_PCT), 0);
  const platformPct = clampPct(100 - creatorPct - parentPct, 30);
  return { creatorPct, parentPct, platformPct };
}

function clampPct(v, fallback) {
  if (!Number.isFinite(v)) return fallback;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return v;
}