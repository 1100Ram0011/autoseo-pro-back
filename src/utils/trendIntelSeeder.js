/**
 * trendIntel.seeder.js
 *
 * Converts the raw weekly trend JSON (as provided by the data team) into
 * TrendIntel documents.  Safe to re-run: it upserts by (industry + week) and
 * rotates the is_latest flag atomically.
 *
 * Usage:
 *   import { seedTrendData } from "./trendIntel.seeder.js";
 *   await seedTrendData(rawJson, "2025-W22");
 */

import mongoose from "mongoose";
import TrendIntel from "../models/TrendIntel.model.js";

/**
 * Derives the ISO week string for "this week" if no explicit week is passed.
 * Format: "YYYY-WNN"
 */
function currentISOWeek() {
  const now = new Date();
  const jan4 = new Date(now.getFullYear(), 0, 4);
  const dayOfYear =
    Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const weekNum = Math.ceil(
    (dayOfYear + jan4.getDay()) / 7,
  );
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * Normalises a single raw industry entry from the JSON blob into the shape
 * expected by TrendIntelSchema.
 */
function normaliseEntry(raw, week) {
  // Collect all trending_hashtags from individual posts into one aggregated list
  const hashtagMap = new Map();
  for (const post of raw.top_posts || []) {
    for (const ht of post.trending_hashtags || []) {
      const tag = ht.value?.trim();
      if (!tag) continue;
      if (!hashtagMap.has(tag)) {
        hashtagMap.set(tag, { value: tag, total_engagement: 0, post_count: 0 });
      }
      const entry = hashtagMap.get(tag);
      entry.post_count += 1;
      entry.total_engagement +=
        (post.engagement_metrics?.likes || 0) +
        (post.engagement_metrics?.comments || 0);
    }
  }

  const normalisedPosts = (raw.top_posts || []).map((p) => ({
    post_url: p.post_url || "",
    type: p.type || "Video",
    caption: p.caption || "",
    engagement_metrics: {
      likes: p.engagement_metrics?.likes || 0,
      comments: p.engagement_metrics?.comments || 0,
      views: p.engagement_metrics?.views || 0,
      score: p.engagement_metrics?.score || 0,
    },
    visual_patterns: {
      hook_techniques: p.visual_patterns?.hook_techniques || "",
      pacing: p.visual_patterns?.pacing || "",
      shot_composition: p.visual_patterns?.shot_composition || "",
      text_placement: p.visual_patterns?.text_placement || "",
      color_grading: p.visual_patterns?.color_grading || "",
      camera_movement: p.visual_patterns?.camera_movement || "",
    },
    trending_hashtags: (p.trending_hashtags || []).map((ht) => ({
      value: ht.value || "",
    })),
    hook_type: p.hook_type || "",
    pacing: ["fast", "medium", "slow"].includes(p.pacing) ? p.pacing : "",
  }));

  const insights = raw.industry_insights || {};
  return {
    industry: raw.industry,
    week,
    industry_citation: raw.industry_citation || "",
    top_posts: normalisedPosts,
    trending_hashtags: Array.from(hashtagMap.values()),
    industry_insights: {
      average_engagement: {
        likes: insights.average_engagement?.likes || 0,
        comments: insights.average_engagement?.comments || 0,
        views: insights.average_engagement?.views || 0,
      },
      dominant_visual_styles: insights.dominant_visual_styles || "",
      key_trends: (insights.key_trends || []).map((kt) => ({
        value: typeof kt === "string" ? kt : kt.value || "",
      })),
      trending_hooks: insights.trending_hooks || [],
      optimal_pacing: ["fast", "medium", "slow"].includes(
        insights.optimal_pacing,
      )
        ? insights.optimal_pacing
        : "",
    },
  };
}

/**
 * Main seeder function.
 *
 * @param {Object} rawJson   - The full trend JSON blob (with a top-level
 *                             "trend_data" array).
 * @param {string} [week]    - ISO week string e.g. "2025-W22". Defaults to
 *                             the current week.
 * @returns {Promise<{ upserted: string[], errors: string[] }>}
 */
export async function seedTrendData(rawJson, week = currentISOWeek()) {
  const session = await mongoose.startSession();
  session.startTransaction();

  const upserted = [];
  const errors = [];

  try {
    const entries = rawJson.trend_data || rawJson; // support both shapes
    const industryList = Array.isArray(entries) ? entries : [entries];

    for (const raw of industryList) {
      try {
        const doc = normaliseEntry(raw, week);

        // 1. Demote previous is_latest for this industry
        await TrendIntel.updateMany(
          { industry: doc.industry, is_latest: true },
          { $set: { is_latest: false } },
          { session },
        );

        // 2. Upsert current week's record
        await TrendIntel.findOneAndUpdate(
          { industry: doc.industry, week },
          { $set: { ...doc, is_latest: true } },
          { upsert: true, new: true, session },
        );

        upserted.push(doc.industry);
      } catch (err) {
        errors.push(`${raw.industry}: ${err.message}`);
      }
    }

    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }

  return { upserted, errors };
}