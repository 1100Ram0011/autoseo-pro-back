import { whatsappRetryQueue } from '../workers/whatsappRetry.worker.js';
import MetaWhatsappLog from '../models/metaWhatsappLogSchema.js';

class MetaRetryEngine {
    /**
     * Evaluate if an error should trigger a retry, and queue it if so.
     * @param {Object} log - The MetaWhatsappLog document.
     * @param {String} phoneNumberId - The WhatsApp phone number ID.
     * @param {Object} originalPayload - The payload that failed to send.
     */
    async evaluateAndQueue(log, phoneNumberId, originalPayload) {
        try {
            // Already processing or terminal state
            if (log.retryStatus !== 'NONE') return;

            // Check if errors array has terminal codes
            // Common non-retriable: 
            // 131050 (User blocked), 131047 (Outside 24h window), 132015 (Template Paused)
            // 131049 (Marketing limit reached)
            const errors = log.errors || [];
            let hasTerminalError = false;
            let errorCode = 'UNKNOWN';
            
            for (const err of errors) {
                const code = Number(err.code);
                if ([131050, 131047, 132015, 131049].includes(code)) {
                    hasTerminalError = true;
                    errorCode = code;
                    break;
                }
                errorCode = code;
            }

            if (hasTerminalError) {
                log.retryStatus = 'EXHAUSTED';
                log.lastErrorCode = String(errorCode);
                await log.save();
                return;
            }

            // Schedule first retry attempt
            log.retryStatus = 'SCHEDULED';
            log.lastErrorCode = String(errorCode);
            await log.save();

            // First retry delay: 1 minute (60000 ms)
            // await whatsappRetryQueue.add('retry-message', {
            //     logId: log._id.toString(),
            //     phoneNumberId,
            //     payload: originalPayload,
            //     attempt: 1
            // }, { delay: 60000 });

            console.log(`[RetryEngine] Queued retry attempt 1 for log ${log._id}`);
        } catch (error) {
            console.error('[RetryEngine] Error queueing retry:', error);
        }
    }
}

export default new MetaRetryEngine();
