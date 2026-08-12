import SocialMediaAISummary from "../models/SocialMediaAISummary.js";
import SocialAnalyticsSnapshot from "../models/SocialAnalyticsSnapshot.js";
import Anthropic from "@anthropic-ai/sdk";
import config from "../config/config.js";
import logger from "../config/logger.js";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { format, parseISO, getDay, getHours } from "date-fns";

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Anthropic Client
const getAnthropicClient = () => {
  return new Anthropic({
    apiKey: config.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  });
};

/*
 * 1. Calculate Best Post Times from Historical Posts
 *    Finds top 10 engaging posts, extracts their times, and groups them.
 */
export const calculateInferredBestTimes = (posts = []) => {
  if (!posts || posts.length === 0) {
    return {
      source: "no_data",
      slots: [],
      summary: "Not enough post data to determine best times.",
    };
  }

  // Add total engagement score to each post
  const postsWithEngagement = posts.map((post) => {
    const metrics = post.metrics || {};
    const likes = metrics.likes || 0;
    const comments = metrics.comments || 0;
    const shares = metrics.shares || 0;
    const views = metrics.views || 0;

    // Weighted engagement score (adjust weights if needed)
    const engagementScore = likes + comments * 2 + shares * 3 + views * 0.1;

    return {
      ...post,
      engagementScore,
    };
  });

  // Sort by engagement, take top 20 or less
  const topPosts = postsWithEngagement
    .sort((a, b) => b.engagementScore - a.engagementScore)
    .slice(0, Math.min(20, posts.length));

  if (topPosts.length === 0 || topPosts[0].engagementScore === 0) {
    return {
      source: "no_data",
      slots: [],
      summary: "Not enough engagement data to determine best times.",
    };
  }

  const timeSlots = {};

  topPosts.forEach((post) => {
    const pubDate = post.publishedAt || post.timestamp || post.date;
    if (!pubDate) return;

    try {
      const date = new Date(pubDate);
      if (isNaN(date.getTime())) return;

      const dayOfWeek = DAYS_OF_WEEK[date.getDay()];
      const hour = date.getHours();

      const key = `${dayOfWeek}-${hour}`;
      if (!timeSlots[key]) {
        timeSlots[key] = {
          day: dayOfWeek,
          hour: hour,
          totalEngagement: 0,
          count: 0,
        };
      }

      timeSlots[key].totalEngagement += post.engagementScore;
      timeSlots[key].count += 1;
    } catch (err) {
      // Ignore invalid dates
    }
  });

  const slots = Object.values(timeSlots)
    .map((slot) => ({
      ...slot,
      avgEngagement: slot.totalEngagement / slot.count,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 5) // Top 5 slots
    .map((slot) => ({
      day: slot.day,
      hour: slot.hour,
      avgEngagement: Math.round(slot.avgEngagement),
      confidence: slot.count > 3 ? "high" : slot.count > 1 ? "medium" : "low",
    }));

  const summaryData = slots
    .slice(0, 2)
    .map((s) => `${s.day}s at ${s.hour}:00`)
    .join(" and ");

  return {
    source: "inferred",
    slots,
    summary: `Your posts perform best on ${summaryData} based on historical engagement.`,
  };
};

/*
 * 2. Unified Cross-Platform Summary via Claude
 */

const UnifiedSummarySchema = z.object({
  unifiedSummary: z
    .string()
    .describe(
      "A 2-3 sentence overall summary of their social media presence across all platforms.",
    ),
  overallRecommendations: z
    .array(z.string())
    .describe("3-5 high level recommendations across platforms"),
  crossPlatformBestTimes: z
    .array(
      z.object({
        platform: z.string(),
        summary: z.string(),
        slots: z.array(z.object({ day: z.string(), hour: z.number() })),
      }),
    )
    .describe("Synthesized best times across platforms"),
});

export const generateUnifiedAISummary = async (userId) => {
  try {
    const snapshots = await SocialAnalyticsSnapshot.find({ userId });
    if (!snapshots || snapshots.length === 0) return null;

    const platformContext = snapshots
      .map((p) => {
        const s = p.summary || {};
        const pros = s.strengths || [];
        const cons = s.weaknesses || [];
        const topics = s.bestTopics || [];
        const formats = s.bestFormats || [];
        const tone = s.bestTone || "Unknown";
        const hashtags = s.bestHashtags || [];
        const times = p.bestPostTimes?.summary || "No specific times known.";
        return `Platform: ${p.platform} (Account: ${p.accountId})\nStrengths: ${pros.join(", ")}\nWeaknesses: ${cons.join(", ")}\nBest Topics: ${topics.join(", ")}\nBest Formats: ${formats.join(", ")}\nBest Tone: ${tone}\nBest Hashtags: ${hashtags.join(", ")}\nBest Times: ${times}\n`;
      })
      .join("\n\n");

    const prompt = `As a senior social media strategist, analyze this user's cross-platform presence and provide a unified summary.\n\nHere is the data for all their connected/analyzed platforms:\n${platformContext}\n\nOutput a highly concise unified summary, 3-5 overall strategic recommendations, and synthesize their best posting times.`;

    const client = getAnthropicClient();
    const response = await client.messages.parse({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1500,
      system:
        "You are an expert social media strategist. Keep insights actionable and strictly based on the provided cross-platform data. IMPORTANT: If there is insufficient data to make a recommendation or determine best times, return an empty array or empty string instead of writing phrases like 'Insufficient data'.",
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(UnifiedSummarySchema) },
    });

    const parsed = response.parsed_output;

    await SocialMediaAISummary.updateOne(
      { userId },
      {
        $set: {
          unifiedSummary: parsed.unifiedSummary,
          overallRecommendations: parsed.overallRecommendations,
          crossPlatformBestTimes: parsed.crossPlatformBestTimes,
          generatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    return await SocialMediaAISummary.findOne({ userId });
  } catch (error) {
    logger.error(
      "[SocialAISummary] Error generating unified AI summary:",
      error,
    );
    return null;
  }
};

/*
 * Helper: Generate platform specific summary using Claude
 */
const PlatformSummarySchema = z.object({
  strengths: z
    .array(z.string())
    .describe(
      "3 key strengths based on the analytics. Return empty array if insufficient data.",
    ),
  weaknesses: z
    .array(z.string())
    .describe(
      "3 key weaknesses or areas for improvement. Return empty array if insufficient data.",
    ),
  bestTopics: z
    .array(z.string())
    .describe(
      "Which content topics perform best based on the data. Return empty array if insufficient data.",
    ),
  bestFormats: z
    .array(z.string())
    .describe(
      "Which content formats (video, image, text, carousel) perform best. Return empty array if insufficient data.",
    ),
  bestTone: z
    .string()
    .describe(
      "What tone of voice resonates best with the audience. Return empty string if insufficient data.",
    ),
  bestHashtags: z
    .array(z.string())
    .describe(
      "Which hashtags generate the most reach and engagement. Return empty array if insufficient data.",
    ),
});

export const generatePlatformSummary = async (platform, data) => {
  try {
    const prompt = `Analyze this raw analytics data for the social media platform: ${platform}. 
Extract key insights about performance. Focus on what topics, formats, tone of voice, and hashtags perform best, alongside general strengths and weaknesses.
Data: ${JSON.stringify(data).slice(0, 4000)}`;

    const client = getAnthropicClient();
    const response = await client.messages.parse({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      system:
        "You are an expert social media analyst. Extract strengths and weaknesses purely based on the data provided. IMPORTANT: If the data is empty or insufficient for any field, you MUST return an empty array [] or empty string '' for that field. Do NOT return placeholder text like 'Insufficient data' or 'Not enough information'.",
      messages: [{ role: "user", content: prompt }],
      output_config: { format: zodOutputFormat(PlatformSummarySchema) },
    });

    return response.parsed_output;
  } catch (err) {
    logger.error(
      `[SocialAISummary] Error generating platform summary for ${platform}:`,
      err,
    );
    return { strengths: [], weaknesses: [] };
  }
};

/*
 * 4. Helper to seamlessly trigger the update asynchronously from Social Controllers
 */
export const triggerAISummaryUpdate = async (userId, platform, accountId) => {
  try {
    const snapshot = await SocialAnalyticsSnapshot.findOne({
      userId,
      platform,
      accountId,
    }).sort({ fetchedAt: -1 });

    if (!snapshot) return;

    // Collect arrays in the data, try to find 'posts'
    const data = snapshot.data || {};
    const possibleArrays = Object.values(data).filter(
      (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object",
    );
    // Flatten possible arrays to find objects with metrics
    let allPosts = [];
    possibleArrays.forEach((arr) => {
      allPosts = allPosts.concat(arr);
    });

    const bestPostTimes = calculateInferredBestTimes(allPosts);

    // If using social-audit-analyzer, we could do more. For now, bestPostTimes is key.
    // Re-generate platform summary to ensure it reflects the latest fetched data
    let summary = await generatePlatformSummary(platform, data);

    const topContentTypes = []; // Expand logic if needed based on posts array

    // Also save bestPostTimes to snapshot
    snapshot.summary = summary;
    snapshot.bestPostTimes = bestPostTimes;
    await snapshot.save();

    // Trigger Unified Summary generation (non-blocking)
    generateUnifiedAISummary(userId).catch((err) =>
      console.error("Unified summary generation failed:", err),
    );
  } catch (err) {
    logger.error(
      `[SocialAISummary] Error triggering update for ${userId} - ${platform}`,
      err,
    );
  }
};
