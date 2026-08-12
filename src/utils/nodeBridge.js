/**
 * nodeBridge.js — Node.js scraper bridge (socket-initiated scrapes)
 *
 * Used by scraperSocket.js for real-time socket scraping.
 * Controller-initiated scrapes go through BullMQ (scraperWorker.js).
 *
 * PUBLIC API (unchanged — scraperSocket.js needs zero changes):
 *   bridge.execute({ searchQuery, location, concurrent, maxResults, processId, onEvent, userId, profileId })
 *   bridge.killProcess(processId)
 *   bridge.killAll()
 *   bridge.getActiveProcesses()
 */

import Business from "../models/ScrapperGoogle/BusinessGoogleScrapperSchema.js";
import { scrapeLocation } from "../googleScraper/services/scraper.js";
import redisClient from "../config/redis.js";
import logger from "../config/logger.js";

const BUFFER_TTL_SECONDS = 60 * 60; // 1 hour

class NodeBridge {
  constructor() {
    this._activeJobs = new Map();
    logger.info("[NODE BRIDGE] Initialized");
  }

  // ─── Buffer helpers ──────────────────────────────────────────────────────
  _bufferKey(processId) {
    if (!processId) throw new Error("[NODE BRIDGE] _bufferKey — processId is required");
    return `scraper:socket:buffer:${processId}`;
  }

  async _bufferBusiness(processId, business) {
    if (!processId) {
      logger.error("[NODE BRIDGE] _bufferBusiness — processId is required");
      return;
    }

    if (!business || typeof business !== "object") {
      logger.warn("[NODE BRIDGE] _bufferBusiness — invalid business object, skipping", {
        processId,
        business,
      });
      return;
    }

    if (!business.name) {
      logger.warn("[NODE BRIDGE] _bufferBusiness — business has no name, skipping", {
        processId,
        business,
      });
      return;
    }

    try {
      const key = this._bufferKey(processId);
      const serialized = JSON.stringify(business);
      await redisClient.rpush(key, serialized);
      await redisClient.expire(key, BUFFER_TTL_SECONDS);
    } catch (err) {
      logger.warn("[NODE BRIDGE] Redis buffer write failed", {
        processId,
        businessName: business?.name,
        error: err.message,
        stack: err.stack,
      });
      // Non-fatal — business will still be counted; flush will handle persistence
    }
  }

  async _getBufferCount(processId) {
    if (!processId) {
      logger.warn("[NODE BRIDGE] _getBufferCount — processId is required, returning 0");
      return 0;
    }

    try {
      const count = await redisClient.llen(this._bufferKey(processId));
      return typeof count === "number" ? count : 0;
    } catch (err) {
      logger.warn("[NODE BRIDGE] _getBufferCount — Redis llen failed", {
        processId,
        error: err.message,
      });
      return 0;
    }
  }

  async _flushBuffer(processId, { location, searchQuery, userId, profileId }) {
    if (!processId) {
      logger.error("[NODE BRIDGE] [FLUSH] processId is required — aborting flush");
      return 0;
    }

    if (!searchQuery) {
      logger.warn("[NODE BRIDGE] [FLUSH] searchQuery is missing — flush will proceed without it", { processId });
    }

    const key = this._bufferKey(processId);
    logger.info("[NODE BRIDGE] [FLUSH] Starting", { processId, searchQuery, location });

    let raw;
    try {
      raw = await redisClient.lrange(key, 0, -1);
    } catch (err) {
      logger.error("[NODE BRIDGE] [FLUSH] Redis lrange failed — cannot flush", {
        processId,
        error: err.message,
        stack: err.stack,
      });
      return 0;
    }

    logger.info("[NODE BRIDGE] [FLUSH] Buffer read", {
      processId,
      bufferedCount: raw?.length ?? 0,
    });

    if (!raw || raw.length === 0) {
      logger.warn("[NODE BRIDGE] [FLUSH] Buffer empty — nothing to flush", { processId });
      return 0;
    }

    let parseErrors = 0;
    const businesses = raw
      .map((item) => {
        try {
          return JSON.parse(item);
        } catch (parseErr) {
          parseErrors++;
          logger.warn("[NODE BRIDGE] [FLUSH] Failed to parse buffered item", {
            processId,
            item: item?.slice(0, 100),
            error: parseErr.message,
          });
          return null;
        }
      })
      .filter(Boolean);

    if (parseErrors > 0) {
      logger.warn("[NODE BRIDGE] [FLUSH] Some items failed to parse", {
        processId,
        parseErrors,
        parsedCount: businesses.length,
      });
    }

    if (businesses.length === 0) {
      logger.warn("[NODE BRIDGE] [FLUSH] No valid businesses after parsing — clearing key", { processId });
      try {
        await redisClient.del(key);
      } catch (delErr) {
        logger.warn("[NODE BRIDGE] [FLUSH] Failed to delete empty Redis key", {
          processId,
          error: delErr.message,
        });
      }
      return 0;
    }

    const bulkOps = businesses.map((biz) => ({
      updateOne: {
        filter: {
          name: biz.name,
          address: biz.address || "unknown",
          ...(location ? { location } : {}),
        },
        update: {
          $set: {
            ...biz,
            location: location || "",
            search_query: searchQuery || "",
            ...(userId && { userId }),
            ...(profileId && { profileId }),
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        upsert: true,
      },
    }));

    try {
      const result = await Business.bulkWrite(bulkOps, { ordered: false });

      logger.info("[NODE BRIDGE] [FLUSH] ✅ MongoDB flush success", {
        processId,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
        total: businesses.length,
      });

      try {
        await redisClient.del(key);
      } catch (delErr) {
        logger.warn("[NODE BRIDGE] [FLUSH] Redis key cleanup failed after flush", {
          processId,
          error: delErr.message,
        });
      }

      return businesses.length;

    } catch (err) {
      // Partial write errors — some docs may have succeeded
      if (err.writeErrors && Array.isArray(err.writeErrors)) {
        const saved = businesses.length - err.writeErrors.length;
        logger.warn("[NODE BRIDGE] [FLUSH] Partial bulkWrite errors", {
          processId,
          writeErrors: err.writeErrors.length,
          saved,
          total: businesses.length,
          firstError: err.writeErrors[0]?.errmsg,
        });
        try {
          await redisClient.del(key);
        } catch (delErr) {
          logger.warn("[NODE BRIDGE] [FLUSH] Redis key cleanup failed after partial flush", {
            processId,
            error: delErr.message,
          });
        }
        return saved;
      }

      logger.error("[NODE BRIDGE] [FLUSH] ❌ MongoDB flush failed", {
        processId,
        error: err.message,
        stack: err.stack,
        total: businesses.length,
      });
      return 0;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // execute()
  // ─────────────────────────────────────────────────────────────────────────
  async execute({
    searchQuery,
    location,
    concurrent = 3,
    maxResults = 25,
    onEvent,
    processId,
    userId = null,
    profileId = null,
  }) {
    // ── Input validation ───────────────────────────────────────────────────
    if (!searchQuery || typeof searchQuery !== "string" || !searchQuery.trim()) {
      const msg = "[NODE BRIDGE] execute — searchQuery is required and must be a non-empty string";
      logger.error(msg, { searchQuery });
      throw new Error("searchQuery is required");
    }

    if (typeof onEvent !== "function" && onEvent !== undefined && onEvent !== null) {
      logger.warn("[NODE BRIDGE] execute — onEvent is not a function, events will be discarded", {
        processId,
        onEventType: typeof onEvent,
      });
    }

    if (!processId) processId = `socket-${Date.now()}`;

    const controller = new AbortController();
    const startedAt = Date.now();

    this._activeJobs.set(processId, {
      controller,
      searchQuery,
      location,
      startedAt: new Date(),
    });

    logger.info("[NODE BRIDGE] ▶ Job registered", {
      processId,
      searchQuery,
      location: location || "N/A",
      maxResults,
      concurrent,
      userId: userId || "N/A",
      profileId: profileId || "N/A",
      activeJobs: this._activeJobs.size,
    });

    let totalFound = 0;
    let scraperError = null;

    // Wrap onEvent: log + buffer + forward to socket
    const wrappedOnEvent = async (event) => {
      if (!event || typeof event !== "object") {
        logger.warn("[NODE BRIDGE] [EVENT] Received invalid event", { processId, event });
        return;
      }

      try {
        switch (event.event) {

          case "scraper_status":
            logger.info("[NODE BRIDGE] [EVENT] Scraper status", {
              processId,
              stage: event.stage,
              message: event.message,
            });
            break;

          case "polygon_boundaries_found":
            logger.info("[NODE BRIDGE] [EVENT] Location resolved", {
              processId,
              location: event.location,
              centerLat: event.center_lat,
              centerLng: event.center_lng,
              areKm2: event.area_km2,
            });
            break;

          case "business_found": {
            if (!event.business || typeof event.business !== "object") {
              logger.warn("[NODE BRIDGE] [EVENT] business_found has no business payload", {
                processId,
                event,
              });
              break;
            }
            totalFound++;
            logger.info("[NODE BRIDGE] [EVENT] Business found", {
              processId,
              index: totalFound,
              name: event.business?.name,
              address: event.business?.address,
              phone: event.business?.phone,
              website: event.business?.website,
            });
            // Buffer to Redis — errors are caught internally
            await this._bufferBusiness(processId, event.business);
            break;
          }

          case "zone_completed":
            logger.info("[NODE BRIDGE] [EVENT] Zone completed", {
              processId,
              zone: event.zone_name,
              zoneCount: event.results_count,
              cumulative: event.cumulative_results,
            });
            break;

          case "scraping_complete":
            logger.info("[NODE BRIDGE] [EVENT] Scraping complete signal", {
              processId,
              total: event.total_businesses,
              timeSeconds: event.total_time_seconds,
            });
            break;

          case "error":
            logger.error("[NODE BRIDGE] [EVENT] Scraper error event", {
              processId,
              message: event.message,
            });
            break;

          default:
            logger.debug("[NODE BRIDGE] [EVENT] Unknown event type", {
              processId,
              eventType: event.event,
            });
        }
      } catch (eventHandlerErr) {
        logger.error("[NODE BRIDGE] [EVENT] Event handler threw an error", {
          processId,
          eventType: event?.event,
          error: eventHandlerErr.message,
          stack: eventHandlerErr.stack,
        });
        // Never crash the scraper because of an event handling error
      }

      // Always forward to socket handler — wrapped in try/catch
      try {
        if (typeof onEvent === "function") onEvent(event);
      } catch (onEventErr) {
        logger.error("[NODE BRIDGE] [EVENT] onEvent callback threw", {
          processId,
          eventType: event?.event,
          error: onEventErr.message,
        });
      }
    };

    try {
      logger.info("[NODE BRIDGE] Launching scrapeLocation()", {
        processId,
        searchQuery,
        location,
        maxResults,
        concurrent,
      });

      const results = await scrapeLocation({
        searchQuery,
        locationName: location || searchQuery,
        maxConcurrent: concurrent,
        maxResults,
        onEvent: wrappedOnEvent,
        signal: controller.signal,
      });

      logger.info("[NODE BRIDGE] scrapeLocation() returned", {
        processId,
        returned: Array.isArray(results) ? results.length : "N/A",
        totalFound,
      });

    } catch (err) {
      scraperError = err;
      if (controller.signal.aborted) {
        logger.info("[NODE BRIDGE] Job was cancelled by user", { processId });
      } else {
        logger.error("[NODE BRIDGE] scrapeLocation() threw", {
          processId,
          error: err.message,
          stack: err.stack,
          totalFoundSoFar: totalFound,
        });
      }
    }

    // Flush whatever was buffered — always, even on error/cancel
    const bufferedCount = await this._getBufferCount(processId);
    logger.info("[NODE BRIDGE] Flushing buffer after scrape", { processId, bufferedCount });

    const flushed = await this._flushBuffer(processId, {
      location,
      searchQuery,
      userId,
      profileId,
    });

    this._activeJobs.delete(processId);

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);

    if (controller.signal.aborted) {
      logger.info("[NODE BRIDGE] ✅ Job cancelled — partial results saved", {
        processId,
        flushed,
        totalFound,
        elapsed: `${elapsed}s`,
      });
      return [];
    }

    if (scraperError) {
      logger.error("[NODE BRIDGE] ❌ Job failed — partial results saved", {
        processId,
        flushed,
        totalFound,
        elapsed: `${elapsed}s`,
        error: scraperError.message,
      });
      throw scraperError;
    }

    logger.info("[NODE BRIDGE] ✅ Job complete", {
      processId,
      flushed,
      totalFound,
      elapsed: `${elapsed}s`,
      activeJobs: this._activeJobs.size,
    });

    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // killProcess()
  // ─────────────────────────────────────────────────────────────────────────
  killProcess(processId) {
    if (!processId || typeof processId !== "string") {
      logger.error("[NODE BRIDGE] killProcess — invalid processId", { processId });
      return false;
    }

    const job = this._activeJobs.get(processId);
    if (!job) {
      logger.warn("[NODE BRIDGE] killProcess — process not found", { processId });
      return false;
    }

    try {
      job.controller.abort();
      this._activeJobs.delete(processId);
      logger.info("[NODE BRIDGE] killProcess — cancelled", {
        processId,
        searchQuery: job.searchQuery,
        location: job.location,
      });
      return true;
    } catch (err) {
      logger.error("[NODE BRIDGE] killProcess — abort threw an error", {
        processId,
        error: err.message,
        stack: err.stack,
      });
      // Attempt cleanup regardless
      this._activeJobs.delete(processId);
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // killAll()
  // ─────────────────────────────────────────────────────────────────────────
  killAll() {
    const ids = [...this._activeJobs.keys()];

    if (ids.length === 0) {
      logger.info("[NODE BRIDGE] killAll — no active jobs to kill");
      return 0;
    }

    logger.info("[NODE BRIDGE] killAll called", { count: ids.length, ids });

    let killed = 0;
    let failed = 0;

    for (const id of ids) {
      if (this.killProcess(id)) {
        killed++;
      } else {
        failed++;
        logger.warn("[NODE BRIDGE] killAll — failed to kill process", { processId: id });
      }
    }

    logger.info("[NODE BRIDGE] killAll done", { killed, failed, total: ids.length });
    return killed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // getActiveProcesses()
  // ─────────────────────────────────────────────────────────────────────────
  getActiveProcesses() {
    try {
      const processes = [...this._activeJobs.entries()].map(([id, info]) => ({
        processId: id,
        searchQuery: info.searchQuery,
        location: info.location,
        startedAt: info.startedAt,
      }));
      logger.debug("[NODE BRIDGE] getActiveProcesses", { count: processes.length });
      return processes;
    } catch (err) {
      logger.error("[NODE BRIDGE] getActiveProcesses — error reading active jobs", {
        error: err.message,
        stack: err.stack,
      });
      return [];
    }
  }
}

export default new NodeBridge();