/**
 * trendIntel.service.js  (v2 — intent-aware)
 *
 * Replaces the previous single-query implementation.
 * Now uses the IntentProfile produced by intentExtractor.js to:
 *   1. Match the right industry document
 *   2. Filter posts to those relevant to the detected intent
 *   3. Apply engagement threshold filtering
 *   4. Return the highest-signal posts to Claude
 */

import TrendIntel from "../models/TrendIntel.model.js";
import { extractIntent, INTENT_TAXONOMY } from "./intentExtractor.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_TOP_POSTS   = 10;  // max posts sent to Claude (token budget)
const MAX_HASHTAGS    = 20;  // max hashtags sent to Claude
const MIN_POSTS_AFTER_FILTER = 3; // fall back to full list if filter yields fewer

// ─── Industry alias resolution ────────────────────────────────────────────────

const INDUSTRY_ALIAS_MAP = {
  saas: "SaaS", tech: "SaaS", software: "SaaS", technology: "SaaS",
  "software as a service": "SaaS", "conversational ai": "SaaS",
  b2b: "B2B", "business to business": "B2B", enterprise: "B2B", consulting: "B2B",
  b2c: "B2C", "business to consumer": "B2C", consumer: "B2C",
  retail: "B2C", ecommerce: "B2C", "e-commerce": "B2C",
  manufacturing: "Manufacturing", industrial: "Manufacturing",
  factory: "Manufacturing", engineering: "Manufacturing",
  aerospace: "Manufacturing", construction: "Manufacturing",
};

function resolveIndustry(hint = "") {
  if (!hint) return null;
  return INDUSTRY_ALIAS_MAP[hint.toLowerCase().trim()] || null;
}

// ─── Post scoring ─────────────────────────────────────────────────────────────

function engagementScore(post) {
  const e = post.engagement_metrics || {};
  return (e.views || 0) * 0.5 + (e.likes || 0) * 0.3 + (e.comments || 0) * 0.2;
}

// ─── Intent → Post relevance scoring ─────────────────────────────────────────

/**
 * Score a single post's relevance to a given intent profile.
 * Uses keyword overlap between intent taxonomy and post's textual fields.
 * Returns a 0–1 relevance score.
 */
function intentRelevanceScore(post, intentProfile) {
  const intentConfig = INTENT_TAXONOMY[intentProfile.primary_intent];
  if (!intentConfig) return 0;

  const postText = [
    post.visual_patterns?.hook_techniques || "",
    post.visual_patterns?.pacing || "",
    post.visual_patterns?.shot_composition || "",
    post.visual_patterns?.text_placement || "",
    post.visual_patterns?.camera_movement || "",
    post.caption || "",
    (post.trending_hashtags || []).map((h) => h.value).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  let matches = 0;
  for (const kw of intentConfig.keywords) {
    if (postText.includes(kw.toLowerCase())) matches++;
  }

  const pacingMatch =
    post.pacing && post.pacing === intentConfig.pacing_preference ? 1 : 0;

  let secondaryMatches = 0;
  for (const secondaryIntent of intentProfile.secondary_intents.slice(0, 2)) {
    const secConfig = INTENT_TAXONOMY[secondaryIntent];
    if (!secConfig) continue;
    for (const kw of secConfig.keywords) {
      if (postText.includes(kw.toLowerCase())) secondaryMatches += 0.3;
    }
  }

  const rawScore = matches + pacingMatch + secondaryMatches;
  return Math.min(rawScore / (intentConfig.keywords.length * 0.5), 1);
}

// ─── Combined ranking ─────────────────────────────────────────────────────────

/**
 * Rank posts by:
 *   engagement score  40%
 *   intent relevance  60%
 */
function rankPosts(posts, intentProfile) {
  const engScores = posts.map(engagementScore);
  const maxEng = Math.max(...engScores, 1);

  return posts
    .map((post, i) => {
      const normEng = engScores[i] / maxEng;
      const intentRel = intentRelevanceScore(post, intentProfile);
      return { post, combined: normEng * 0.4 + intentRel * 0.6 };
    })
    .sort((a, b) => b.combined - a.combined)
    .map(({ post }) => post);
}

// ─── Engagement threshold filter ─────────────────────────────────────────────

function filterByEngagementThreshold(posts, avgViews) {
  const threshold = avgViews * 0.3;
  const filtered = posts.filter(
    (p) => (p.engagement_metrics?.views || 0) >= threshold,
  );
  return filtered.length >= MIN_POSTS_AFTER_FILTER ? filtered : posts;
}

// ─── Serialiser ───────────────────────────────────────────────────────────────

function serialiseForLLM(doc, selectedPosts, intentProfile) {
  return {
    industry: doc.industry,
    week: doc.week,
    intent_context: {
      primary_intent:     intentProfile.primary_intent,
      secondary_intents:  intentProfile.secondary_intents.slice(0, 3),
      visual_hook:        intentProfile.visual_hook,
      pacing_preference:  intentProfile.pacing_preference,
      audiences:          intentProfile.audiences,
      emotional_triggers: intentProfile.emotional_triggers,
    },
    top_posts: selectedPosts.map((p) => ({
      url: p.post_url,
      type: p.type,
      caption: p.caption,
      hashtags: (p.trending_hashtags || []).map((h) => h.value),
      engagement: p.engagement_metrics,
      visual_patterns: Object.values(p.visual_patterns || {}).filter(Boolean),
      hook_type: p.visual_patterns?.hook_techniques || "",
      pacing: p.pacing || "",
    })),
    trending_hashtags: (doc.trending_hashtags || [])
      .sort((a, b) => b.total_engagement - a.total_engagement)
      .slice(0, MAX_HASHTAGS)
      .map((h) => ({
        tag: h.value,
        total_engagement: h.total_engagement,
        post_count: h.post_count,
      })),
    industry_insights: {
      avg_engagement: doc.industry_insights?.average_engagement?.likes || 0,
      avg_views:      doc.industry_insights?.average_engagement?.views  || 0,
      dominant_visual_style: doc.industry_insights?.dominant_visual_styles || "",
      trending_hooks:  doc.industry_insights?.trending_hooks || [],
      optimal_pacing:  doc.industry_insights?.optimal_pacing || "",
      key_trends: (doc.industry_insights?.key_trends || []).map((kt) => kt.value),
    },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Primary entry point — intent-aware trend resolution.
 *
 * @param {string} analysisSummary - Raw brand context string
 * @returns {Promise<{ trendData: Object|null, intentProfile: Object }>}
 */
export async function getTrendDataWithIntent(analysisSummary = "") {
  const intentProfile = extractIntent(analysisSummary);

  const industry =
    intentProfile.industry ||
    resolveIndustry(analysisSummary.split(" ").slice(0, 5).join(" "));

  if (!industry) return { trendData: null, intentProfile };

  const doc = await TrendIntel.findOne(
    { industry, is_latest: true },
    null,
    { lean: true },
  );

  if (!doc) return { trendData: null, intentProfile };

  const avgViews = doc.industry_insights?.average_engagement?.views || 0;
  const thresholdFiltered = filterByEngagementThreshold(doc.top_posts || [], avgViews);
  const selectedPosts = rankPosts(thresholdFiltered, intentProfile).slice(0, MAX_TOP_POSTS);

  return {
    trendData: serialiseForLLM(doc, selectedPosts, intentProfile),
    intentProfile,
  };
}

/**
 * Direct industry lookup with optional intent context.
 * Used by admin routes and explicit industry overrides.
 */
export async function getTrendDataForIndustry(industry, analysisSummary = "") {
  const canonical = resolveIndustry(industry) || industry;
  const intentProfile = analysisSummary
    ? extractIntent(analysisSummary)
    : {
        primary_intent: "brand_awareness",
        secondary_intents: [],
        visual_hook: "cinematic_wide",
        pacing_preference: "medium",
        audiences: [],
        emotional_triggers: [],
        all_scores: {},
      };

  const doc = await TrendIntel.findOne(
    { industry: canonical, is_latest: true },
    null,
    { lean: true },
  );

  if (!doc) return null;

  const avgViews = doc.industry_insights?.average_engagement?.views || 0;
  const posts = filterByEngagementThreshold(doc.top_posts || [], avgViews);
  const selectedPosts = rankPosts(posts, intentProfile).slice(0, MAX_TOP_POSTS);

  return serialiseForLLM(doc, selectedPosts, intentProfile);
}

/**
 * Health check — list all industries with active trend data.
 */
export async function listAvailableTrends() {
  const docs = await TrendIntel.find(
    { is_latest: true },
    { industry: 1, week: 1, top_posts: 1 },
    { lean: true },
  );
  return docs.map((d) => ({
    industry: d.industry,
    week: d.week,
    post_count: (d.top_posts || []).length,
  }));
}