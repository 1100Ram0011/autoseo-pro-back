/**
 * scraperWorker.js — BullMQ worker for Google Maps scraping
 *
 * Every emitToUser() call now carries:
 *   percent  – 0-100 progress number
 *   label    – human-readable stage string
 *   error    – error message string (partial / failed only)
 *   count    – leads saved to Mongo so far (partial / failed only)
 *
 * This makes both the live socket path AND the polling fallback carry
 * the same rich payload so the frontend never has to guess.
 */

import { Worker } from 'bullmq'

import redisClient from '../../config/redis.js'

import Business from '../../models/ScrapperGoogle/BusinessGoogleScrapperSchema.js'

import { scrapeLocation } from '../../googleScraper/services/scraper.js'

import logger from '../../config/logger.js'

import { trackAndDeductFeatureCredit, checkBulkFeatureCapacity } from '../../utils/creditTracker.js'

import { setScraperProgress } from '../../utils/scraperProgress.js'

import crypto from 'crypto'

// ── Redis publisher (separate connection — never blocks the main client) ──────
const publisher = redisClient.duplicate()
 
publisher.on('error', (err) => {

  logger.error('[SCRAPER WORKER] Publisher redis error', { error: err.message })
})

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET + PROGRESS EMITTER
// Every emission is mirrored to Redis via setScraperProgress so the polling
// endpoint can serve full state on page refresh.
// ─────────────────────────────────────────────────────────────────────────────
async function emitToUser(userId, event, data = {}) {
  if (!userId) return
  try {
    const payload = JSON.stringify({ userId: userId.toString(), event, data })
    await publisher.publish('socket:user', payload)
    logger.debug('[SCRAPER WORKER] Socket emit', { userId, event, data })

    // Mirror to Redis for polling fallback — setScraperProgress handles the
    // full payload shape (percent, label, error, count)
    await setScraperProgress({ userId, event, data })
  } catch (err) {
    logger.error('[SCRAPER WORKER] emitToUser failed', {
      userId,
      event,
      error: err.message,
    })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REDIS RESULT BUFFER
// ─────────────────────────────────────────────────────────────────────────────
const BUFFER_TTL_SECONDS = 60 * 60 // 1 hour

function bufferKey(jobId) {

  return `scraper:buffer:${jobId}`

}

async function bufferBusiness(jobId, business) {
  try {
    const key = bufferKey(jobId)
    await redisClient.rpush(key, JSON.stringify(business))
    await redisClient.expire(key, BUFFER_TTL_SECONDS)
  } catch (err) {

    logger.warn('[SCRAPER WORKER] Redis buffer write failed', {

      jobId,
      businessName: business?.name,
      error: err.message,
    })
  }
}

async function getBufferCount(jobId) {
  try {
    return await redisClient.llen(bufferKey(jobId))
  } catch {
    return 0
  }
}

async function flushBufferToMongo(jobId, meta) {
  const { searchQuery, location, userId, profileId, sessionId, websiteHash, primarySegment } = meta
  const key = bufferKey(jobId)

  logger.info('[SCRAPER WORKER] [FLUSH] Starting MongoDB flush', { jobId, searchQuery, location, userId })

  let raw

  try {

    raw = await redisClient.lrange(key, 0, -1)

  } catch (err) {
    logger.error('[SCRAPER WORKER] [FLUSH] Redis lrange failed', { jobId, error: err.message })
    return 0

  }

  logger.info('[SCRAPER WORKER] [FLUSH] Buffer read complete', { jobId, bufferedCount: raw?.length ?? 0 })

  if (!raw || raw.length === 0) {
    logger.warn('[SCRAPER WORKER] [FLUSH] Buffer is empty — nothing to save', { jobId })
    return 0

  }

  const businesses = raw

    .map((item) => {
      try { return JSON.parse(item) }
      catch { return null }
    })

    .filter(Boolean)
  logger.info('[SCRAPER WORKER] [FLUSH] Business location debug', {
    jobId,
    searchLocation: location,
    businesses: businesses.map(b => ({
      name: b.name,
      bizLocation: b.location,      // what scraper gave us
      address: b.address,
      finalLocation: b.location || location || '',  // what will be saved
    }))
  })

  const bulkOps = businesses.map((biz) => ({

    updateOne: {

      filter: {
        name: biz.name,

        address: biz.address || 'unknown',
        ...(biz.location ? { location: biz.location } : {}),
      },

      update: {

        $set: {

          ...biz,
          location, // Always save the search location (e.g., "United States")
          search_query: searchQuery,
          ...(userId && { userId }),

          ...(profileId && { profileId }),

          ...(websiteHash && { websiteHash }),
          ...(primarySegment && { primarySegment }),
          ...(sessionId && { sessionId }),
          jobId,
          updatedAt: new Date(),

        },

        $setOnInsert: { createdAt: new Date() },

      },

      upsert: true,

    },

  }))
  logger.info('[SCRAPER WORKER] [FLUSH] Bulk operations constructed', { bulkOps })
  try {

    const result = await Business.bulkWrite(bulkOps, { ordered: false })
    logger.info('[SCRAPER WORKER] [FLUSH] ✅ MongoDB bulkWrite success', {
      jobId,

      upserted: result.upsertedCount,

      modified: result.modifiedCount,
      matched: result.matchedCount,
      total: businesses.length,
    })
    await redisClient.del(key)
    return businesses.length
  } catch (err) {
    if (err.writeErrors) {
      logger.warn('[SCRAPER WORKER] [FLUSH] BulkWrite partial errors', {
        jobId,
        writeErrors: err.writeErrors.length,
        total: businesses.length,
        saved: businesses.length - err.writeErrors.length,
      })
      await redisClient.del(key)
      return businesses.length - err.writeErrors.length
    }
    logger.error('[SCRAPER WORKER] [FLUSH] ❌ MongoDB bulkWrite failed', { jobId, error: err.message })
    await emitToUser(userId, "scraper:failed", {
      jobId,
      error: err.message,
    });
    throw err
  }

}
 
// ─────────────────────────────────────────────────────────────────────────────
// MAIN JOB PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────

async function processScraperJob(job) {
  const {

    searchQuery,

    location = '',

    maxResults = 25,
    concurrent = 3,
    userId = null,
    profileId = null,
    sessionId = null,
    websiteHash = null,
    primarySegment = null,
    // Cost-saving strict caps (can be overridden per job)
    maxGoodLeadsTotal = 5,
    maxGoodLeadsPerJob = 1,
    minRating = 4.0,
    jobIndex = 1,
    totalJobs = 1,
  } = job.data
 
  const jobId = job.id
  const startedAt = Date.now()

  // Redis key to coordinate a global cap across ALL jobs in the same run
  const goodCountKey = sessionId ? `scraper:goodcount:${sessionId}` : null

  const isGoodLead = (biz) => {
    const phoneOk = typeof biz?.phone === 'string' && biz.phone.trim().length > 0
    const ratingNum = parseFloat(biz?.rating)
    const ratingOk = !Number.isNaN(ratingNum) && ratingNum >= Number(minRating || 0)
    return phoneOk && ratingOk
  }

  logger.info('[SCRAPER WORKER] ═══════════════════════════════════════════════')
  logger.info('[SCRAPER WORKER] ▶ JOB STARTED', {
    jobId, jobIndex, totalJobs, searchQuery,
    location: location || 'N/A', maxResults, concurrent,
    userId: userId || 'N/A',
  })

  await job.updateProgress(5)

  try {
    /* ─────────────────────────────────────────────
       PRE-CHECK — FREE LIMITS / CREDITS
    ───────────────────────────────────────────── */
    const leadsCheck = await checkBulkFeatureCapacity({
      userId,
      featureKey: "leads",
      requiredCount: 1,
    });

    if (!leadsCheck.canAfford) {
      throw new Error(leadsCheck.message);
    }
    // ── STEP 1: Emit start to socket ────────────────────────────────────────
    logger.info(
      "[SCRAPER WORKER] [STEP 1] Emitting scraper:started to socket",
      { jobId, userId },
    );
    await emitToUser(userId, "scraper:started", {

      jobId,

      searchQuery,

      location,
      jobIndex,
      totalJobs,
      primarySegment,
    });

    // ── Global cap pre-check ────────────────────────────────────────────────
    if (goodCountKey) {
      const currentGood = parseInt((await redisClient.get(goodCountKey)) || '0', 10)
      if (currentGood >= maxGoodLeadsTotal) {
        logger.info('[SCRAPER WORKER] Global good-lead cap reached — skipping job', {
          jobId, sessionId, currentGood, maxGoodLeadsTotal, primarySegment,
        })
        await emitToUser(userId, 'scraper:completed', {
          jobId, searchQuery, location,
          count: 0,
          fromCache: false,
          percent: 100,
          label: 'Leads ready (cap reached)',
        })
        return { status: 'skipped_cap', count: 0 }
      }
    }

    // ── STEP 2: Cache check ──────────────────────────────────────────────────
    const CACHE_TTL_MS = 24 * 60 * 60 * 1000
    const cacheFilter = {
      search_query: searchQuery,
      createdAt: { $gte: new Date(Date.now() - CACHE_TTL_MS) },
    }
    if (location) cacheFilter.location = location
    if (userId) cacheFilter.userId = userId
    if (profileId) cacheFilter.profileId = profileId
    if (websiteHash) cacheFilter.websiteHash = websiteHash
    if (primarySegment) cacheFilter.primarySegment = primarySegment

    const cached = await Business.findOne(cacheFilter).lean()

    if (cached) {
      logger.info('[SCRAPER WORKER] [STEP 2] ✅ Cache HIT', { jobId })

      const relinkFilter = { search_query: searchQuery }
      if (location) relinkFilter.location = location
      if (userId) relinkFilter.userId = userId
      if (profileId) relinkFilter.profileId = profileId
      if (websiteHash) relinkFilter.websiteHash = websiteHash
      if (primarySegment) relinkFilter.primarySegment = primarySegment

      await Business.updateMany(relinkFilter, {
        $set: {
          ...(sessionId && { sessionId }),
          ...(profileId && { profileId }),
          ...(websiteHash && { websiteHash }),
          ...(primarySegment && { primarySegment }),
          updatedAt: new Date(),
        },
      })

      await job.updateProgress(100)
      await emitToUser(userId, 'scraper:completed', {
        jobId, searchQuery, location, count: 0, fromCache: true,
        percent: 100,
        label: 'Leads ready (cached)',
      })

      logger.info('[SCRAPER WORKER] ✅ JOB DONE (cache hit)', { jobId })
      return { status: 'cache_hit', count: 0 }
    }

    logger.info('[SCRAPER WORKER] [STEP 2] Cache MISS — will scrape', { jobId })
    await job.updateProgress(10)

    // ── STEP 3: Flush any leftover buffer from a previous crash ─────────────
    const existingBuffer = await getBufferCount(jobId)
    if (existingBuffer > 0) {
      logger.warn('[SCRAPER WORKER] [STEP 3] Leftover buffer found — flushing', { jobId, existingBuffer })
      await flushBufferToMongo(jobId, { searchQuery, location, userId, profileId, sessionId, websiteHash, primarySegment })
    }

    // ── STEP 4: Playwright scraper ───────────────────────────────────────────
    logger.info('[SCRAPER WORKER] [STEP 4] Launching Playwright scraper', {
      jobId, searchQuery, location: location || '(none)', maxResults, concurrent,
    })

    const abortController = new AbortController()
    let totalFound = 0
    let goodFoundThisJob = 0
    let lastProgressLog = Date.now()
    let scraperError = null   // thrown exception from scrapeLocation
    let outOfCreditsError = null  // graceful abort from credit exhaustion

    try {
      await scrapeLocation({
        searchQuery,

        locationName: location || searchQuery,
        maxConcurrent: concurrent,
        maxResults,
        signal: abortController.signal,

        onEvent: async (event) => {
          switch (event.event) {
            case 'scraper_status':
              logger.info('[SCRAPER WORKER] [PLAYWRIGHT] Status', { jobId, stage: event.stage, message: event.message })
              break

            case 'polygon_boundaries_found':
              logger.info('[SCRAPER WORKER] [PLAYWRIGHT] Location resolved', { jobId, location: event.location })
              await emitToUser(userId, 'scraper:location_resolved', {
                jobId,
                location: event.location,
                percent: 20,
                label: 'Location resolved',
              })
              break

            case 'business_found': {
              totalFound++

              // ✅ Use the already-imported crypto from top of file
              const businessWebsiteHash = event.business?.website
                ? crypto.createHash('sha256').update(event.business.website).digest('hex')
                : null

              // Only accept "good" leads to save money (phone + rating threshold)
              if (!isGoodLead(event.business)) {
                break
              }

              // Per-job cap (normally 1 per segment/job)
              if (goodFoundThisJob >= maxGoodLeadsPerJob) {
                abortController.abort()
                break
              }

              // Global cap across the whole session (max 5 total)
              if (goodCountKey) {
                const next = await redisClient.incr(goodCountKey)
                await redisClient.expire(goodCountKey, 60 * 30)
                if (next > maxGoodLeadsTotal) {
                  await redisClient.decr(goodCountKey)
                  abortController.abort()
                  break
                }
              }

              await bufferBusiness(jobId, {
                ...event.business,
                websiteHash: businessWebsiteHash,
                profileId,
                sessionId,
                primarySegment,
              })
              goodFoundThisJob++

              // Deduct credits ONLY for accepted good leads
              if (userId) {
                try {
                  await trackAndDeductFeatureCredit({
                    userId,
                    featureKey: 'leads',
                    usageCount: 1,
                    description: `Lead Extracted — ${event.business?.name}`,
                    idempotencyKey: `lead-${sessionId || jobId}-${primarySegment || 'segment'}-${event.business?.name?.replace(/ /g, '_')}-${goodFoundThisJob}`,
                    metadata: {
                      title: 'Lead Generation',
                      extra: { source: 'googleScraper', location, searchQuery, primarySegment },
                    },
                  })
                } catch (creditErr) {
                  logger.warn('[SCRAPER WORKER] Credit deduction failed', { jobId, userId, error: creditErr.message })
                  if (creditErr.insufficientCredits) {
                    outOfCreditsError = creditErr.message
                    abortController.abort()
                  }
                }
              }

              const pct = Math.min(10 + Math.round((totalFound / maxResults) * 80), 90)
              await emitToUser(userId, 'scraper:business_found', {
                business: event.business,
                totalSoFar: totalFound,
                percent: pct,
                label: 'Collecting leads',
                primarySegment,
              })

              job.updateProgress(pct).catch(() => { })

              const now = Date.now()
              if (totalFound % 5 === 0 || now - lastProgressLog > 30_000) {
                logger.info('[SCRAPER WORKER] [PLAYWRIGHT] Progress', {
                  jobId, totalFound, maxResults,
                  bufferedInRedis: await getBufferCount(jobId),
                })
                lastProgressLog = now
              }
              break
            }

            case 'zone_completed':
              logger.info('[SCRAPER WORKER] [PLAYWRIGHT] Zone completed', {
                jobId, zone: event.zone_name, zoneCount: event.results_count,
              })
              break

            case 'scraping_complete':
              logger.info('[SCRAPER WORKER] [PLAYWRIGHT] Scraping complete signal', {
                jobId, totalBusinesses: event.total_businesses,
              })
              break

            case 'error':
              logger.error('[SCRAPER WORKER] [PLAYWRIGHT] Scraper emitted error event', {
                jobId, message: event.message,
              })
              break

            default:
              logger.debug('[SCRAPER WORKER] [PLAYWRIGHT] Unknown event', { jobId, eventType: event.event })
          }
        },
      })

      logger.info('[SCRAPER WORKER] [STEP 4] ✅ scrapeLocation() returned', { jobId, totalFound })
    } catch (err) {
      scraperError = err
      logger.error('[SCRAPER WORKER] [STEP 4] ❌ scrapeLocation() threw', {
        jobId, error: err.message, totalFoundBeforeError: totalFound,
      })

      await emitToUser(userId, "scraper:failed", {
        jobId,
        searchQuery,
        location,
        jobIndex,
        totalJobs,
        error: err.message,
        count: totalFound,
      });
    }

    await job.updateProgress(90)

    // ── STEP 5: Flush Redis → MongoDB ────────────────────────────────────────
    await emitToUser(userId, 'scraper:saving', {
      jobId,
      percent: 95,
      label: 'Saving leads…',
    })

    let flushed = 0
    try {
      flushed = await flushBufferToMongo(jobId, { searchQuery, location, userId, profileId, sessionId, websiteHash, primarySegment })
    } catch (flushErr) {
      logger.error('[SCRAPER WORKER] [STEP 5] Flush failed', { jobId, error: flushErr.message })
      // flushed stays 0 — we still emit partial/failed below
    }

    await job.updateProgress(100)

    // ── STEP 6: Emit terminal event ──────────────────────────────────────────
    if (outOfCreditsError) {
      // ── PARTIAL: credits ran out mid-scrape ──────────────────────────────
      logger.warn('[SCRAPER WORKER] [STEP 6] Aborted — insufficient credits', {
        jobId, savedCount: flushed, error: outOfCreditsError,
      })

      await emitToUser(userId, 'scraper:partial', {
        jobId, searchQuery, location,
        count: flushed,
        // Human-readable error string that the frontend banner will display
        error: `Leads stopped because you ran out of credits. ${flushed} lead${flushed !== 1 ? 's were' : ' was'} saved.`,
        percent: 100,
        label: 'Stopped — out of credits',
      })

      return { status: 'out_of_credits', count: flushed }

    } else if (scraperError) {
      // ── PARTIAL: scraper crashed but we saved whatever was buffered ───────
      const isAborted = scraperError.name === 'AbortError' || scraperError.message?.includes('aborted')

      logger.warn('[SCRAPER WORKER] [STEP 6] Scraper error — partial data saved', {
        jobId, savedCount: flushed, error: scraperError.message,
      })

      await emitToUser(userId, 'scraper:partial', {
        jobId, searchQuery, location,
        count: flushed,
        error: isAborted
          ? `Leads was interrupted. ${flushed} lead${flushed !== 1 ? 's were' : ' was'} saved.`
          : `Leads stopped unexpectedly: ${scraperError.message}. ${flushed} lead${flushed !== 1 ? 's were' : ' was'} saved.`,
        percent: 100,
        label: 'Partially completed',
      })

      // Re-throw so BullMQ can retry if attempts remain
      throw scraperError

    } else {
      // ── COMPLETED: all good ───────────────────────────────────────────────
      logger.info('[SCRAPER WORKER] [STEP 6] Emitting scraper:completed', { jobId, flushed, userId })

      await emitToUser(userId, 'scraper:completed', {
        jobId, searchQuery, location,
        count: flushed,
        fromCache: false,
        percent: 100,
        label: 'Leads ready',
      })
    }

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2)
    logger.info('[SCRAPER WORKER] ✅ JOB COMPLETE', {
      jobId, searchQuery, location: location || 'N/A', savedDocs: flushed, elapsed: `${elapsed}s`,
    })
    logger.info('[SCRAPER WORKER] ═══════════════════════════════════════════════')

    return { status: 'done', count: flushed }

  } catch (error) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2)
    const attemptsLeft = (job.opts?.attempts ?? 2) - (job.attemptsMade + 1)

    logger.error('[SCRAPER WORKER] ❌ JOB FAILED', {
      jobId, searchQuery, location: location || 'N/A',
      userId: userId || 'N/A', error: error.message, elapsed: `${elapsed}s`, attemptsLeft,
    })
 
    await emitToUser(userId, "scraper:failed", {

      jobId,
      searchQuery,
      location,
      jobIndex,
      totalJobs,
      error: error.message,
    });

    // ── Flush any remaining buffer ───────────────────────────────────────────
    let emergencyFlushed = 0
    try {
      const leftover = await getBufferCount(jobId)
      if (leftover > 0) {
        logger.info('[SCRAPER WORKER] Emergency flush on failure', { jobId, leftover })
        emergencyFlushed = await flushBufferToMongo(jobId, { searchQuery, location, userId, profileId, sessionId, websiteHash, primarySegment })
      }
    } catch (flushErr) {
      logger.error('[SCRAPER WORKER] Emergency flush also failed', { jobId, error: flushErr.message })
    }

    // Only emit scraper:failed if this is the LAST attempt (no more retries)
    // so the user doesn't see "Failed" while BullMQ is about to retry.
    if (attemptsLeft <= 0) {
      await emitToUser(userId, 'scraper:failed', {
        jobId, searchQuery, location,
        count: emergencyFlushed > 0 ? emergencyFlushed : null,
        // Clear, actionable error message for the frontend banner
        error: buildUserFacingError(error),
        percent: 0,
        label: 'Leads failed',
      })
    } else {
      // Retry is coming — emit a softer "retrying" progress update
      await emitToUser(userId, 'scraper:started', {
        jobId, searchQuery, location,
        percent: 5,
        label: `Retrying… (attempt ${job.attemptsMade + 2})`,
      })
    }

    logger.info('[SCRAPER WORKER] ═══════════════════════════════════════════════')
    throw error // Let BullMQ handle retry
  }
}

/**
 * buildUserFacingError
 * Converts raw Node/Playwright exceptions into clean, user-readable strings.
 * Never exposes internal stack traces or file paths.
 */
function buildUserFacingError(err) {
  const msg = err?.message || ''

  if (!msg) return 'An unexpected error occurred. Please try again.'

  // Playwright / browser crashes
  if (msg.includes('Target closed') || msg.includes('Browser has been closed'))
    return 'The scraper browser closed unexpectedly. Please try again.'

  if (msg.includes('net::ERR_') || msg.includes('ERR_CONNECTION'))
    return 'A network error occurred while Leads Google Maps. Please try again.'

  if (msg.includes('TimeoutError') || msg.includes('timeout'))
    return 'The scraper timed out waiting for Google Maps to respond. Please try again.'

  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND'))
    return 'Could not connect to Google Maps. Please check your server network and try again.'

  if (msg.includes('out of memory') || msg.includes('OOM'))
    return 'The scraper ran out of memory. Try requesting fewer leads at once.'

  if (msg.includes('429') || msg.includes('rate limit') || msg.includes('Too Many Requests'))
    return 'Google Maps rate-limited the scraper. Please wait a few minutes and try again.'

  if (msg.includes('captcha') || msg.includes('CAPTCHA') || msg.includes('unusual traffic'))
    return 'Google Maps returned a CAPTCHA. Please wait a few minutes and try again.'

  // Generic fallback — safe to show
  return `Leads failed: ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''}`
}
 
// ─────────────────────────────────────────────────────────────────────────────
// WORKER INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

const worker = new Worker('google-scraper-queue', processScraperJob, {

  connection: redisClient,
  skipVersionCheck: true,
  concurrency: 1,
  limiter: {

    max: 1,
    duration: 8_000,
  },
  stalledInterval: 30_000,
  lockDuration: 10 * 60 * 1000,
})

// ─────────────────────────────────────────────────────────────────────────────
// WORKER EVENTS
// ─────────────────────────────────────────────────────────────────────────────
worker.on('active', (job) => {
  logger.info('[SCRAPER WORKER] 🔄 Worker picked up job', {
    jobId: job.id, searchQuery: job.data.searchQuery,
    location: job.data.location || 'N/A', attempt: job.attemptsMade + 1,
  })
})

worker.on('completed', (job, result) => {
  logger.info('[SCRAPER WORKER] ✅ Worker completed job', { jobId: job.id, result })
})

worker.on('failed', async (job, err) => {
  logger.error('[SCRAPER WORKER] ❌ Worker job failed permanently', {
    jobId: job?.id,
    searchQuery: job?.data?.searchQuery,
    location: job?.data?.location,
    attemptsLeft: (job?.opts?.attempts ?? 2) - (job?.attemptsMade ?? 0),
    error: err.message,
  })

  await emitToUser(job.data?.userId, "scraper:failed", {
    jobId: job?.id,
    searchQuery: job?.data?.searchQuery,
    location: job?.data?.location,
    attemptsLeft: (job?.opts?.attempts ?? 2) - (job?.attemptsMade ?? 0),
    error: err.message,
  });

})

worker.on('error', (err) => logger.error('[SCRAPER WORKER] Worker-level error', { error: err.message }))
worker.on('stalled', (jobId) => logger.warn('[SCRAPER WORKER] ⚠ Job stalled', { jobId }))
worker.on('progress', (job, progress) => logger.debug('[SCRAPER WORKER] Progress', { jobId: job.id, progress }))

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`[SCRAPER WORKER] ${signal} received — shutting down gracefully`)
  await worker.close()
  await publisher.quit()
  logger.info('[SCRAPER WORKER] Worker closed cleanly')
  process.exit(0)
}

// process.on('SIGTERM', () => shutdown('SIGTERM'))
// process.on('SIGINT', () => shutdown('SIGINT'))

process.on('uncaughtException', (err) => {
  logger.error('[SCRAPER WORKER] Uncaught exception', { error: err.message, stack: err.stack })
})

process.on('unhandledRejection', (reason) => {
  logger.error('[SCRAPER WORKER] Unhandled rejection', { reason: reason?.message || String(reason) })
})
 
logger.info('[SCRAPER WORKER] 🚀 Worker started', {
  queue: 'google-scraper-queue', concurrency: 1, limiter: '1 job / 8s', lockDuration: '10 min',
})
 
export default worker
 