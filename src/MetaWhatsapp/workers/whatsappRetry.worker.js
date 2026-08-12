import { Worker, Queue } from 'bullmq';
import IORedis from 'ioredis';
import MetaWhatsappLog from '../models/metaWhatsappLogSchema.js';
import MetaWhatsappNumber from '../models/metaWhatsappnumberSchema.js';
import MetaGraphClient from '../services/metaFbWhatsapp.client.js';

const connection = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
    maxRetriesPerRequest: null
});

export const whatsappRetryQueue = new Queue('whatsapp-retry', { connection });

export const whatsappRetryWorker = new Worker('whatsapp-retry', async (job) => {
    const { logId, phoneNumberId, payload, attempt } = job.data;
    console.log(`[RetryWorker] Processing retry attempt ${attempt} for log ${logId}`);

    const log = await MetaWhatsappLog.findById(logId);
    if (!log || log.retryStatus === 'SUCCESSFUL' || log.retryStatus === 'EXHAUSTED') {
        return { skipped: true, reason: 'Already resolved or exhausted' };
    }

    const numberInfo = await MetaWhatsappNumber.findOne({ phoneNumberId, isDeleted: false });
    if (!numberInfo) throw new Error('WhatsApp number not found or deleted');

    const config = numberInfo.retryConfig || {};
    if (!config.enabled) {
        log.retryStatus = 'EXHAUSTED';
        await log.save();
        return { skipped: true, reason: 'Retry disabled for this number' };
    }

    // Process quiet hours logic
    if (config.quietHoursStart && config.quietHoursEnd) {
        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
        
        let inQuietHours = false;
        if (config.quietHoursStart > config.quietHoursEnd) {
             // Spans midnight (e.g. 22:00 to 07:00)
            inQuietHours = currentTime >= config.quietHoursStart || currentTime <= config.quietHoursEnd;
        } else {
            // Same day (e.g. 01:00 to 05:00)
            inQuietHours = currentTime >= config.quietHoursStart && currentTime <= config.quietHoursEnd;
        }

        if (inQuietHours) {
            console.log(`[RetryWorker] Quiet hours active (${config.quietHoursStart}-${config.quietHoursEnd}). Delaying job...`);
            // Put it back in queue with a delay (try again in 1 hour)
            await whatsappRetryQueue.add('retry-message', job.data, { delay: 3600000 });
            return { skipped: true, reason: 'Quiet hours active, requeued' };
        }
    }

    try {
        log.retryStatus = 'RETRYING';
        await log.save();

        const response = await MetaGraphClient.sendMessage(
            phoneNumberId,
            numberInfo.systemAccessToken,
            payload
        );

        if (response && response.messages && response.messages[0]) {
            log.retryStatus = 'SUCCESSFUL';
            log.status = 'sent';
            log.metaMessageId = response.messages[0].id;
            
            log.retryHistory.push({
                attempt,
                scheduledAt: job.timestamp,
                executedAt: new Date(),
                result: 'SUCCESS'
            });
            await log.save();
            return { success: true, messageId: response.messages[0].id };
        }
    } catch (error) {
        console.error(`[RetryWorker] Attempt ${attempt} failed for log ${logId}:`, error.message);
        const metaError = error.response?.data?.error;
        const errCode = metaError?.code || 'UNKNOWN';
        const errMsg = metaError?.message || error.message;

        log.retryHistory.push({
            attempt,
            errorCode: String(errCode),
            errorMessage: String(errMsg),
            scheduledAt: job.timestamp,
            executedAt: new Date(),
            result: 'FAILED'
        });

        // 131050 = user blocked, 131047 = 24h window closed, 132015 = template paused
        // Do not retry for terminal errors
        if (errCode === 131050 || errCode === 131047 || errCode === 132015) {
            log.retryStatus = 'EXHAUSTED';
            log.lastErrorCode = String(errCode);
            log.lastErrorMessage = String(errMsg);
            await log.save();
            return { failed: true, reason: 'Terminal error, exhausted' };
        }

        if (attempt >= (config.maxRetries || 3)) {
            log.retryStatus = 'EXHAUSTED';
            log.lastErrorCode = String(errCode);
            log.lastErrorMessage = String(errMsg);
            await log.save();
            return { failed: true, reason: 'Max retries exhausted' };
        }

        log.retryStatus = 'SCHEDULED';
        await log.save();
        
        // Exponential backoff
        const backoffDelay = Math.pow(2, attempt) * 60000;
        await whatsappRetryQueue.add('retry-message', {
            logId,
            phoneNumberId,
            payload,
            attempt: attempt + 1
        }, { delay: backoffDelay });

        return { failed: true, reason: 'Requeued for next attempt' };
    }
}, { connection });

whatsappRetryWorker.on('failed', (job, err) => {
    console.error(`[RetryWorker] Job failed completely: ${job?.id}`, err);
});
