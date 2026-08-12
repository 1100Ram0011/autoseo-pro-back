/**
 * HeyGen Retry Policy Utility
 */

import { sleep } from "./Utils.js";
import { HeyGenError, HeyGenAPIError } from "../errors.js";

export const executeWithRetry = async (fn, options = {}) => {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 10000;
  const backoffFactor = options.backoffFactor ?? 2;
  const retryableStatusCodes = options.retryableStatusCodes ?? [408, 429, 500, 502, 503, 504];

  let attempt = 0;
  let delay = initialDelayMs;

  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;

      const isRetryableStatus =
        error.status && retryableStatusCodes.includes(error.status);

      if (attempt > maxRetries || (!isRetryableStatus && error.code !== "ECONNRESET" && error.code !== "ETIMEDOUT")) {
        throw error;
      }

      // Add full jitter
      const jitteredDelay = Math.min(
        maxDelayMs,
        Math.floor(delay * Math.pow(backoffFactor, attempt - 1) * (0.5 + Math.random() * 0.5))
      );

      if (options.onRetry) {
        options.onRetry(error, attempt, jitteredDelay);
      }

      await sleep(jitteredDelay);
    }
  }
};

export default { executeWithRetry };
