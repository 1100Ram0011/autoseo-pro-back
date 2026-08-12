/**
 * enqueueScraperJob.js — thin wrapper around scraperQueue
 *
 * Import this wherever you need to add scraper jobs.
 * scraperQueue is defined in your existing queue.js file.
 */

import { v4 as uuidv4 } from "uuid";
import logger from "../../config/logger.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import { cleanLocationsWithAI } from "../../utils/cleanLocationsWithAI.js";
import { cleanSearchQueriesWithAI } from "../../utils/cleanSearchQueriesWithAI.js";
import { scraperQueue } from "../index.js";

/**
 * Enqueue a single scraper job.
 * Idempotent: same query+location+userId won't queue twice.
 */
export async function enqueueScraperJob(payload, opts = {}) {
  // Stable job ID = dedup (BullMQ skips adding if jobId already exists in queue)
  const jobId =
    `${payload.userId || "anon"}_${payload.searchQuery}_${payload.location || "global"}`
      .replace(/\s+/g, "_")
      .slice(0, 200);

  const job = await scraperQueue.add("scrape", payload, {
    jobId,
    ...opts,
  });

  logger.info(`[SCRAPER QUEUE] Enqueued job "${jobId}" (bullId=${job.id})`);
  return job;
}

// ─── Shared helpers ────────────────────────────────────────────────────────────

const VAGUE_LOCATION_PATTERNS = [
  /^india$/i,
  /^global$/i,
  /^worldwide$/i,
  /^international$/i,
  /^pan.?india$/i,
  /^all over/i,
  /^entire\b/i,
  /^nation.?wide$/i,
  /^online$/i,
  /^remote$/i,
  /^anywhere$/i,
  /^everywhere$/i,
  /^asia$/i,
  /^south asia$/i,
  /^apac$/i,
  /^international markets?/i,
  /^global markets?/i,
  /^domestic$/i,
  /^pan.?asia$/i,
  /markets?$/i,
  /\bhq\b/i,
  /headquarters/i,
  /^maharashtra$/i,
  /^gujarat$/i,
  /^karnataka$/i,
  /^rajasthan$/i,
  /^tamil nadu$/i,
  /^kerala$/i,
  /^telangana$/i,
  /^andhra pradesh$/i,
  /^punjab$/i,
  /^haryana$/i,
  /^uttar pradesh$/i,
  /^west bengal$/i,
  /^goa$/i,
];

function isValidLocation(loc) {
  if (!loc || typeof loc !== "string") return false;
  const trimmed = loc.trim();
  if (trimmed.length < 3) return false;
  return !VAGUE_LOCATION_PATTERNS.some((p) => p.test(trimmed));
}

function deduplicateQueries(queries) {
  const seen = new Set();
  return queries.filter((q) => {
    const key = q.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toMapsQuery(raw) {
  if (!raw) return [];
  const text = raw.toLowerCase().trim();
  const expansions = {
    "digital marketing": [
      "digital marketing agency",
      "seo agency",
      "social media marketing agency",
    ],
    "real estate": [
      "real estate agency",
      "property dealer",
      "real estate consultant",
    ],
    "software development": [
      "software development company",
      "web development company",
      "it consulting company",
    ],
    accounting: ["chartered accountant", "accounting firm", "tax consultant"],
  };
  return expansions[text] || [`${text} company`, `${text} services`];
}

async function deriveScraperInputs(
  analysis,
  { maxQueries = 1, maxLocations = 1 } = {},
) {
  const targetMarket = analysis?.target_market || {};
  const bizOverview = analysis?.business_overview || {};
  const competitors = analysis?.competitor_analysis?.direct_competitors || [];

  // ── Locations ──────────────────────────────────────────────────────────────
  const rawLocations = (bizOverview.geographic_focus || [])
    .map((g) => String(g).trim())
    .filter(Boolean);
  let locations = [];

  if (rawLocations.length) {
    try {
      const aiLocations = await cleanLocationsWithAI(rawLocations);
      locations = aiLocations
        .map((l) => l.formatted)
        .filter(isValidLocation)
        .slice(0, maxLocations);
    } catch {
      locations = rawLocations.filter(isValidLocation).slice(0, maxLocations);
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────
  // const allRawQueries = [
  //     // ...(targetMarket.ideal_client_profiles || []),
  //     ...(targetMarket.primary_customer_segments[0] || []),
  //     // ...(bizOverview.industries || []),
  //     // ...competitors.map((c) => c.market_overlap || ""),
  // ].filter(Boolean);

  const allRawQueries = targetMarket.primary_customer_segments || [];

  let queries = allRawQueries;

  // let queries = [];
  // if (allRawQueries.length) {
  //     try {
  //         // const cleaned = await cleanSearchQueriesWithAI(allRawQueries);
  //         const cleaned = allRawQueries;
  //         queries = deduplicateQueries(cleaned.flatMap(toMapsQuery).filter(Boolean)).slice(0, maxQueries);
  //     } catch {
  //         queries = deduplicateQueries(allRawQueries.flatMap(toMapsQuery).filter(Boolean)).slice(0, maxQueries);
  //     }
  // }

  // if (!queries.length) throw new Error("Could not derive any searchable queries from profile.");

  // ── Build jobs ─────────────────────────────────────────────────────────────
  const jobs = [];
  if (!locations.length) {
    queries.forEach((q) => jobs.push({ searchQuery: q, location: null }));
  } else {
    locations.forEach((loc) =>
      queries.forEach((q) => jobs.push({ searchQuery: q, location: loc })),
    );
  }

  return jobs;
}

// ─────────────────────────────────────────────────────────────────────────────
// triggerScraperForProfile — called from your firecrawl worker after analysis
// ─────────────────────────────────────────────────────────────────────────────

export async function triggerScraperForProfile({
  userId,
  profileId,
  maxResults = 5,
  maxQueries = 1,
  maxLocations = 1,
}) {
  if (!userId || !profileId) {
    throw new Error("triggerScraperForProfile requires userId and profileId");
  }

  const sessionId = uuidv4();

  logger.info(
    `[AUTO-SCRAPER] Triggering | userId=${userId} profileId=${profileId} session=${sessionId}`,
  );

  const profile = await BusinessSummaryProfile.findOne({
    _id: profileId,
    status: "COMPLETED",
    isActive: true,
  }).lean();
  if (!profile?.analysis) {
    logger.warn(`[AUTO-SCRAPER] No analysis found for profileId=${profileId}`);
    return null;
  }

  let jobs;
  try {
    jobs = await deriveScraperInputs(profile.analysis, {
      maxQueries,
      maxLocations,
    });
  } catch (err) {
    logger.warn(`[AUTO-SCRAPER] Could not derive jobs: ${err.message}`);
    return null;
  }

  if (!jobs.length) {
    logger.warn(`[AUTO-SCRAPER] No jobs generated for profileId=${profileId}`);
    return null;
  }

  // Enqueue all jobs — returns immediately, worker processes one at a time
  const enqueuedJobs = await Promise.all(
    jobs.map((job, i) =>
      enqueueScraperJob({
        searchQuery: job.searchQuery,
        location: job.location || "",
        maxResults,
        concurrent: 3,
        userId,
        profileId,
        sessionId,
        jobIndex: i + 1,
        totalJobs: jobs.length,
      }),
    ),
  );

  logger.info(
    `[AUTO-SCRAPER] Enqueued ${enqueuedJobs.length} jobs | session=${sessionId}`,
  );

  return { sessionId, status: "queued", jobCount: enqueuedJobs.length };
}
