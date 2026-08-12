/**
 * HeyGen Polling Utility for Asynchronous Operations
 */

import { defaultConfig } from "../config.js";
import { HeyGenTimeoutError, HeyGenError } from "../errors.js";
import { sleep } from "./Utils.js";

export class Poller {
  static async pollTask(checkFn, isCompleteFn, options = {}) {
    const intervalMs = options.intervalMs || defaultConfig.polling.intervalMs;
    const timeoutMs = options.timeoutMs || defaultConfig.polling.timeoutMs;
    const maxAttempts = options.maxAttempts || defaultConfig.polling.maxAttempts;
    const onProgress = options.onProgress;

    const startTime = Date.now();
    let attempts = 0;

    while (attempts < maxAttempts) {
      if (Date.now() - startTime > timeoutMs) {
        throw new HeyGenTimeoutError(`Polling task timed out after ${timeoutMs}ms`);
      }

      attempts++;
      const result = await checkFn();

      if (onProgress) {
        onProgress(result, attempts);
      }

      const completeStatus = isCompleteFn(result);
      if (completeStatus.done) {
        if (completeStatus.error) {
          throw new HeyGenError(
            completeStatus.errorMessage || "Async task failed",
            "TASK_FAILED",
            400,
            result
          );
        }
        return result;
      }

      await sleep(intervalMs);
    }

    throw new HeyGenTimeoutError(`Polling task reached maximum attempts limit (${maxAttempts})`);
  }
}

export default Poller;
