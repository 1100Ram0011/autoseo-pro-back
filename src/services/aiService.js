import fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
ffmpeg.setFfmpegPath(ffmpegStatic);
ffmpeg.setFfprobePath(ffprobeStatic.path);
import stream from "stream";
import { GoogleAuth } from "google-auth-library";
import {
  uploadBase64ToS3,
  uploadBase64VideoToS3,
  uploadLogoBufferToS3,
} from "../utils/uploadBase64ToS3.js";
import config from "../config/config.js";
import {
  APPROVAL_SYSTEM_IMAGE_PROMPT,
  PROMPT_APPROVAL_SYSTEM_PROMPT,
  PROMPT_APPROVAL_SYSTEM_PROMPT_LTX,
} from "../prompts/claudeBusinessSummary.prompt.js";
import BusinessSummaryProfile from "../models/BusinessSummaryProfile.js";
import SocialAnalyticsSnapshot from "../models/SocialAnalyticsSnapshot.js";
import { sendThirdPartyApiErrorEmail } from "../utils/emailServices.js";
import { createApiError } from "../utils/createApiError.js";
import { logAndFormatAiError } from "../utils/aiErrorHandler.js";
import { addLogoOutroToVideo } from "../utils/addLogoOutroToVideo.js";
import socketService from "../socket.js";
import axios from "axios";
import sharp from "sharp";
import puppeteer from "puppeteer";
import AISetting from "../models/AISetting.js";
import CaptionConfig from "../models/CaptionConfig.js";
import { stripCrMetadata } from "../utils/stripCrMetadata.js";
import { fileTypeFromBuffer } from "file-type";
import Message from "../models/Message.js";
import { generatePromptAttachmentVideo } from "../controllers/pixverseVideoController.js";
import userModel from "../models/userModel.js";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import {
  calculateCost,
  CLAUDE_PRICING,
} from "../utils/claudPricingCalculate.js";
import { deductDynamicCredit } from "../utils/creditTracker.js";
import logger from "../config/logger.js";
import OpenAI from "openai";
import BrandNewLogos from "../models/BrandNewLogos.js";
import PlatformLimit from "../models/PlatformLimit.model.js";
import SocialPost from "../models/SocialPost.js";
import VideoGenerationLog from "../models/ai/VideoGenerationLog.js";
import settingValueModel from "../models/settingValue.model.js";

/* -----------------------------
HELPER
----------------------------- */

const DEFAULT_CAPTION_COST_CONFIG = {
  topLevelTokens: 15,
  hashtagCounts: {
    instagram: 12,
    pinterest: 10,
    tiktok: 8,
    twitter: 3,
    threads: 4,
    facebook: 4,
    linkedin: 3,
    youtube: 6,
  },
  avgHashtagChars: 14,
  tokensForEntry: {
    jsonKey: 5,
    hashtagSyntax: 10,
    jsonWrapper: 20,
  },
  inputTokenSplit: 0.25,
  outputTokenSplit: 0.75,
  mediaTokenOverhead: {
    image: 1600, // Matches Claude's actual token usage for standard high-res images
    video: 2500,
  },
  defaultModel: "claude-sonnet-4-5-20250929",
  buffer: 1.3,
  commission: 3,
  calculateMarkup: 3,
  baseGuidelines: {
    linkedin: "Professional, insightful, industry-relevant, longer form.",
    twitter: "Short, punchy, conversational.",
    instagram:
      "Visually descriptive, engaging, heavy emoji use, conversational.",
    facebook: "Community-focused, conversational, moderate length.",
    pinterest: "Descriptive, inspirational, SEO-friendly.",
    threads: "Conversational, witty, engaging questions.",
    youtube: "Engaging title-like hook, followed by a descriptive summary.",
  },
  fallbackLimits: {
    twitter: 280,
    threads: 500,
    linkedin: 3000,
    instagram: 2200,
    facebook: 63206,
    pinterest: 500,
    youtube: 5000,
  },
  fallbackTitleLimits: { youtube: 100, pinterest: 100 },
};

export async function getCaptionCostConfig() {
  try {
    const setting = await CaptionConfig.findOne().lean();
    if (setting) {
      const hashtagCounts = {};
      const baseGuidelines = {};
      const fallbackLimits = {};
      const fallbackTitleLimits = {};

      if (setting.platforms) {
        setting.platforms.forEach((p) => {
          hashtagCounts[p.name] = p.hashtagCount;
          baseGuidelines[p.name] = p.baseGuideline;
          fallbackLimits[p.name] = p.fallbackLimit;
          if (p.fallbackTitleLimit > 0) {
            fallbackTitleLimits[p.name] = p.fallbackTitleLimit;
          }
        });
      }

      return {
        ...DEFAULT_CAPTION_COST_CONFIG,
        topLevelTokens:
          setting.topLevelTokens ?? DEFAULT_CAPTION_COST_CONFIG.topLevelTokens,
        avgHashtagChars:
          setting.avgHashtagChars ??
          DEFAULT_CAPTION_COST_CONFIG.avgHashtagChars,
        defaultModel:
          setting.defaultModel ?? DEFAULT_CAPTION_COST_CONFIG.defaultModel,
        buffer: setting.bufferMultiplier ?? DEFAULT_CAPTION_COST_CONFIG.buffer,
        commission:
          setting.commissionMultiplier ??
          DEFAULT_CAPTION_COST_CONFIG.commission,
        calculateMarkup:
          setting.calculateMarkup ??
          DEFAULT_CAPTION_COST_CONFIG.calculateMarkup,
        mediaTokenOverhead:
          setting.mediaTokenOverhead ??
          DEFAULT_CAPTION_COST_CONFIG.mediaTokenOverhead,
        tokensForEntry:
          setting.tokensForEntry ?? DEFAULT_CAPTION_COST_CONFIG.tokensForEntry,
        hashtagCounts: Object.keys(hashtagCounts).length
          ? hashtagCounts
          : DEFAULT_CAPTION_COST_CONFIG.hashtagCounts,
        baseGuidelines: Object.keys(baseGuidelines).length
          ? baseGuidelines
          : DEFAULT_CAPTION_COST_CONFIG.baseGuidelines,
        fallbackLimits: Object.keys(fallbackLimits).length
          ? fallbackLimits
          : DEFAULT_CAPTION_COST_CONFIG.fallbackLimits,
        fallbackTitleLimits: Object.keys(fallbackTitleLimits).length
          ? fallbackTitleLimits
          : DEFAULT_CAPTION_COST_CONFIG.fallbackTitleLimits,
        inputTokenSplit:
          setting.inputTokenSplit ??
          DEFAULT_CAPTION_COST_CONFIG.inputTokenSplit,
        outputTokenSplit:
          setting.outputTokenSplit ??
          DEFAULT_CAPTION_COST_CONFIG.outputTokenSplit,
      };
    }
  } catch (error) {
    console.error("Error fetching caption cost config:", error);
  }
  return DEFAULT_CAPTION_COST_CONFIG;
}

/**
 * Unified Caption Cost Estimation
 * Matches the structure of estimatePlanCost from socialGrowth.controller.js.
 */
export async function estimateCaptionCost({
  userId,
  platforms = [],
  targetAccounts = [],
  promptHint = "",
  mediaType = "image",
  includeAnalytics = false,
  generationType = "social",
  buffer = 1.3,
  commission = 3,
  brandProfile,
  aiSummaryProfile,
  imageUrl,
  scene,
}) {
  const isAccountSpecific = targetAccounts && targetAccounts.length > 0;
  const entries = isAccountSpecific ? targetAccounts : platforms;
  const uniquePlatformNames = [
    ...new Set(
      entries.map((e) =>
        (typeof e === "string" ? e : e.platform).toLowerCase(),
      ),
    ),
  ];

  const limits = await PlatformLimit.find({
    platform: { $in: uniquePlatformNames },
  });

  const config = await getCaptionCostConfig();

  // 1. Output Tokens
  let rawOutput = 0;
  const TOP_LEVEL_TOKENS = config.topLevelTokens;
  rawOutput += TOP_LEVEL_TOKENS;

  const HASHTAG_COUNTS = config.hashtagCounts;
  const AVG_HASHTAG_CHARS = config.avgHashtagChars;

  // Determine economy of scale for output tokens based on total posts requested
  let totalPosts = 0;
  for (const entry of entries) {
    const threadCount =
      typeof entry === "object" && entry.threadCount > 1
        ? entry.threadCount
        : 1;
    totalPosts += threadCount;
  }

  // Calculate a dynamic economy multiplier based on the number of posts requested.
  // We expect high token usage (near 1.0) because we prompt it to MAXIMIZE length per part.
  // However, as the batch size increases, the AI naturally becomes slightly more concise.
  // The multiplier decays smoothly by 0.5% per post, but never drops below a safe floor of 0.75.
  const dropRatePerPost = 0.005;
  const economyMultiplier = Math.max(0.75, 1.0 - totalPosts * dropRatePerPost);

  const breakdownDetails = [];

  for (const entry of entries) {
    const platName = (
      typeof entry === "string" ? entry : entry.platform
    ).toLowerCase();
    const limitInfo = limits.find((l) => l.platform === platName);

    const charLimit = limitInfo?.characterLimit || 1000;
    const titleLimit = limitInfo?.titleLimit || 100;

    // AI is instructed to maximize character limit. 1 token ~= 3 chars for JSON-heavy structures.
    // So the expected max tokens per part is charLimit / 3, multiplied by our economy multiplier.
    const maxPossibleTokens = Math.ceil(charLimit / 3);
    const captionTokens = Math.ceil(maxPossibleTokens * economyMultiplier);

    // Titles are short
    const titleTokens = Math.min(Math.ceil(titleLimit / 3), 40);

    const hashtagCount = HASHTAG_COUNTS[platName] ?? 5;
    const hashtagTextTokens = Math.ceil((hashtagCount * AVG_HASHTAG_CHARS) / 3);

    const TOKENS_FOR_ENTRY = {
      jsonKey: config.tokensForEntry.jsonKey,
      title: titleTokens,
      caption: captionTokens,
      hashtagText: hashtagTextTokens,
      hashtagSyntax: config.tokensForEntry.hashtagSyntax,
      jsonWrapper: config.tokensForEntry.jsonWrapper,
    };

    const tokensPerSingleCaption =
      TOKENS_FOR_ENTRY.jsonKey +
      TOKENS_FOR_ENTRY.title +
      TOKENS_FOR_ENTRY.caption +
      TOKENS_FOR_ENTRY.hashtagText +
      TOKENS_FOR_ENTRY.hashtagSyntax +
      TOKENS_FOR_ENTRY.jsonWrapper;

    const threadCount =
      typeof entry === "object" && entry.threadCount > 1
        ? entry.threadCount
        : 1;
    const tokensPerEntry = tokensPerSingleCaption * threadCount;

    rawOutput += tokensPerEntry;

    breakdownDetails.push({
      platform: platName,
      threadCount,
      tokensPerSingleCaption,
      tokensPerEntry,
      charLimit,
      titleLimit,
      hashtagCount,
      hashtagTextTokens,
    });
  }

  // 2. Input Tokens
  const { systemPrompt, userPrompt } = await buildCaptionPrompts({
    brandProfile,
    userId,
    platforms,
    targetAccounts,
    aiSummaryProfile,
    mediaType,
    userInput: promptHint,
    includeAnalytics,
    imageUrl,
    scene,
  });

  const systemPromptChars = systemPrompt.length;
  const userPromptChars = userPrompt.length;
  const totalChars = systemPromptChars + userPromptChars;

  const textOverhead = config.mediaTokenOverhead?.text || 150;
  const imageOverhead = config.mediaTokenOverhead?.image || 500;
  const videoOverhead = config.mediaTokenOverhead?.video || 1000;

  let mediaTokenOverhead = textOverhead;
  if (mediaType === "image") {
    mediaTokenOverhead = imageOverhead + textOverhead;
  } else if (mediaType === "video") {
    mediaTokenOverhead = videoOverhead + textOverhead;
  } else if (mediaType === "mixed") {
    mediaTokenOverhead = imageOverhead + textOverhead;
  } else {
    mediaTokenOverhead = imageOverhead + videoOverhead + textOverhead;
  }

  console.log("mediaTokenOverhead", mediaTokenOverhead);

  const rawInput = Math.ceil(totalChars / 3) + mediaTokenOverhead;

  // 3. Calculate Pricing (guarantees identical math to actual deduction)
  // Uses dynamic exchange rate from Admin CaptionConfig
  const usdToInr = config.usdToInr || 100;

  const model = config.defaultModel;
  const markup = config.calculateMarkup; // We use calculateMarkup, same as computeCaptionCreditCost

  const costResult = calculateCaptionCost(
    rawInput,
    rawOutput,
    model,
    true, // applyBuffer (applies the markup)
    usdToInr,
    markup
  );

  // We track this just for meta breakdown metrics
  const usedBuffer = Number(buffer) ?? Number(config.buffer);
  const bufferedOutput = Math.ceil(rawOutput * usedBuffer);
  const bufferedInput = Math.ceil(rawInput * usedBuffer);

  // 4. Structure Return (matching estimatePlanCost)
  return {
    coreTokens: rawInput,
    contentTokens: rawOutput,
    totalTokens: rawInput + rawOutput,
    bufferedTokens: bufferedInput + bufferedOutput,
    finalBillableTokens: costResult.totalTokens,
    estimatedCredits: costResult.creditAmount,
    usageSplit: {
      inputTokens: costResult.inputTokens,
      outputTokens: costResult.outputTokens,
    },
    pricing: {
      usd: Number(costResult.totalCostUSD.toFixed(6)),
      inr: Number(costResult.totalCostINR.toFixed(4)),
      usdFormatted: costResult.formatted.totalCost,
      inrFormatted: costResult.formatted.totalINR,
    },
    meta: {
      platforms,
      targetAccounts,
      mediaType,
      generationType,
      rateCard: {
        model,
        inputPerM: CLAUDE_PRICING[model].input,
        outputPerM: CLAUDE_PRICING[model].output,
      },
      breakdown: {
        entriesCount: entries.length,
        isAccountSpecific,
        details: breakdownDetails,
        topLevelTokens: TOP_LEVEL_TOKENS,
        rawOutput,
        bufferedOutput,
        buffer,
        commission: markup,
      },
      inputBreakdown: {
        systemPromptChars,
        userPromptChars,
        mediaTokenOverhead,
        totalChars,
        rawInputTokens: rawInput,
        bufferedInput,
        commission: markup,
      },
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * AI OVERLAY COST ESTIMATION
 * Pre-flight cost estimator for generateAdOverlaySuggestions().
 *
 * Uses the EXACT same SYSTEM_PROMPT and USER_PROMPT strings that the real
 * generation call sends to Claude, so the token estimate is as accurate as
 * possible without actually calling the API.
 *
 * Pricing uses the same computeCaptionCreditCost() pipeline:
 *   - Live USD→INR exchange rate from DB (CaptionConfig.usdToInr)
 *   - 3x commission markup (same as all other AI services)
 * ───────────────────────────────────────────────────────────────────────────── */
export async function estimateOverlayCost({
  userInput = "",
  brandProfile,
  mediaWidth = 1080,
  mediaHeight = 1080,
}) {
  const MODEL = "claude-sonnet-4-5-20250929";

  // ── Replicate the EXACT same prompts from generateAdOverlaySuggestions() ──
  const SYSTEM_PROMPT = `You are a senior advertising art director and copywriter.
Your task is to analyze the background image and generate compelling text for an overlay ad, along with a suggested placement that avoids covering important subjects (like people or focal points).

OUTPUT STRICTLY AS JSON. No markdown formatting, no explanations.
The JSON must have this exact structure:
{
  "headline": "A short, punchy headline (1-6 words)",
  "subtext": "A brief supporting sentence (can be empty)",
  "cta": "Short call to action button text (e.g. 'Learn More', 'Shop Now', or empty)",
  "suggestedPlacement": "One of: top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right",
  "suggestedTheme": "Analyze the image colors at the suggested placement. If the background is light, return 'light' (so we use dark text). If the background is dark, return 'dark' (so we use light text).",
  "rationale": "Why you chose this placement and text based on the image's safe zones"
}`;

  const brandSummary =
    brandProfile?.analysisSummary ||
    brandProfile?.analysis?.business_overview?.core_value_proposition ||
    "";
  const brandName =
    brandProfile?.analysis?.business_overview?.brand_name || "";

  // We cannot know the exact S3 URL at estimation time, but it only adds
  // ~15-20 chars (~5-7 tokens) — negligible for estimation accuracy.
  const USER_PROMPT = `Background image URL:[s3-url-placeholder]
Ad size: ${mediaWidth}x${mediaHeight} px
What this ad should say or promote:${userInput || "Promotional image"}
Business/Personal Summary:${brandSummary}
Brand/Creator Name:${brandName}

Generate the JSON now.`;

  // ── Input tokens ──
  // Text portion: (systemPrompt + userPrompt) chars / 3  (Claude ~3 chars/token)
  const textInputTokens = Math.ceil(
    (SYSTEM_PROMPT.length + USER_PROMPT.length) / 3,
  );

  // Vision overhead: dynamically fetched from Admin CaptionConfig
  const config = await getCaptionCostConfig();
  const IMAGE_VISION_OVERHEAD = config.mediaTokenOverhead?.image || 1600;
  const rawInputTokens = textInputTokens + IMAGE_VISION_OVERHEAD;

  // ── Output tokens ──
  // The JSON output is compact:
  //   headline (~15 chars) + subtext (~80) + cta (~12) + placement (~15)
  //   + theme (~5) + rationale (~150) + JSON structure (~50) ≈ 327 chars → ~109 tokens
  // We use a conservative ceiling of 350 tokens to avoid under-estimating.
  const rawOutputTokens = 350;

  // ── Pricing — identical pipeline to estimateCaptionCost ──
  // computeCaptionCreditCost fetches live USD→INR from DB and applies 3x markup.
  const costResult = await computeCaptionCreditCost(
    rawInputTokens,
    rawOutputTokens,
    MODEL,
    true, // applyBuffer = true (3x markup)
  );

  console.log("costResult========", costResult)

  return {
    coreTokens: rawInputTokens,
    contentTokens: rawOutputTokens,
    totalTokens: rawInputTokens + rawOutputTokens,
    estimatedCredits: costResult.creditAmount,
    usageSplit: {
      inputTokens: costResult.inputTokens,
      outputTokens: costResult.outputTokens,
    },
    pricing: {
      usd: Number(costResult.totalCostUSD.toFixed(6)),
      inr: Number(costResult.totalCostINR.toFixed(4)),
      usdFormatted: costResult.formatted.totalCost,
      inrFormatted: costResult.formatted.totalINR,
    },
    meta: {
      model: MODEL,
      mediaWidth,
      mediaHeight,
      imageVisionOverhead: IMAGE_VISION_OVERHEAD,
      textInputTokens,
      rawOutputTokens,
      markup: 3,
    },
  };
}

/**
 * Calculates caption credit cost from actual or estimated token counts.
 *
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {string} model
 * @param {boolean} applyBuffer  - true = apply commission markup
 * @param {number} usdToInr  - exchange rate
 * @param {number} markup  - commission multiplier (e.g. 3 = 3x)
 * @returns {object} { inputTokens, outputTokens, totalCostUSD, totalCostINR, creditAmount, formatted }
 */
function calculateCaptionCost(
  inputTokens,
  outputTokens,
  model,
  applyBuffer = true,
  usdToInr = 100,
  markup = 3,
) {
  const pricing = CLAUDE_PRICING[model];
  if (!pricing) throw new Error(`Unknown model for caption cost: ${model}`);

  // Always price at raw actual tokens (no multiplication of tokens)
  const rawInputCostUSD = (inputTokens / 1_000_000) * pricing.input;
  const rawOutputCostUSD = (outputTokens / 1_000_000) * pricing.output;
  const rawTotalCostUSD = rawInputCostUSD + rawOutputCostUSD;
  const rawTotalCostINR = rawTotalCostUSD * usdToInr;

  // Round raw INR cost first, then apply commission multiplier
  // Result: always a clean multiple of commission (e.g. raw=2 → 2*3 = 6 credits)
  const rawCredits = Math.ceil(rawTotalCostINR);
  const creditAmount = applyBuffer ? rawCredits * markup : rawCredits;

  // For reporting, show buffered token counts in metadata
  const finalInputTokens = applyBuffer ? Math.ceil(inputTokens * markup) : inputTokens;
  const finalOutputTokens = applyBuffer ? Math.ceil(outputTokens * markup) : outputTokens;
  const totalCostUSD = applyBuffer ? rawTotalCostUSD * markup : rawTotalCostUSD;
  const totalCostINR = applyBuffer ? rawTotalCostINR * markup : rawTotalCostINR;

  return {
    inputTokens: finalInputTokens,
    outputTokens: finalOutputTokens,
    totalTokens: finalInputTokens + finalOutputTokens,
    inputCostUSD: applyBuffer ? rawInputCostUSD * markup : rawInputCostUSD,
    outputCostUSD: applyBuffer ? rawOutputCostUSD * markup : rawOutputCostUSD,
    totalCostUSD,
    totalCostINR,
    rawCredits,
    creditAmount,
    formatted: {
      inputCost: `$${(applyBuffer ? rawInputCostUSD * markup : rawInputCostUSD).toFixed(6)}`,
      outputCost: `$${(applyBuffer ? rawOutputCostUSD * markup : rawOutputCostUSD).toFixed(6)}`,
      totalCost: `$${totalCostUSD.toFixed(6)}`,
      totalINR: `₹${totalCostINR.toFixed(4)}`,
      credits: `${creditAmount} credits`,
    },
  };
}

/**
 * ─────────────────────────────────────────────────────────────────
 * CENTRALIZED ASYNC COST COMPUTER
 * Single source of truth for ALL caption credit calculations.
 *
 * Used by:
 *   - estimate-caption-cost route  (pre-flight, estimated tokens)
 *   - generatePlatformSpecificCaptions  (post-call, real tokens)
 *   - generateSocialPostCaptions        (post-call, real tokens)
 *   - generateTextSocialPostCaptions    (post-call, real tokens)
 *
 * Always fetches live USD→INR exchange rate from DB.
 * Applies 3x buffer markup (applyBuffer = true by default).
 * ─────────────────────────────────────────────────────────────────
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {string} [model]
 * @param {boolean} [applyBuffer]  - true = 3x markup (default)
 * @returns {Promise<object>}  same shape as calculateCaptionCost()
 */
export async function computeCaptionCreditCost(
  inputTokens,
  outputTokens,
  model,
  applyBuffer = true,
) {
  const config = await getCaptionCostConfig();
  const actualModel = model || config.defaultModel;

  // Fetch live exchange rate directly from dynamic Admin CaptionConfig
  const usdToInr = config.usdToInr || 100;

  const result = calculateCaptionCost(
    inputTokens,
    outputTokens,
    actualModel,
    applyBuffer,
    usdToInr,
    config.calculateMarkup,
  );

  console.log(`\n[Credit Cost Calculation] Model: ${actualModel}`);
  console.log(`  Tokens: Input=${inputTokens} | Output=${outputTokens}`);
  console.log(`  Raw Cost: ₹${(result.rawCredits).toFixed(2)} (${result.rawCredits} credits)`);
  if (applyBuffer) {
    console.log(`  Markup Applied: ${config.calculateMarkup}x`);
    console.log(`  Commission Amount: ${result.creditAmount - result.rawCredits} credits`);
    console.log(`  Final Billable: ${result.creditAmount} credits`);
  } else {
    console.log(`  No Markup Applied`);
  }

  return result;
}

/**
 * Convenience wrapper to calculate raw API cost without our markup or splits.
 */
export async function computeCaptionCreditCostWithoutBuffer(
  inputTokens,
  outputTokens,
  model,
) {
  return computeCaptionCreditCost(inputTokens, outputTokens, model, false);
}

function buildBusinessContext(brandProfile, socialMediaInsights = "") {
  let context = `BUSINESS AND BRAND CONTEXT (CRITICAL):\n`;

  // Basic info from either the old structure or the new analysis structure
  const brandName =
    brandProfile?.analysis?.business_overview?.brand_name ||
    brandProfile?.company?.name ||
    "";
  const businessSummary =
    brandProfile?.analysisSummary ||
    brandProfile?.aiInsights?.summary ||
    brandProfile?.description ||
    "";

  context += `Brand Name: ${brandName}\n`;
  context += `Business Summary: ${businessSummary}\n`;

  // New rich data structure
  if (brandProfile?.analysis) {
    const analysis = brandProfile.analysis;
    if (analysis.target_market?.primary_customer_segments) {
      context += `Target Audience: ${analysis.target_market.primary_customer_segments.join(", ")}\n`;
    }
    if (analysis.content_strategy?.content_pillars) {
      context += `Content Pillars: ${analysis.content_strategy.content_pillars.join(", ")}\n`;
    }
    if (analysis.conversion_funnel_insights?.tofu_hooks) {
      context += `Marketing Hooks: ${analysis.conversion_funnel_insights.tofu_hooks.join(" | ")}\n`;
    }
    if (analysis.branding_guidelines?.visual_style) {
      context += `Visual/Brand Style: ${analysis.branding_guidelines.visual_style}\n`;
    }
    if (analysis.competitive_differentiation_matrix) {
      context += `Competitive Differentiation: ${JSON.stringify(analysis.competitive_differentiation_matrix)}\n`;
    }
    if (analysis.business_overview?.core_value_proposition) {
      context += `Value Proposition: ${analysis.business_overview.core_value_proposition}\n`;
    }
  }

  if (socialMediaInsights) {
    context += `${socialMediaInsights}\n`;
  }

  return context.trim();
}

/* ─────────────────────────────────────────────────────────────────────────────
 * CENTRALIZED PROMPT BUILDER
 * Single source of truth for SYSTEM_PROMPT + USER_PROMPT across all 3 caption
 * generation functions AND the estimation route.
 *
 * Used by:
 *   - estimateCaptionInputTokens          (pre-flight, measures prompt length)
 *   - generatePlatformSpecificCaptions    (media, with analytics support)
 *   - generateSocialPostCaptions          (media, no analytics)
 *   - generateTextSocialPostCaptions      (text-only, thread support)
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function buildCaptionPrompts({
  brandProfile = null,
  userId = null,
  platforms = [],
  targetAccounts = [],
  aiSummaryProfile = null,
  mediaType = "image", // "image" | "video" | "text"
  userInput = "",
  imageUrl = "",
  scene = "",
  includeAnalytics = false, // true only for generatePlatformSpecificCaptions
}) {
  const isAccountSpecific = targetAccounts && targetAccounts.length > 0;
  const isTextOnly = mediaType === "text";

  // ── Resolve unique platform names ──────────────────────────────────────────
  const uniquePlatformNames = [
    ...new Set(
      isAccountSpecific
        ? targetAccounts.map((a) => (a.platform || "").toLowerCase())
        : platforms.map((p) => p.toLowerCase()),
    ),
  ];

  // ── Fetch platform limits from DB ──────────────────────────────────────────
  const platformLimits = await PlatformLimit.find({
    platform: { $in: isAccountSpecific ? uniquePlatformNames : platforms },
    isActive: true,
  });

  // ── Fetch brand profile if not pre-loaded ──────────────────────────────────
  if (!brandProfile && userId) {
    brandProfile = await BusinessSummaryProfile.findOne({
      userId,
      status: "COMPLETED",
      isActive: true,
    }).lean();
  }

  // ── Shared lookup tables (same in all 3 functions) ─────────────────────────
  const config = await getCaptionCostConfig();

  const baseGuidelines = config.baseGuidelines;
  const fallbackLimits = config.fallbackLimits;
  const fallbackTitleLimits = config.fallbackTitleLimits;

  const getPlatformTitleLimit = (plat) => {
    const info = platformLimits.find((p) => p.platform === plat);
    return info?.titleLimit > 0
      ? info.titleLimit
      : fallbackTitleLimits[plat] || 100;
  };

  // ── Build guidelinesText ───────────────────────────────────────────────────
  let guidelinesText = "Guidelines for platforms:\n";
  (isAccountSpecific ? uniquePlatformNames : platforms).forEach((platform) => {
    const info = platformLimits.find((p) => p.platform === platform);
    const charLimit = info?.characterLimit || fallbackLimits[platform] || 2200;
    const base = baseGuidelines[platform] || "";
    const aiTargetLimit = Math.max(100, charLimit - 50);
    guidelinesText += `- ${platform}: ${base} TARGET LENGTH: ~${Math.floor(aiTargetLimit * 0.8)} to ${aiTargetLimit} chars PER POST. ABSOLUTE HARD LIMIT: ${aiTargetLimit} CHARACTERS (including hashtags). If generating multiple thread parts, this limit applies to EACH INDIVIDUAL PART. Do NOT exceed ${aiTargetLimit} characters per part under any circumstances, and ensure the final sentence is fully complete.\n`;
  });

  // ── Build expectedStructure + userPromptAccounts + threadInstructions ───────
  let expectedStructure = "";
  let userPromptAccounts = "";
  let threadInstructions = "";

  if (isAccountSpecific) {
    if (isTextOnly) {
      // Text-only: thread-aware JSON structure
      const structureLines = targetAccounts
        .map((acc) => {
          const tc = acc.threadCount || 1;
          if (tc > 1) {
            return `  "${acc.id}": [\n    // EXACTLY ${tc} objects in this array, one for each thread part\n    {\n      "title": "Catchy title (max 100 chars) - ONLY for youtube/pinterest, empty for others",\n      "caption": "Part 1 text (hook + opening)",\n      "hashtags": ["tag1", "tag2"]\n    },\n    {\n      "title": "",\n      "caption": "Part 2 text (continuation)",\n      "hashtags": []\n    }\n  ]`;
          } else {
            return `  "${acc.id}": {\n    "title": "Catchy title (max 100 chars) - ONLY for youtube/pinterest, empty for others",\n    "caption": "Engaging caption with scroll-stopping HOOK. Fill the char limit. NO hashtags inside.",\n    "hashtags": ["tag1", "tag2"]\n  }`;
          }
        })
        .join(",\n");

      expectedStructure = `Output JSON with account IDs as keys:\n{\n${structureLines}\n}`;
      userPromptAccounts = `Generate for these Account IDs (platform in brackets, thread count in parens):\n${targetAccounts
        .map(
          (acc) =>
            `- ID: "${acc.id}" [${acc.platform}]${acc.threadCount > 1 ? ` (${acc.threadCount} thread parts)` : ""}`,
        )
        .join("\n")}`;

      const threadedAccounts = targetAccounts.filter(
        (a) => (a.threadCount || 1) > 1,
      );
      if (threadedAccounts.length > 0) {
        threadInstructions = `\n\nTHREAD MODE — for the following accounts, generate an ARRAY OF POST OBJECTS with the EXACT number of parts listed. Each part must be self-contained and MUST MAXIMIZE the platform's character limit INDIVIDUALLY. Do not artificially shorten parts just because there are multiple of them. Parts together tell one cohesive story.\n${threadedAccounts
          .map((a) => `- ID "${a.id}" [${a.platform}]: ${a.threadCount} parts`)
          .join("\n")}`;
      }
    } else {
      // Media-based: account-ID-keyed structure
      expectedStructure = `The JSON must have this exact structure where keys are the specific Account IDs provided below:
{
  "[account_id_1]": {
    "title": "A catchy title (max 100 chars) - REQUIRED ONLY for youtube and pinterest, leave empty for others. Ensure you obey the specific platform title limits.",
    "caption": "An engaging, well-written caption starting with a powerful, scroll-stopping HOOK. Maximize the length to fill the character limit, optimized for the culture and character limits of this specific platform. Do NOT include any hashtags inside the caption text itself. Provide unique variations if multiple accounts share the same platform.",
    "hashtags": ["tag1", "tag2"]
  }
}
Target Account IDs and their corresponding platforms to generate for (MUST use these exact IDs as JSON keys):
${targetAccounts
          .map((acc) => {
            const tLimit = getPlatformTitleLimit(acc.platform.toLowerCase());
            return `- ID: "${acc.id}" (Platform: ${acc.platform}) - Title Limit: ${tLimit} chars`;
          })
          .join("\n")}`;
      userPromptAccounts = `Generate unique caption variations for the following Account IDs:\n${targetAccounts
        .map((acc) => `${acc.id} (${acc.platform})`)
        .join("\n")}`;
    }
  } else {
    if (isTextOnly) {
      expectedStructure = `Output JSON with platform names as keys (lowercase):\n{\n  "[platform]": {\n    "title": "Catchy title (ONLY for youtube/pinterest, empty otherwise)",\n    "caption": "Engaging caption with scroll-stopping HOOK. Fill the char limit. NO hashtags inside.",\n    "hashtags": ["tag1", "tag2"]\n  }\n}`;
      userPromptAccounts = `Platforms: ${platforms.join(", ")}`;
    } else {
      expectedStructure = `The JSON must have this exact structure where keys are the platform names in lowercase (e.g., "instagram", "linkedin", "facebook", "twitter", "threads", "pinterest", "youtube"):
{
  "[platform_name]": {
    "title": "A catchy title (max 100 chars) - REQUIRED ONLY for youtube and pinterest, leave empty for others. Max chars for YouTube: ${getPlatformTitleLimit("youtube")}, Pinterest: ${getPlatformTitleLimit("pinterest")}",
    "caption": "An engaging, well-written caption starting with a powerful, scroll-stopping HOOK. Maximize the length to fill the character limit, optimized for the culture and character limits of this specific platform. Do NOT include any hashtags inside the caption text itself.",
    "hashtags": ["tag1", "tag2"]
  }
}`;
      userPromptAccounts = `Platforms requested: ${platforms.join(", ")}`;
    }
  }

  // ── Build socialMediaInsights from aiSummaryProfile ────────────────────────
  let socialMediaInsights = "";
  if (aiSummaryProfile && !isTextOnly) {
    if (aiSummaryProfile.unifiedSummary) {
      socialMediaInsights += `\nSocial Media Audience Insights:\n${aiSummaryProfile.unifiedSummary}\nConsider these preferences when determining tone and composition.`;
    }
    if (aiSummaryProfile.overallRecommendations?.length > 0) {
      socialMediaInsights += `\nOverall Recommendations:\n${aiSummaryProfile.overallRecommendations.join("\n")}\n`;
    }
  }

  // ── Optionally build aiAnalyticsGuidelines (platform-specific only) ─────────
  let aiAnalyticsGuidelines = "";
  if (includeAnalytics && isAccountSpecific && userId) {
    const accountIds = targetAccounts.map((a) => String(a.id));
    const snapshots = await SocialAnalyticsSnapshot.find({
      userId,
      accountId: { $in: accountIds },
    });
    if (snapshots?.length > 0) {
      aiAnalyticsGuidelines = `\nCRITICAL ACCOUNT-SPECIFIC HISTORICAL INSIGHTS:\nBased on past analytics, you MUST follow these specific guidelines for each account to maximize engagement:\n`;
      snapshots.forEach((snap) => {
        const s = snap.summary || {};
        const topics = s.bestTopics || [];
        const formats = s.bestFormats || [];
        const tone = s.bestTone || "";
        const hashtags = s.bestHashtags || [];
        if (topics.length || formats.length || tone || hashtags.length) {
          aiAnalyticsGuidelines += `\nFor Account ID "${snap.accountId}" (${snap.platform}):\n`;
          if (topics.length)
            aiAnalyticsGuidelines += `- Proven Topics: ${topics.join(", ")}\n`;
          if (formats.length)
            aiAnalyticsGuidelines += `- Proven Formats: ${formats.join(", ")}\n`;
          if (tone)
            aiAnalyticsGuidelines += `- Best Performing Tone: ${tone}\n`;
          if (hashtags.length)
            aiAnalyticsGuidelines += `- Top Hashtags to include: ${hashtags.join(", ")}\n`;
        }
      });
    }
  }

  // ── Build brand context string ─────────────────────────────────────────────
  const brandContextStr = buildBusinessContext(
    brandProfile || {},
    socialMediaInsights,
  );

  // ── CRITICAL INSTRUCTIONS — detailed for media, condensed for text-only ─────
  const criticalInstructions = isTextOnly
    ? `CRITICAL INSTRUCTIONS:
1. VIRAL HOOK GENERATION (CRITICAL): The FIRST line of every caption must be an explosive, scroll-stopping HOOK.
2. RADICALLY HUMANIZE THE TONE: Write exactly how a real person speaks. NO robotic AI-speak, corporate jargon, or overused clich\u00e9s.
3. STRICT CHARACTER LIMITS & COMPLETION: Finish thoughts completely. Never cut off sentences.
4. HASHTAGS: Provide relevant hashtags in the JSON "hashtags" array. NEVER inside caption text.
5. AI DETECTION EVASION: Vary sentence lengths, break grammar rules occasionally, use colloquialisms.
${threadInstructions}`
    : `CRITICAL INSTRUCTIONS:
1. VIRAL HOOK GENERATION (CRITICAL): The FIRST line of every caption must be an explosive, scroll-stopping HOOK. Do NOT start with boring introductions. Use pattern interrupts, polarizing thoughts, compelling statistics, or open loops. If 'Marketing Hooks' are provided in the context, strictly adapt those angles to the culture of each platform.
2. RADICALLY HUMANIZE THE TONE: Write exactly how a real person speaks to their peers. Sound completely natural, authentic, and slightly imperfect. Absolutely NO robotic "AI-speak", corporate jargon, or overused clich\u00e9s (e.g., "In today's fast-paced world," "Unlock your potential," "Elevate your strategy," "Delve into"). Use natural pacing, short sentences, and strategic line breaks. Be relatable and vulnerable where appropriate.
3. STRICT CHARACTER LIMITS & COMPLETION: You must finish your thought completely. It is UNACCEPTABLE to have cut-off sentences. Always aim to finish the caption well before the maximum character limit to allow room for hashtags.
4. HASHTAGS: Provide highly relevant hashtags in the JSON "hashtags" array. Tailor the number of hashtags to platform best practices (e.g., 2-4 for Twitter/LinkedIn, 10-15 for Instagram). NEVER put hashtags inside the main caption text.
5. AI DETECTION EVASION (CRITICAL): Ensure the text is completely undetectable by AI scanners. Vary sentence lengths drastically (some 1-2 words, some long). Break standard grammar rules occasionally for conversational effect. Use colloquialisms and raw pacing. NEVER use standard AI transition phrases (e.g., "Furthermore," "Moreover," "Ultimately," "In conclusion"). The writing must feel completely raw, unpolished, and typed by a human on their phone.`;

  // ── Assemble SYSTEM_PROMPT ─────────────────────────────────────────────────
  const SYSTEM_PROMPT = `You are an expert social media manager and copywriter.
Your task is to analyze the user's input and generate highly engaging, platform-optimized captions and hashtags for the specified platforms.

${brandContextStr}

${criticalInstructions}

OUTPUT STRICTLY AS JSON. No markdown${isTextOnly ? "" : " formatting"}, no explanations.
CRITICAL JSON RULES:
1. The output MUST be valid, parseable JSON.
2. ALL double quotes inside strings MUST be properly escaped as \".
3. NO raw newlines or control characters inside strings. Use \\n for line breaks.

${expectedStructure}

${guidelinesText}${aiAnalyticsGuidelines}`;

  // ── Assemble USER_PROMPT ───────────────────────────────────────────────────
  const USER_PROMPT = isTextOnly
    ? `What this post should say or promote: ${userInput || ""}
${userPromptAccounts}

Generate the JSON now.`
    : `Background ${mediaType === "video" ? "video" : "image"} URL:${imageUrl}
Scene description:${scene || ""}
What this post should say or promote:${userInput || ""}
${userPromptAccounts}

Generate the JSON now.`;

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: USER_PROMPT,
    platformLimits, // Returned so callers can reuse for truncation
    isAccountSpecific,
    fallbackLimits,
  };
}

/* -----------------------------
CONFIG
----------------------------- */

const PROJECT_ID = config.GOOGLE_PROJECT_ID;
const LOCATION = "global";

/* VIDEO MODELS */

const VIDEO_MODEL_MAP = {
  "veo-3.1": "veo-3.1-generate-001",
  "veo-3.1-fast": "veo-3.1-fast-generate-001",
  "veo-3": "veo-3.1-fast-generate-001",
  "veo-3-fast": "veo-3.0-fast-generate-001",
  "veo-2": "veo-2.0-generate-001",
};

/* IMAGE MODELS */

const IMAGE_MODEL_MAP = {
  "gemini-2.5-flash-image": "gemini-2.5-flash-image",
  "imagen-4-ultra": "imagen-4.0-ultra-generate-001",
  "imagen-4": "imagen-4.0-generate-001",
  "imagen-4-fast": "imagen-4.0-fast-generate-001",

  "imagen-3": "imagen-3.0-generate-002",
  "imagen-3-fast": "imagen-3.0-fast-generate-001",

  // fallback
  "imagen-2": "imagen-4.0-generate-001",
};

/* -----------------------------
AUTH
----------------------------- */

export async function getAccessToken() {
  const auth = new GoogleAuth({
    keyFile: config.KEY_FILE,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const { token } = await client.getAccessToken();

  const projectId = await auth.getProjectId();
  console.log("Token project:", projectId);

  return token;
}

function emit(chatId, event, payload) {
  socketService.emitToChat(chatId, event, {
    chatId,
    ...payload,
  });
}

/* -----------------------------
VIDEO GENERATION (VEO)
----------------------------- */
/* -----------------------------
VIDEO GENERATION (DISPATCHER)
----------------------------- */
export async function generateVideo(
  prompt,
  userId,
  attachmentPath = null,
  params = {},
  chatId,
  messageId,
  isLongFormClip = false,
  isBusiness = false,
) {
  try {
    const setting = await AISetting.findOne({ key: "activeVideoModel" });
    const activeModel = params.engine || setting?.value || "omni-flash";

    // Log the exact prompt sent to the API
    await VideoGenerationLog.create({
      user: userId,
      chat: chatId,
      message: messageId,
      modelEngine: activeModel,
      finalPayloadPrompt: prompt,
      isTruncated: false,
    }).catch((err) => console.error("Failed to log VideoGenerationLog:", err));

    if (activeModel === "ltx") {
      console.log("Using LTX Video Generation Model");
      return await generateVideoLTX(
        prompt,
        userId,
        attachmentPath,
        params,
        chatId,
        messageId,
      );
    } else if (activeModel === "pixverse") {
      console.log("Using PixVerse Video Generation Model");
      return await generatePromptAttachmentVideo(
        prompt,
        userId,
        attachmentPath,
        params, // Important: pass down actual params (duration, logoUrl, contactLines) instead of hardcoding 8/540p
        chatId,
        messageId,
        isLongFormClip, // Important: pass down the long form flag for downstream processing
      );
    }
    else if (activeModel === "veo") {
      console.log("Using Veo Video Generation Model");
      return await generateVideoVeo(
        prompt,
        userId,
        attachmentPath,
        params,
        chatId,
        messageId,
        isLongFormClip,
        isBusiness,
      );
    }

    else {
      console.log("Using Omni Flash Video Generation Model");
      console.log('Prompt', prompt)
      return await generateVideoOmni(
        prompt,
        userId,
        attachmentPath,
        params,
        chatId,
        messageId,
        isLongFormClip,
        isBusiness,
      );
    }
  } catch (error) {
    console.error("Master video generation error:", error);
    throw error;
  }
}

/* -----------------------------
VIDEO GENERATION (VEO)
----------------------------- */
async function generateVideoVeo(
  prompt,
  userId,
  attachmentPath = null,
  params = {},
  chatId,
  messageId,
  isLongFormClip = false,
  isBusiness,
) {
  try {
    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling Veo API");
    }

    const token = await getAccessToken();

    const requestedModel = params?.model || "veo-3";
    const modelId =
      VIDEO_MODEL_MAP[requestedModel] || "veo-3.1-fast-generate-preview";

    const aspectRatio = params?.aspect || "16:9";
    const resolution = params?.quality || params?.resolution || "720p";
    // const durationSeconds = parseInt(params?.duration?.replace("s", "")) || 8;
    const durationSeconds = parseInt(params?.duration) || 8;

    const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:predictLongRunning`;

    const instance = {
      prompt: prompt.trim(),
    };

    if (attachmentPath) {
      // FIX 1: Strip the data URI prefix so Vertex AI doesn't crash
      const cleanBase64 = Buffer.isBuffer(attachmentPath)
        ? attachmentPath.toString("base64")
        : attachmentPath.replace(/^data:image\/\w+;base64,/, "");

      const getMimeType = (b64) => {
        if (b64.startsWith("/9j/")) return "image/jpeg";
        if (b64.startsWith("iVBORw0KGgo")) return "image/png";
        if (b64.startsWith("UklGR")) return "image/webp";
        return "image/png"; // default fallback
      };
      const actualMimeType = getMimeType(cleanBase64);

      if (params.isContinuationFrame) {
        // SCENE 2+: Use as strict first frame for perfect cinematic continuity (I2V)
        instance.image = {
          bytesBase64Encoded: cleanBase64,
          mimeType: actualMimeType,
        };
      } else {
        // SCENE 1 (or Short-form): Provide as a reference image for T2V + Image Conditioning (instead of I2V first-frame)
        instance.referenceImages = [{
          referenceType: "asset",
          image: {
            bytesBase64Encoded: cleanBase64,
            mimeType: actualMimeType,
          }
        }];
      }
    }

    const payload = {
      instances: [instance],
      parameters: {
        aspectRatio,
        resolution,
        durationSeconds,
        // enhancePrompt: params.enhancePrompt !== undefined ? params.enhancePrompt : true,
      },
    };

    console.log("payload veo", payload);

    console.log("Requested video model:", requestedModel);
    console.log("Resolved video model:", modelId);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const operation = await response.json();

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 70,
      message: "Animating scene...",
    });

    // FIX 2: Pass params.logoUrl down to the polling function so FFmpeg triggers
    return await pollVeoOperation(
      operation.name,
      token,
      modelId,
      params.logoUrl,
      chatId || null,
      messageId || null,
      params.contactLines || [],
      userId,
      isLongFormClip,
      isBusiness,
    );
  } catch (error) {
    console.error("Veo video generation error:", error);
    throw error;
  }
}

async function generateVideoOmni(
  prompt,
  userId,
  attachmentPath = null,
  params = {},
  chatId,
  messageId,
  isLongFormClip = false,
  isBusiness,
) {
  try {
    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling Gemini Omni.");
    }

    const token = await getAccessToken();

    const modelId = "gemini-omni-flash-preview";

    const url = `https://aiplatform.googleapis.com/v1beta1/projects/${PROJECT_ID}/locations/global/interactions`;

    const input = [];

    // if (attachmentPath) {
    //   const cleanBase64 = Buffer.isBuffer(attachmentPath)
    //     ? attachmentPath.toString("base64")
    //     : attachmentPath.replace(/^data:image\/\w+;base64,/, "");

    //   const getMimeType = (b64) => {
    //     if (b64.startsWith("/9j/")) return "image/jpeg";
    //     if (b64.startsWith("iVBORw0KGgo")) return "image/png";
    //     if (b64.startsWith("UklGR")) return "image/webp";
    //     return "image/png";
    //   };

    //   input.push({
    //     type: "image",
    //     data: cleanBase64,
    //     mime_type: getMimeType(cleanBase64),
    //   });
    // }

    input.push({
      type: "text",
      text: prompt.trim(),
    });

    const referenceImages = params?.characterImages || [];
    for (const imageUrl of referenceImages) {
      try {
        console.log("Downloading reference image:", imageUrl);

        const response = await fetch(imageUrl);

        if (!response.ok) {
          throw new Error(`Failed to fetch ${imageUrl}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        input.push({
          type: "image",
          data: buffer.toString("base64"),
          mime_type: response.headers.get("content-type") || "image/png",
        });

        console.log(
          `Added reference image (${response.headers.get("content-type")})`
        );
      } catch (err) {
        console.error("Failed to load reference image:", imageUrl, err);
      }
    }

    console.log('referenceImages', referenceImages)


    const aspectRatio = params.aspect || "16:9";

    const payload = {
      model: modelId,
      input,
      response_format: {
        type: 'video',
        aspect_ratio: aspectRatio,
      }
    };


    // console.log('attachements', attachmentPath)

    // console.log("Omni Payload:", JSON.stringify(payload));

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 20,
      message: "Submitting request...",
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const interaction = await response.json();

    // console.log("Omni Interaction Response:", JSON.stringify(interaction));

    if (!interaction.id) {
      throw new Error("No interaction ID returned.");
    }

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 80,
      message: "Processing response...",
    });

    const outputStep = interaction.steps?.find(
      (step) => step.type === "model_output"
    );

    if (!outputStep) {
      throw new Error("No model output returned.");
    }

    const video = outputStep.content?.find(
      (item) => item.type === "video"
    );

    if (!video) {
      throw new Error("No video found in response.");
    }

    // const videoBuffer = Buffer.from(video.data, "base64");

    let finalVideoBase64 = video.data;

    //  const videoUrlX = await uploadBase64VideoToS3(
    //   finalVideoBase64,
    //   config.AWS_S3_GENERATE_VEO_VIDEO_FOLDER
    // );

    // console.log('saving the duffer before ffmgpe', videoUrlX)

    console.log("Starting FFmpeg pipeline...");

    if (!isLongFormClip && isBusiness) {
      try {
        const rawVideoBuffer = Buffer.from(finalVideoBase64, "base64");

        const processedVideoBuffer = await addLogoOutroToVideo(
          rawVideoBuffer,
          params.logoUrl,
          params.contactLines || [],
          userId,
        );

        finalVideoBase64 = processedVideoBuffer.toString("base64");

        console.log("FFmpeg processing completed.");
      } catch (err) {
        console.error("FFmpeg failed, using original video.", err);
      }
    }

    console.log("Stripping CR metadata...");

    const cleanBuffer = await stripCrMetadata(
      finalVideoBase64,
      "video"
    );

    const cleanBase64 = cleanBuffer.toString("base64");

    console.log("Uploading video to S3...");

    const videoUrl = await uploadBase64VideoToS3(
      cleanBase64,
      config.AWS_S3_GENERATE_VEO_VIDEO_FOLDER
    );

    console.log("Omni Upload Complete:", videoUrl);
    emit(chatId, "generation:progress", {
      messageId,
      percentage: 100,
      message: "Video generated.",
    });


    return {
      success: true,
      videoUrl,
      mimeType: video.mime_type || "video/mp4",
      usage: {
        ...interaction?.usage, modelRespose: {
          interactionId: interaction.id,
          model: interaction.model,
          status: interaction.status,
          created: interaction.created,
          updated: interaction.updated,
        }
      }
    };


    // return {
    //   success: true,
    //   interactionId: interaction.id,
    //   model: interaction.model,
    //   status: interaction.status,
    //   usage: interaction.usage,
    //   videoBuffer,
    //   mimeType: video.mime_type || "video/mp4",

    //   // keep compatibility with your existing pipeline
    //   logoUrl: params.logoUrl,
    //   contactLines: params.contactLines || [],
    //   userId,
    //   isLongFormClip,
    //   isBusiness,
    // };
  } catch (error) {
    console.error("Gemini Omni generation error:", error);
    const formatted = await logAndFormatAiError(error, "Vertex AI", {
      userId,
      feature: "generateVideoOmni",
      requestPayload: { prompt, params },
    });
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.errorCode;
    customErr.status = formatted.status;
    customErr.formattedError = formatted;
    throw customErr;
  }
}

/* -----------------------------
VEO POLLING
----------------------------- */

// async function pollVeoOperation(operationName, token, modelId) {
//   const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:fetchPredictOperation`;

//   for (let attempt = 0; attempt < 60; attempt++) {
//     const response = await fetch(url, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${token}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({ operationName }),
//     });

//     if (!response.ok) {
//       throw new Error(await response.text());
//     }

//     const data = await response.json();

//     if (data.done) {
//       if (data.error) throw new Error(data.error.message);

//       const video = data.response?.videos?.[0];

//       if (!video) {
//         throw new Error("Veo completed but returned no video");
//       }

//       const videoUrl = await uploadBase64VideoToS3(
//         video.bytesBase64Encoded,
//       );

//       return {
//         success: true,
//         videoUrl,
//         mimeType: video.mimeType || "video/mp4",
//       };
//     }

//     await new Promise((r) => setTimeout(r, 5000));
//   }

//   throw new Error("Veo polling timeout");
// }

/**
 * Core Logo Generator - Compact & Transparent
 */
async function generateLogoBuffer({
  name,
  initials,
  colors,
  fonts,
  visualStyle,
}) {
  // Tightened canvas size to fit the content exactly
  const width = 500;
  const height = 350;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const primaryColor = colors?.[0] || "#0000FF";

  // Ensure transparent background
  ctx.clearRect(0, 0, width, height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 1. Draw Initials (Moved up to fit the smaller height)
  ctx.fillStyle = primaryColor;
  ctx.font = `900 200px "${fonts?.[0] || "sans-serif"}"`;
  ctx.fillText(initials, width / 2, height * 0.3);

  // 2. Draw Divider Line
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 12;

  const lineY = height * 0.6;
  ctx.beginPath();
  ctx.moveTo(width * 0.1, lineY); // Stretching slightly wider relative to box
  ctx.lineTo(width * 0.9, lineY);
  ctx.stroke();

  // 3. Draw Brand Name (Moved down to the bottom edge)
  ctx.font = `bold 50px "${fonts?.[1] || fonts?.[0] || "sans-serif"}"`;
  ctx.fillText(name.toUpperCase(), width / 2, height * 0.82);

  return canvas.toBuffer("image/png");
}

// Helper function to convert hex to rgba
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const createStaticLogo = async (analysis) => {
  const brandName =
    analysis?.business_overview?.brand_name ||
    business_overview?.brand_name ||
    "COMPANY" ||
    "";
  const initials = brandName
    .split(/\s+/)
    .map((n) => n[0])
    .join("")
    .toUpperCase();

  return await generateLogoBuffer({
    name: brandName,
    initials: initials,
    colors: analysis?.branding_guidelines?.brand_colors,
    fonts: analysis?.branding_guidelines?.fonts,
    visualStyle: analysis?.branding_guidelines?.visual_style,
  });
};

// async function generateLogoBuffer({ name, initials, colors, fonts, visualStyle }) {
//   // Create temporary canvas for measuring
//   const tempCanvas = createCanvas(800, 600);
//   const tempCtx = tempCanvas.getContext('2d');

//   const primaryColor = colors?.[0] || '#000000';
//   const secondaryColor = colors?.[1] || '#FFFFFF';

//   // Measure all elements
//   tempCtx.textAlign = 'center';
//   tempCtx.textBaseline = 'middle';

//   // Measure initials
//   tempCtx.font = `900 240px "${fonts?.[0] || 'sans-serif'}"`;
//   const initialsMetrics = tempCtx.measureText(initials);
//   const initialsWidth = initialsMetrics.width;
//   const initialsHeight = 240;

//   // Measure brand name
//   tempCtx.font = `bold 60px "${fonts?.[1] || fonts?.[0] || 'sans-serif'}"`;
//   const nameMetrics = tempCtx.measureText(name.toUpperCase());
//   const nameWidth = nameMetrics.width;
//   const nameHeight = 60;

//   // Calculate layout
//   const dividerGap = 40; // Gap between initials and divider
//   const nameGap = 50; // Gap between divider and name

//   // Total content height (from top of initials to bottom of name)
//   const contentHeight = initialsHeight + dividerGap + nameGap + nameHeight;

//   // Content width (widest element)
//   const dividerWidth = Math.max(initialsWidth, nameWidth) * 1.2;
//   const contentWidth = Math.max(initialsWidth, nameWidth, dividerWidth);

//   // Equal padding on all sides
//   const padding = 40;
//   const width = Math.ceil(contentWidth + padding * 2);
//   const height = Math.ceil(contentHeight + padding * 2);

//   // Create final canvas
//   const canvas = createCanvas(width, height);
//   const ctx = canvas.getContext('2d');

//   // Draw background
//   ctx.fillStyle = hexToRgba(secondaryColor, 0.5);
//   ctx.fillRect(0, 0, width, height);

//   ctx.textAlign = 'center';
//   ctx.textBaseline = 'middle';

//   // Calculate vertical positions (starting from padding)
//   let currentY = padding;

//   // Draw Initials
//   ctx.fillStyle = primaryColor;
//   ctx.font = `900 240px "${fonts?.[0] || 'sans-serif'}"`;
//   const initialsY = currentY + initialsHeight * 0.4; // Adjust for text baseline
//   ctx.fillText(initials, width / 2, initialsY);
//   currentY += initialsHeight + dividerGap;

//   // Draw Divider
//   ctx.strokeStyle = primaryColor;
//   ctx.lineWidth = 14;
//   const lineMargin = (width - dividerWidth) / 2;
//   ctx.beginPath();
//   ctx.moveTo(lineMargin, currentY);
//   ctx.lineTo(width - lineMargin, currentY);
//   ctx.stroke();
//   currentY += nameGap;

//   // Draw Brand Name
//   ctx.font = `bold 60px "${fonts?.[1] || fonts?.[0] || 'sans-serif'}"`;
//   const nameY = currentY + nameHeight * 0.35; // Adjust for text baseline
//   ctx.fillText(name.toUpperCase(), width / 2, nameY);

//   return canvas.toBuffer('image/png');
// }

// // Helper function to convert hex to rgba
// function hexToRgba(hex, alpha) {
//   const r = parseInt(hex.slice(1, 3), 16);
//   const g = parseInt(hex.slice(3, 5), 16);
//   const b = parseInt(hex.slice(5, 7), 16);
//   return `rgba(${r}, ${g}, ${b}, ${alpha})`;
// }

// export const createStaticLogo = async (analysis) => {
//   const brandName = analysis?.business_overview?.brand_name || "COMPANY";
//   const initials = brandName.split(/\s+/).map(n => n[0]).join('').toUpperCase();

//   return await generateLogoBuffer({
//     name: brandName,
//     initials: initials,
//     colors: analysis?.branding_guidelines?.brand_colors,
//     fonts: analysis?.branding_guidelines?.fonts,
//     visualStyle: analysis?.branding_guidelines?.visual_style
//   });
// };

// export const createStaticLogo = async (analysis) => {
//   const brandName = analysis?.business_overview?.brand_name;
//   const initials = brandName?.split(' ')?.map(n => n[0])?.join('')?.toUpperCase();

//   return await generateLogoBuffer({
//     name: brandName,
//     initials: initials,
//     colors: analysis?.branding_guidelines?.brand_colors, // ["#000000", "#FFFFFF"]
//     fonts: analysis?.branding_guidelines?.fonts,       // ["Madefor Display", "Times New Roman"]
//     visualStyle: analysis?.branding_guidelines?.visual_style
//   });
// };

export async function processBusinessBranding(userId) {
  let logoUrl = null;
  console.log("processBusinessBranding");

  const user = await userModel.findById(userId);
  const businessProfile = await BusinessSummaryProfile.findOne({
    userId,
    status: "COMPLETED",
    isActive: true,
  });

  logoUrl = businessProfile?.analysis?.branding_guidelines?.logo_url || null;

  if (user?.accountType === "business" && !logoUrl) {
    try {
      console.log(
        "Starting logo generation for:",
        businessProfile.analysis?.business_overview?.brand_name,
      );

      const checkLogoUrl = await BrandNewLogos.findOne({ userId }).lean();
      if (checkLogoUrl) {
        return checkLogoUrl.logoUrl;
      }
      const analysisSummary = businessProfile.analysis;

      // 1. Call your direct function and AWAIT the buffer
      const buffer = await createStaticLogo(analysisSummary);

      // 2. Convert Buffer to Base64 (Standard format for Data URLs)
      const base64 = buffer
        ? "data:image/png;base64," + buffer.toString("base64")
        : null;

      const base64Data = base64?.replace(/^data:image\/\w+;base64,/, "");

      // 3. Upload to S3 and await the final URL
      logoUrl = await uploadBase64ToS3(base64Data, config.AWS_S3_LOGO_FOLDER);
      await BrandNewLogos.create({ userId, logoUrl });
      console.log("Logo URL:", logoUrl);
      return logoUrl;
    } catch (error) {
      console.error("Critical error generating business logo:", error);
      return null;
    }
  }
  return logoUrl;
}

// processBusinessBranding();

// async function generateLogo(config) {
//   const { name, initials, colors, fonts } = config;
//   const canvas = createCanvas(1200, 600);
//   const ctx = canvas.getContext('2d');

//   // Background - Transparent
//   ctx.clearRect(0, 0, 1200, 600);

//   // 1. Draw Monogram (Large)
//   // We use the first font for the Monogram
//   ctx.fillStyle = colors[0] || '#000000';
//   ctx.font = `bold 180px "${fonts[0]}"`;
//   ctx.textAlign = 'center';
//   ctx.fillText(initials, 600, 250);

//   // 2. Draw Accent Line
//   ctx.strokeStyle = colors[0];
//   ctx.lineWidth = 5;
//   ctx.beginPath();
//   ctx.moveTo(400, 320);
//   ctx.lineTo(800, 320);
//   ctx.stroke();

//   // 3. Draw Full Name (Small)
//   // We use the second font for the wordmark
//   ctx.font = `40px "${fonts[1] || fonts[0]}"`;
//   ctx.fillText(name.toUpperCase(), 600, 400);

//   return canvas.toBuffer('image/png');
// }

// const generateStaticLogo = async (analysisSummary) => {
//   const name = analysisSummary.brand_name;
//   const colors = analysisSummary.branding_guidelines.brand_colors;
//   const fonts = analysisSummary.branding_guidelines.fonts; // ["Madefor Display", "Times New Roman"]

//   const initials = name.split(' ').map(w => w[0]).join('').toUpperCase();

//   return await generateLogo({
//     name,
//     initials,
//     colors,
//     fonts
//   });
// };

async function pollVeoOperation(
  operationName,
  token,
  modelId,
  logoUrl = null,
  chatId,
  messageId,
  contactLines = [],
  userId,
  isLongFormClip = false,
  isBusiness,
) {
  try {
    const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:fetchPredictOperation`;

    for (let attempt = 0; attempt < 60; attempt++) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operationName }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = await response.json();

      if (data.done) {
        if (data.error) throw new Error(data.error.message);

        const video = data.response?.videos?.[0];

        if (!video) {
          logger.error(
            `[Veo] Operation completed but returned no video. Full response: ${JSON.stringify(data)}`,
          );
          throw new Error("Veo completed but returned no video");
        }

        emit(chatId, "generation:progress", {
          messageId,
          percentage: 80,
          message: "Compositing logo on the video...",
        });

        // 1. Grab the raw Veo video
        let finalVideoBase64 = video.bytesBase64Encoded;

        // const user = await userModel.findById(userId);
        // const businessProfile = await BusinessSummaryProfile.findOne({ userId: userId });

        // if (user?.accountType === "business" && !logoUrl) {
        //   const analysisSummary = businessProfile.analysis
        //   const buffer = await createStaticLogo(analysisSummary);

        //   // 2. Convert Buffer to Base64 (Standard format for Data URLs)
        //   const base64 = buffer ? 'data:image/png;base64,' + buffer.toString('base64') : null;

        //   const base64Data = base64?.replace(/^data:image\/\w+;base64,/, '');

        //   // 3. Upload to S3 and await the final URL
        //   const BaseUrl = await uploadBase64ToS3(base64Data);
        //   console.log("BaseUrl", BaseUrl);
        //   logoUrl = BaseUrl;
        // }

        // 2. INTERCEPT: If a logoUrl was passed down, trigger FFmpeg post-processing
        // if (logoUrl) {
        if (!isLongFormClip && isBusiness) {
          try {
            console.log("Applying logo outro with FFmpeg...");

            // Convert Google's base64 string into a Buffer for FFmpeg
            const rawVideoBuffer = Buffer.from(finalVideoBase64, "base64");

            // Run the FFmpeg processor (extends to 10s and overlays logo)
            const processedVideoBuffer = await addLogoOutroToVideo(
              rawVideoBuffer,
              logoUrl,
              contactLines,
              userId,
            );

            // Convert the processed Buffer back to base64 for your S3 uploader
            finalVideoBase64 = processedVideoBuffer.toString("base64");

            emit(chatId, "generation:progress", {
              messageId,
              percentage: 90,
              message: "Uploading video...",
            });

            console.log("FFmpeg processing complete!");
          } catch (ffmpegErr) {
            console.error(
              "FFmpeg processing failed, falling back to original Veo video:",
              ffmpegErr,
            );
            // Graceful fallback: If FFmpeg crashes, it skips updating finalVideoBase64
            // so the user still gets the standard 8s Veo video instead of a failed job.
          }
        } else {
          logger.info(
            "Long-form clip detected, skipping FFmpeg logo overlay to preserve original video for clip processing.",
          );
        }
        // }

        // STACK THE STRIPPER HERE to ensure the overlay didn't add it back
        let finalCleanBase64 = finalVideoBase64;
        try {
          const finalCleanBuffer = await stripCrMetadata(
            finalVideoBase64,
            "video",
          );
          finalCleanBase64 = finalCleanBuffer.toString("base64");
        } catch (error) {
          console.error(
            "CR Metadata stripping failed, falling back to original Veo video:",
            error,
          );
        }

        // 3. Upload the final result (either FFmpeg-processed or original Veo fallback)
        const videoUrl = await uploadBase64VideoToS3(
          finalCleanBase64,
          config.AWS_S3_GENERATE_VEO_VIDEO_FOLDER,
        );

        return {
          success: true,
          videoUrl,
          mimeType: video.mimeType || "video/mp4",
        };
      }

      await new Promise((r) => setTimeout(r, 5000));
    }
  } catch (error) {
    console.error("Veo polling error:", error);
    throw error;
  }
}

/* -----------------------------
VIDEO GENERATION (LTX-V)
----------------------------- */
export async function generateVideoLTX(
  prompt,
  userId,
  attachmentPath = null, // LTX might not use this as a first frame yet
  params = {},
  chatId,
  messageId,
) {
  try {
    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling LTX API");
    }

    const apiKey = config.LTXV_API_KEY;
    if (!apiKey) {
      throw new Error("LTX API Key is missing in configuration");
    }

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 60,
      message: "Animating scene with LTX 2.3...",
    });

    const aspectRatio = params?.aspect || "16:9";
    const requestedDuration =
      parseInt(
        params?.duration?.toString().replace("s", "").replace(" sec", ""),
      ) || 8;
    const requestedRes = params?.quality || params?.resolution || "1080p";

    // Duration mapping
    let duration = requestedDuration;

    let ltxModel = "ltx-2-3-fast";
    duration = Math.min(Math.max(duration, 6), 20);

    // Resolution mapping
    const resolutionMap = {
      "1080p": { "16:9": "1920x1080", "9:16": "1080x1920" },
      "1440p": { "16:9": "2560x1440", "9:16": "1440x2560" },
      "4K": { "16:9": "3840x2160", "9:16": "2160x3840" },
    };

    const resObj = resolutionMap[requestedRes] || resolutionMap["1080p"];
    const resolution = resObj[aspectRatio] || resObj["16:9"];

    console.log(
      `LTX Config: Model=${ltxModel}, Res=${resolution}, Dur=${duration}s`,
    );

    const url = "https://api.ltx.video/v1/text-to-video";

    const payload = {
      prompt: prompt.trim().slice(0, 5000),
      model: ltxModel,
      duration: duration,
      resolution: resolution,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage =
        errorData.error?.message ||
        errorData.message ||
        "LTX generation failed";
      throw new Error(`LTX Error: ${errorMessage}`);
    }

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 80,
      message: "Processing video with LTX...",
    });

    const videoArrayBuffer = await response.arrayBuffer();
    let videoBuffer = Buffer.from(videoArrayBuffer);

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 85,
      message: "Compositing logo on the video...",
    });

    const logoUrl = params.logoUrl;
    const contactLines = params.contactLines || [];

    if (logoUrl) {
      try {
        console.log("Applying logo outro with FFmpeg (LTX)...");
        videoBuffer = await addLogoOutroToVideo(
          videoBuffer,
          logoUrl,
          contactLines,
          userId,
        );
        console.log("FFmpeg processing complete (LTX)!");
      } catch (ffmpegErr) {
        console.error(
          "FFmpeg processing failed for LTX fallback to original:",
          ffmpegErr,
        );
      }
    }

    emit(chatId, "generation:progress", {
      messageId,
      percentage: 95,
      message: "Uploading video...",
    });

    // STACK THE STRIPPER HERE to ensure the overlay didn't add it back
    const finalCleanBuffer = await stripCrMetadata(videoBuffer, "video");
    const finalCleanBase64 = finalCleanBuffer.toString("base64");

    const videoUrl = await uploadBase64VideoToS3(finalCleanBase64, "ltx-video");

    return {
      success: true,
      videoUrl,
      mimeType: "video/mp4",
    };
  } catch (error) {
    console.error("LTX video generation error:", error);
    throw error;
  }
}

/* -----------------------------
IMAGE GENERATION (IMAGEN)
----------------------------- */
// export async function generateImage(
//   prompt,
//   params = {},
//   userId = null,
//   attachmentPath = null,
// ) {
//   try {
//     if (!prompt?.trim()) {
//       throw new Error("Prompt is empty before calling Imagen API");
//     }

//     const token = await getAccessToken();

//     const requestedModel = params?.model || "imagen-4-fast";

//     const modelId =
//       IMAGE_MODEL_MAP[requestedModel] || "imagen-4.0-fast-generate-001";

//     const aspectRatio = params?.aspect || params?.ratio || "1:1";

//     console.log("Requested image model:", requestedModel);
//     console.log("Resolved image model:", modelId);
//     console.log("Aspect ratio:", aspectRatio);

//     const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:predict`;

//     const payload = {
//       instances: [{ prompt: prompt.trim() }],
//       parameters: {
//         sampleCount: 1,
//         aspectRatio,
//       },
//     };

//     const response = await fetch(url, {
//       method: "POST",
//       headers: {
//         Authorization: `Bearer ${token}`,
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify(payload),
//     });

//     if (!response.ok) {
//       throw new Error(await response.text());
//     }

//     const data = await response.json();

//     const prediction = data.predictions?.[0];

//     if (!prediction) {
//       throw new Error("Imagen returned empty prediction");
//     }

//     return {
//       success: true,
//       imageBase64: prediction.bytesBase64Encoded,
//       mimeType: prediction.mimeType || "image/png",
//     };
//   } catch (error) {
//     console.error("Imagen generation error:", error);
//     throw error;
//   }
// }

const NO_TEXT_SUFFIX = [
  "no text",
  "no words",
  "no letters",
  "no typography",
  "no captions",
  "no watermarks",
  "no labels",
  "no logos",
  "no UI elements",
  "no overlays",
  "no SPACIAL CHARACTERS",
  "no emojis",
  "no Unnecessary objects",
  "no Unnecessary Data",
  "no Unnecessary Information",
  "no Unnecessary Information",
].join(", ");

export async function generateImage(
  prompt,
  params = {},
  userId = null,
  attachmentPath = null,
) {
  try {
    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling Imagen API");
    }

    const token = await getAccessToken();

    const requestedModel = params?.model || "imagen-4-fast";

    const modelId = IMAGE_MODEL_MAP[requestedModel] || "gemini-2.5-flash-image";

    const aspectRatio = params?.aspect || params?.ratio || "1:1";

    console.log("Requested image model:", requestedModel);
    console.log("Resolved image model:", modelId);
    console.log("Aspect ratio:", aspectRatio);

    const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:predict`;

    const enrichedPrompt = `${prompt.trim()}. ${NO_TEXT_SUFFIX}`;

    const payload = {
      instances: [{ prompt: enrichedPrompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio,
        negativePrompt:
          "text, words, letters, typography, captions, watermarks, labels, logos, UI elements, overlays, subtitles, inscriptions",
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();
    const prediction = data.predictions?.[0];
    const usage = prediction?.usageMetadata || {};
    usage.model = modelId;

    if (!prediction) {
      throw new Error("Imagen returned empty prediction");
    }

    return {
      success: true,
      imageBase64: prediction.bytesBase64Encoded,
      mimeType: prediction.mimeType || "image/png",
      logoSkipped: true,
      usage,
    };
  } catch (error) {
    console.error("Imagen generation error:", error);
    throw error;
  }
}

//generate image prompt

// export const generateImagePrompt = async ({ scene, brandProfile }) => {
//   try {
//     // aconsole.log('scene and conetent', scene, brandProfile)
//     if (!scene) throw new Error("Scene is required")
//     const brandColors = brandProfile?.analysis?.branding_guidelines?.brand_colors
//       ?.map((c) => c)
//       ?.join(", ");

//     const brandStyle = brandProfile?.analysis?.branding_guidelines?.visual_style;

//     // ✅ USER PROMPT (ONLY INPUT DATA)
//     // ✅ REFINED USER PROMPT
//     const USER_PROMPT = `
// ACT AS AN IMAGE PROMPT ENGINEER.
// Generate a descriptive visual prompt based on the following:

// Scene Context: ${scene}
// Brand Visual Style: ${brandStyle}
// Primary Brand Palette: ${brandColors}

// ---
// CRITICAL NEGATIVE CONSTRAINTS:
// - DO NOT include any visible text, typography, or lettering.
// - DO NOT include brand logos or watermarks.
// - DO NOT include hex codes, color names as text, or technical labels.
// - The output should be a single paragraph describing the scene's lighting, composition, and atmosphere only.
// `;

//     const response = await axios.post(
//       "https://api.anthropic.com/v1/messages",
//       {
//         model: "claude-haiku-4-5-20251001",
//         max_tokens: 1000,
//         system: APPROVAL_SYSTEM_IMAGE_PROMPT,
//         messages: [
//           {
//             role: "user",
//             content: USER_PROMPT
//           }
//         ]
//       },
//       {
//         headers: {
//           "Content-Type": "application/json",
//           "x-api-key": process.env.ANTHROPIC_API_KEY,
//           "anthropic-version": "2023-06-01"
//         }
//       }
//     )

//     return response
//   } catch (error) {
//     console.error(
//       "Image Prompt Error:",
//       error?.response?.data || error.message
//     )

//     return {
//       success: false,
//       prompt: "",
//       error: error.message
//     }
//   }
// }

export const generatePrompt = async ({ scene, contentType, userId }) => {
  try {
    const brandProfile = await BusinessSummaryProfile.findOne({
      userId: userId,
      status: "COMPLETED",
      isActive: true,
    }).lean();
    let response;
    if (contentType === "image") {
      response = await generateImagePrompt({ scene, brandProfile });
    } else {
      const activeModelSetting = await AISetting.findOne({
        key: "activeVideoModel",
      });
      const activeVideoModel = activeModelSetting
        ? activeModelSetting.value
        : "veo";
      let systemPrompt = PROMPT_APPROVAL_SYSTEM_PROMPT;
      if (activeVideoModel === "ltx") {
        systemPrompt = PROMPT_APPROVAL_SYSTEM_PROMPT_LTX;
      }
      response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2000,
          temperature: 0.2,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    message:
                      "WHENEVER GENERATE ACCORDING TO USER STRICTLY SHOULD FOLLOW THE SYSTEM PROMPT AND USER INPUT ",
                    generation_type: generationType,
                    user_prompt: userPrompt,
                    business_context: analysisSummary || "",
                  }),
                },
              ],
            },
          ],
        },
        {
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          timeout: 60000,
        },
      );
    }
    const text = response.data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/gi, "")
      .trim();
    const parsed = JSON.parse(text);
    return parsed;
  } catch (error) {
    return error;
  }
};

export const generateImagePrompt = async ({ scene, brandProfile }) => {
  // console.log('scene and conetent', scene, brandProfile)
  try {
    if (!scene) throw new Error("Scene is required");
    const brandStyle =
      brandProfile?.analysis?.branding_guidelines?.visual_style;
    const brandLogo = brandProfile?.analysis?.branding_guidelines?.logo_url;
    const logoData = await getLogoColors(brandLogo);

    console.log("brand logo colors", logoData);

    // ✅ USER PROMPT (ONLY INPUT DATA)
    const USER_PROMPT = `
Business Summary:
${brandProfile?.analysisSummary || "Not provided"}

Business Context / Scene:
${scene}

Target Audience:
${brandProfile?.analysis?.target_market?.primary_customer_segments?.join(", ") || "Professional users"}

Tone:
${brandProfile?.tone || "Premium, minimal, modern advertising"}

Visual Style:
${brandStyle}

Core Offering:
${brandProfile?.analysis?.business_overview?.core_value_proposition || "Digital platform or service"}

Color Direction:
Base: ${logoData.strategy.base}
Avoid: ${logoData.strategy.avoid}
Accent: ${logoData.strategy.accent}

────────────────────────
CREATIVE INTENT
────────────────────────
Create a **premium advertisement-style visual** where:

- Visual storytelling dominates over text
- The business is instantly understood through imagery
- The composition feels high-end, clean, and intentional

────────────────────────
ATTACHMENT CONTEXT
────────────────────────

Attachment 1:
- Brand logo
- Should appear naturally as part of the composition

Attachment 2 (if present):
- Website or product UI
- Should appear inside realistic devices or digital surfaces
- Must feel like a real product in use

────────────────────────
VISUAL EXPECTATIONS
────────────────────────

- Show the product/service in action
- Include transformation or outcome
- Use motion, flow, or interaction
- Avoid static or generic visuals

────────────────────────
STYLE DIRECTION
────────────────────────

- Premium brand campaign look
- Cinematic lighting
- Strong focal subject
- Clean composition with depth
- Minimal clutter

────────────────────────
UNIQUENESS
────────────────────────

- Must feel specific to THIS business
- Include a distinctive visual concept or metaphor
- Avoid generic industry visuals

────────────────────────
FINAL GOAL
────────────────────────

A striking, modern, premium advertising visual that could be used in a real campaign and communicates the business clearly through imagery alone.

`;
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4000,
        system: APPROVAL_SYSTEM_IMAGE_PROMPT,
        messages: [
          {
            role: "user",
            content: USER_PROMPT,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    console.log("Image prompt response:", response.data.content);

    return response;
  } catch (error) {
    console.error(
      "Image Prompt Error:",
      error?.response?.data || error.message,
    );

    return {
      success: false,
      prompt: "",
      error: error.message,
    };
  }
};

const DEFAULT_RESULT = {
  colors: [
    {
      rgb: { r: 0, g: 0, b: 0 },
      hex: "#000000",
      type: "dark",
    },
  ],
  analysis: {
    isDark: true,
    isLight: false,
    contrast: "high",
  },
  strategy: {
    background: "#ffffff",
    text: "#000000",
  },
};

export async function getLogoColors(imageUrl, colorCount = 5) {
  try {
    // ✅ HANDLE EMPTY / INVALID URL
    if (!imageUrl || typeof imageUrl !== "string" || imageUrl.trim() === "") {
      return DEFAULT_RESULT;
    }

    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { data, info } = await sharp(buffer)
      .resize(100, 100, { fit: "inside" })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const colorMap = new Map();

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // skip near white noise
      if (r > 245 && g > 245 && b > 245) continue;

      const key = `${r},${g},${b}`;
      colorMap.set(key, (colorMap.get(key) || 0) + 1);
    }

    const dominantColors = [...colorMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, colorCount)
      .map(([color]) => {
        const [r, g, b] = color.split(",").map(Number);
        return {
          rgb: { r, g, b },
          hex: rgbToHex(r, g, b),
          type: getColorType(r, g, b),
        };
      });

    // ✅ ANALYSIS
    const analysis = analyzePalette(dominantColors);

    // ✅ STRATEGY
    const strategy = getBackgroundStrategy(analysis);

    return {
      colors: dominantColors,
      analysis,
      strategy,
    };
  } catch (error) {
    console.error("getLogoColors error:", error.message);

    // ✅ FALLBACK ON ERROR TOO
    return DEFAULT_RESULT;
  }
}

// 🔧 HELPERS

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function getColorType(r, g, b) {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  if (r > 200 && g < 80 && b < 80) return "red";
  if (b > 200 && r < 100) return "blue";
  if (g > 200 && r < 100) return "green";
  if (r > 200 && g > 200 && b < 100) return "yellow";

  if (brightness < 60) return "dark";
  if (brightness > 200) return "light";

  return "neutral";
}

function analyzePalette(colors) {
  const types = colors.map((c) => c.type);

  return {
    hasBlue: types.includes("blue"),
    hasRed: types.includes("red"),
    hasDark: types.includes("dark"),
    hasLight: types.includes("light"),
    dominant: types[0],
  };
}

function getBackgroundStrategy(analysis) {
  if (analysis.hasBlue) {
    return {
      avoid: "blue, indigo, cyan backgrounds",
      base: "neutral grays, charcoal, off-white, warm beige",
      accent: "blue as subtle highlights and reflections only",
    };
  }

  if (analysis.hasRed) {
    return {
      avoid: "red or orange backgrounds",
      base: "cool gray, charcoal, soft white",
      accent: "red as minimal accents only",
    };
  }

  if (analysis.hasDark) {
    return {
      avoid: "dark backgrounds matching logo",
      base: "light gray, off-white, soft neutral tones",
      accent: "dark tones for depth only",
    };
  }

  return {
    avoid: "none",
    base: "balanced neutral tones",
    accent: "subtle color usage",
  };
}

// deterministic image overlay generation for drag-and-drop WYSIWYG
export const generateDeterministicHTML = ({
  imageUrl,
  width,
  height,
  data,
}) => {
  const {
    headline,
    subtext,
    cta,
    placement,
    headlineStyles,
    subtextStyles,
    ctaStyles,
    overlayStyles,
  } = data;

  // Fallbacks if styles aren't fully defined yet
  const hStyles = headlineStyles || {
    font: "Inter",
    size: 48,
    color: "#ffffff",
  };
  const sStyles = subtextStyles || {
    font: "Inter",
    size: 24,
    color: "#e5e7eb",
  };
  const cStyles = ctaStyles || {
    font: "Inter",
    size: 20,
    color: "#000000",
    bgColor: "#ffffff",
    fullWidth: false,
  };
  const oStyles = overlayStyles || { bgColor: "transparent", padding: 16 };

  const isPortrait = height > width;
  const isSquare = Math.abs(width - height) < 100;

  let maxWidth = "44%";
  if (isPortrait) maxWidth = "92%";
  else if (isSquare) maxWidth = "48%";

  // Scale factor: frontend preview is bounded by a roughly 350px container
  const scaleFactor = Math.max(width, height) / 350;

  const headlineSize = hStyles.size * scaleFactor * 0.4;
  const subtextSize = sStyles.size * scaleFactor * 0.4;
  const ctaSize = cStyles.size * scaleFactor * 0.4;

  const fonts = new Set([hStyles.font, sStyles.font, cStyles.font]);
  const familyQuery = Array.from(fonts)
    .map((f) => `family=${f.replace(/ /g, "+")}:wght@400;700;800`)
    .join("&");

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        @import url('https://fonts.googleapis.com/css2?${familyQuery}&display=swap');
        * { box-sizing: border-box; }
        body { 
          margin: 0; 
          padding: 0; 
          width: ${width}px; 
          height: ${height}px; 
          position: relative; 
          overflow: hidden; 
        }
        .bg-image { 
          position: absolute; 
          top: 0; 
          left: 0; 
          width: 100%; 
          height: 100%; 
          object-fit: cover; 
          z-index: 1; 
        }
        .overlay-container {
          position: absolute;
          z-index: 10;
          left: ${placement.x}%;
          top: ${placement.y}%;
          transform: translate(-50%, -50%);
          max-width: ${maxWidth};
          width: ${maxWidth};
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          background-color: ${oStyles.bgColor};
          padding: ${Math.round(oStyles.padding * scaleFactor)}px;
          border-radius: ${Math.round(8 * scaleFactor)}px;
        }
        .headline {
          font-family: '${hStyles.font}', sans-serif;
          font-size: ${headlineSize}px;
          color: ${hStyles.color};
          font-weight: ${hStyles.isBold !== false ? "800" : "400"};
          line-height: 1.1;
          margin-bottom: ${Math.round(4 * scaleFactor)}px;
          word-break: break-word;
          width: 100%;
        }
        .subtext {
          font-family: '${sStyles.font}', sans-serif;
          font-size: ${subtextSize}px;
          color: ${sStyles.color};
          font-weight: ${sStyles.isBold ? "700" : "400"};
          opacity: 0.9;
          word-break: break-word;
          width: 100%;
        }
        .cta {
          font-family: '${cStyles.font}', sans-serif;
          margin-top: ${Math.round(16 * scaleFactor)}px;
          background-color: ${cStyles.bgColor};
          color: ${cStyles.color};
          padding: ${Math.round(8 * scaleFactor)}px ${Math.round(24 * scaleFactor)}px;
          border-radius: 999px;
          font-size: ${ctaSize}px;
          font-weight: ${cStyles.isBold !== false ? "700" : "400"};
          box-shadow: 0px ${Math.round(4 * scaleFactor)}px ${Math.round(16 * scaleFactor)}px rgba(0,0,0,0.3);
          width: ${cStyles.fullWidth ? "100%" : "auto"};
          text-align: center;
        }
      </style>
    </head>
    <body>
      <img src="${imageUrl}" class="bg-image" />
      <div class="overlay-container">
        ${headline ? `<div class="headline">${headline}</div>` : ""}
        ${subtext ? `<div class="subtext">${subtext}</div>` : ""}
        ${cta ? `<div class="cta">${cta}</div>` : ""}
      </div>
    </body>
    </html>
  `;

  return { html };
};

// image overlay generation

export const generateOvelay = async ({
  scene,
  userPrompt,
  brandProfile,
  backgroundImage,
  data,
}) => {
  const bgDiamenetion = await getImageSizeFromUrl(backgroundImage);

  let layoutResult;

  // If we have precise drag-and-drop coordinates, bypass the LLM and render exactly what the user saw
  if (
    data &&
    data.placement &&
    typeof data.placement === "object" &&
    data.placement.x !== undefined
  ) {
    layoutResult = generateDeterministicHTML({
      imageUrl: backgroundImage,
      width: bgDiamenetion.width,
      height: bgDiamenetion.height,
      data,
    });
  } else {
    // Fallback to the LLM-based layout generation for legacy or non-positioned requests
    layoutResult = await generateAdHTML({
      scene,
      imageUrl: backgroundImage,
      logoUrl: brandProfile?.company?.logo,
      userInput: userPrompt,
      brandProfile,
      width: bgDiamenetion.width,
      height: bgDiamenetion.height,
      data,
    });
  }
  const finalBuffer = await htmlToImageBuffer({
    html: cleanHTML(layoutResult.html),
    width: bgDiamenetion.width,
    height: bgDiamenetion.height,
  });
  return finalBuffer;
};

export async function getImageSizeFromUrl(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
  });

  const buffer = Buffer.from(response.data);

  const metadata = await sharp(buffer).metadata();

  return {
    width: metadata.width,
    height: metadata.height,
  };
}

// export const generateAdHTML = async ({
//   imageUrl,
//   logoUrl,
//   scene, userInput,
//   brandProfile, width, height
// }) => {
//   try {
//     if (!imageUrl) throw new Error("Image is required");

//     const SYSTEM_PROMPT = `You are an expert advertising designer, visual intelligence analyst, and front-end developer.

// Your task is to deep analyze a background image and generate a production-ready HTML advertisement using inline CSS.

// This will be rendered as a static image (NOT a webpage).

// ----------------------------------------
// STRICT RULES

// - No animations
// - No transitions
// - No hover effects
// - No JavaScript
// - Inline CSS only
// - Output ONLY raw HTML (no markdown, no comments)

// ----------------------------------------
// STEP 1: DEEP IMAGE ANALYSIS (MANDATORY)

// 1. DENSITY DETECTION
//    - Identify:
//      → High-density areas (subjects, objects, textures, bright/noisy regions)
//      → Low-density areas (empty, blurred, gradient, sky, clean surfaces)

// 2. SAFE ZONE IDENTIFICATION
//    - Find the largest uninterrupted clean area
//    - This is the ONLY valid content placement zone

// 3. SAFE ZONE SIZE ESTIMATION (IMPORTANT)
//    - SMALL → fits only headline + 1 line
//    - MEDIUM → headline + supporting text + CTA
//    - LARGE → full layout (headline + subtext + points + CTA)

// 4. POSITION DECISION
//    - LEFT / RIGHT / CENTER based on safe zone
//    - NEVER default blindly

// 5. NEVER:
//    - Overlap subjects or focal elements
//    - Place text in noisy areas

// ----------------------------------------
// STEP 2: BACKGROUND-AWARE STYLING

// Analyze SAFE ZONE background:

// - DARK background:
//   → Light text (white/off-white)
// - LIGHT background:
//   → Dark text (black/dark gray)
// - MIXED / LOW CONTRAST:
//   → Add soft gradient overlay behind content

// Ensure maximum readability at all times.

// ----------------------------------------
// STEP 3: ADAPTIVE CONTENT GENERATION (KEY FEATURE)

// Generate content based on:
// - Scene
// - Brand summary
// - Brand style

// Then SCALE content based on available space:

// ----------------------------------------
// IF SAFE ZONE = SMALL:
// - Headline (3–5 words)
// - Optional short line (max 6 words)
// - NO clutter

// ----------------------------------------
// IF SAFE ZONE = MEDIUM:
// - Headline
// - Supporting line (max 10 words)
// - Optional CTA (2–3 words)

// ----------------------------------------
// IF SAFE ZONE = LARGE (PREMIUM MODE):
// Create a premium structured layout:

// - Headline (strong, bold)
// - Supporting sentence
// - 2–3 short feature points OR value highlights
// - CTA (only if meaningful)

// POINT STYLE:
// - Very short (2–4 words each)
// - Clean and scannable
// - No long sentences

// ----------------------------------------
// CONTENT STYLE RULES

// - Must feel natural to the scene
// - Must reflect brand tone
// - Avoid generic phrases
// - Keep it clean, premium, and intentional

// ----------------------------------------
// STEP 4: LAYOUT PRECISION

// - Container must EXACTLY match given size
// - Use absolute positioning ONLY

// CONTENT BLOCK RULES:
// - Stay fully inside safe zone
// - Maintain padding (minimum 40px)
// - Do not stretch into noisy areas

// HIERARCHY:
// - Headline → largest
// - Supporting → medium
// - Points → smaller
// - CTA → clear but subtle

// SPACING:
// - Use consistent vertical rhythm
// - Avoid clutter even in large layouts

// ----------------------------------------
// STEP 5: CTA RULE

// - Include ONLY if it improves the ad
// - Keep it subtle and premium
// - Button style (static, no effects)

// ----------------------------------------
// STEP 6: LOGO HANDLING (IMPORTANT) The logo must always be clearly visible and visually balanced.
// 1. LOGO SIZE: - Logo must occupy ~8% to 15% of total image width - Never too large (dominates layout) - Never too small (hard to recognize)
// 2. LOGO PLACEMENT: - Default: top-right corner with padding (24px–48px) - Must not overlap important background subjects
// 3. BACKGROUND CONTRAST HANDLING: Analyze the area behind the logo: - If background is DARK or busy: → Add a LIGHT (white) semi-transparent overlay behind logo → Example: rgba(255,255,255,0.6–0.85) - If background is LIGHT or bright: → Add a DARK semi-transparent overlay → Example: rgba(0,0,0,0.4–0.7) - If background is clean and already high contrast: → Do NOT add overlay
// 4. OVERLAY STYLE: - Soft rounded rectangle or subtle blur-style box - Padding inside overlay: 8px–16px - Border-radius: 8px–16px
// 5. LOGO IMAGE RULES: - Use object-fit: contain - Do NOT distort aspect ratio - Keep transparent background intact
// 6. NEVER: - Place logo directly on noisy or low-contrast background - Stretch or crop the logo

// ----------------------------------------
// STEP 7: IMAGE USAGE

// - Use EXACT provided URLs
// - Do NOT modify

// ----------------------------------------
// FINAL OUTPUT RULE

// Return ONLY raw HTML.

// - No markdown
// - No explanations
// - No comments
// - No \n characters

// ----------------------------------------
// FINAL GOAL

// Create a premium, visually balanced ad where:

// - Content is placed ONLY in the safest empty space
// - Layout adapts to available space intelligently
// - More space → more structured premium content
// - Less space → minimal clean message
// - Design always feels intentional, never crowded`;

//     const USER_PROMPT = `Background image URL:${imageUrl}
// Logo URL:${logoUrl}
// Ad size: ${width}x${height} px
// Scene description:${scene}
// What this ad should say or promote:${userInput}
// Business Summary:${brandProfile?.aiInsights?.summary}
// Brand Name:${brandProfile?.company?.name || ""}
// Brand Style:${brandProfile?.visualIdentity?.designStyle || ""}

// Brand Colors:
// ${Object.entries(brandProfile?.visualIdentity?.colors || {}).map(entry => entry[0] + '-' + entry[1]).join(', ')}

// IMPORTANT NOTES
// - Analyze the image carefully before placing content
// - Place content ONLY in the clean/safe area
// - Maintain strong visual balance
// - Keep the design premium and minimal
// - CTA should be included ONLY if relevant to the scene
// - Use brand colors for text ONLY when it improves readability and fits naturally with the background
// `;

//     console.log('colors codes', Object.entries(brandProfile?.visualIdentity?.colors || {}).map(entry => entry[0] + '-' + entry[1]).join(', '))

//     const response = await axios.post(
//       "https://api.anthropic.com/v1/messages",
//       {
//         model: "claude-haiku-4-5-20251001",
//         max_tokens: 2000,
//         system: SYSTEM_PROMPT,
//         messages: [
//           {
//             role: "user",
//             content: [
//               {
//                 type: "image",
//                 source: {
//                   type: "url",
//                   url: imageUrl
//                 }
//               },
//               {
//                 type: "text",
//                 text: USER_PROMPT
//               }
//             ]
//           }
//         ]
//       },
//       {
//         headers: {
//           "Content-Type": "application/json",
//           "x-api-key": process.env.ANTHROPIC_API_KEY,
//           "anthropic-version": "2023-06-01"
//         }
//       }
//     );

//     const html =
//       response?.data?.content?.[0]?.text?.trim() || "";

//     return {
//       success: true,
//       html
//     };

//   } catch (error) {
//     console.error("generateAdHTML error:", error?.response?.data || error.message);

//     return {
//       success: false,
//       html: "",
//       error: error.message
//     };
//   }
// };

export const generateAdHTML = async ({
  imageUrl,
  logoUrl,
  scene,
  userInput,
  brandProfile,
  width,
  height,
  data,
}) => {
  try {
    if (!imageUrl) throw new Error("Image is required");

    // ── Canvas intelligence passed into the prompt ──────────────
    const isPortrait = height > width;
    const isSquare = Math.abs(width - height) < 100;
    const isLandscape = width > height;
    const orientation = isPortrait
      ? "PORTRAIT"
      : isSquare
        ? "SQUARE"
        : "LANDSCAPE";

    // Safe text block width — leaves breathing room on every canvas shape
    const textBlockWidth = isPortrait
      ? Math.round(width * 0.92) // portrait: near-full width, text stacks vertically
      : isSquare
        ? Math.round(width * 0.48)
        : Math.round(width * 0.44); // landscape: half canvas max

    const textBlockLeft = isPortrait
      ? Math.round(width * 0.08) // centered-ish for portrait
      : 0; // exact left/right decided by focal point logic

    // Logo safe size: never more than 15% of shorter dimension
    const logoWidth = Math.round(Math.min(width, height) * 0.15);

    const SYSTEM_PROMPT = `You are a senior advertising art director at a world-class agency.

Your job is NOT to generate HTML mechanically.
Your job is to DESIGN a premium, minimal, high-conversion advertisement based on the image.

The output will be rasterized into a static image.

----------------------------------------
STRICT OUTPUT RULES

- Output ONLY raw HTML starting with <!DOCTYPE html>
- No markdown, no comments, no explanation
- Inline CSS only
- Use ONLY <h1> and <h2> for text
- No <p>, <span> for text blocks

----------------------------------------
CANVAS

Width: ${width}px
Height: ${height}px

----------------------------------------
STEP 1 — IMAGE ANALYSIS (DO NOT OUTPUT)

1. Detect:
- Safe zone (empty / low-noise area)
- Focal subject (person / product)
- Visual density (clean / medium / busy)
- Safe zone SIZE (small / medium / large)
- Safe zone luminance (dark / light / mixed)

----------------------------------------
STEP 2 — LAYOUT DECISION ENGINE (CRITICAL)

You MUST evaluate the image and content before choosing a layout.

DO NOT default to any layout.
DO NOT prefer any layout by default.
DO NOT repeat the same layout pattern every time.

----------------------------------------
EVALUATION FACTORS:

1. SAFE ZONE SIZE
- SMALL → limited space
- MEDIUM → moderate space
- LARGE → open space

2. IMAGE COMPLEXITY
- CLEAN (minimal background)
- MEDIUM
- BUSY (high detail / clutter)

3. CONTENT LENGTH
- SHORT (1 phrase)
- MEDIUM (headline + support)
- LONG (multiple ideas)

----------------------------------------
LAYOUT MODES:

1. HERO_MINIMAL
- Only headline
- No supporting text

2. BOLD_STATEMENT
- 1–2 line impactful headline
- Strong visual emphasis

3. SPLIT_FOCUS
- Headline + 1 short supporting line
- Balanced layout

4. EDITORIAL
- Multi-line headline
- One soft supporting sentence
- Elegant spacing

5. STRUCTURED (RARE)
- Used ONLY if content requires listing
- Max 2 bullet points
- Clean and minimal

----------------------------------------
LAYOUT SELECTION LOGIC:

- IF safe zone is SMALL OR content is SHORT:
  → choose HERO_MINIMAL or BOLD_STATEMENT

- IF safe zone is MEDIUM AND content is MEDIUM:
  → choose SPLIT_FOCUS

- IF image is CLEAN and brand tone is premium:
  → choose EDITORIAL

- IF content requires multiple features AND space is LARGE:
  → choose STRUCTURED

----------------------------------------
VARIATION RULE (VERY IMPORTANT)

- Avoid repeating the same layout across outputs
- If multiple layouts are valid → choose a different one than typical/default
- Ensure outputs feel visually different

----------------------------------------
SIMPLICITY RULE

- If multiple layouts are valid → choose the one that feels most balanced
- BUT do NOT always choose the simplest layout

----------------------------------------
STEP 3 — CONTENT OPTIMIZATION

Rewrite the input content:

- Headline: 3–6 words (strong, clear)
- Supporting text: minimal and sharp
- Remove filler words
- Reduce clutter aggressively

RULE:
Less content = more premium

----------------------------------------
SCENE-AWARE CONTENT GENERATION (CRITICAL)

The ad content MUST be derived from the visual scene.

- Analyze what is happening in the image
- Identify:
  → environment (factory, office, retail, kitchen, etc.)
  → activity (automation, delivery, interaction, etc.)
  → objects (machines, food, people, devices)

----------------------------------------
CONTENT ALIGNMENT RULE:

- The headline MUST reflect what is visually happening
- Avoid generic marketing phrases

GOOD EXAMPLES:
- Conveyor + food → "Fresh Delivered Faster"
- Robots + automation → "Built for Speed"
- Phone + app usage → "Control at Your Fingertips"

BAD EXAMPLES:
- "Transform Your Business"
- "Next Generation Solutions"
- "Empowering Innovation"

----------------------------------------
BUSINESS INTEGRATION:

- Blend scene + business value

Example:
Scene: automated food line  
Business: delivery app  

→ "Groceries in Minutes"
→ "Speed Meets Freshness"

----------------------------------------
USER INPUT USAGE:

- Use userInput ONLY if it fits naturally with the scene
- If userInput feels generic → rewrite it to match scene

----------------------------------------
PRIORITY ORDER:

1. Scene relevance (MOST IMPORTANT)
2. Clarity
3. Brand tone
4. User input

----------------------------------------
FINAL RULE:

- The ad should feel like it was designed specifically for THIS image
- Not reusable for another random image

----------------------------------------
STEP 4 — ADAPTIVE TYPOGRAPHY

Calculate text density mentally:

IF content is LONG:
- h1: 48–64px
- h2: 24–34px

IF MEDIUM:
- h1: 60–72px
- h2: 28–40px

IF SHORT:
- h1: 72–96px
- h2: 32–48px

RULES:
- NEVER force large font if space is tight
- NEVER overflow container
- Allow natural line breaks
- DO NOT force single-line headlines

----------------------------------------
STEP 5 — TEXT COLOR

Based ONLY on safe zone luminance:

DARK:
- h1: #FFFFFF
- h2: rgba(255,255,255,0.85)

LIGHT:
- h1: #0D1B2A
- h2: rgba(13,27,42,0.75)

MIXED:
- choose best contrast
- use text-shadow only (no backdrop)

----------------------------------------
STEP 6 — TEXT PLACEMENT

CRITICAL OVERRIDE:
If the user input explicitly requests a specific "placement" (e.g., "bottom-right", "top-left", "center"), you MUST place the text block exactly in that requested position. This requested placement overrides all automatic placement logic.

If no specific placement is requested, determine it automatically:

NEVER overlap:
- face
- product
- hands

Placement:

LANDSCAPE:
- Subject right → text left
- Subject left → text right

PORTRAIT:
- Place text in empty vertical zone (top or bottom)
- DO NOT center blindly

Spacing:
- Minimum 64px padding from edges
- Maintain breathing space

----------------------------------------
STEP 7 — TEXT BLOCK WIDTH

CRITICAL:

- Portrait: 70–75% width
- Landscape: 35–40%
- Square: ~40%

Never exceed safe readable width.

----------------------------------------
STEP 8 — SPACING (PREMIUM RULE)

- Prioritize EMPTY SPACE
- If crowded → REMOVE elements
- Never shrink spacing to fit content

----------------------------------------
STEP 9 — BULLET RULE (IMPORTANT)

- Do NOT use bullets by default
- Only use if layout = STRUCTURED
- Max 2 bullets
- Clean, minimal

----------------------------------------
STEP 10 — CTA RULE

- Optional
- Only if space allows
- Keep minimal
- Never force CTA

----------------------------------------
STEP 11 — LOGO

- Place opposite of text block
- Wrap in white container:
  background:#FFF;
  border-radius:10px;
  padding:4px;
- Size: 12–15% of canvas

----------------------------------------
STEP 12 — TEXT SHADOW

Always apply:

Dark BG:
text-shadow: 0 2px 16px rgba(0,0,0,0.5);

Light BG:
text-shadow: 0 2px 12px rgba(255,255,255,0.6);

----------------------------------------
FINAL DESIGN PHILOSOPHY

- Think like a designer, not a template engine
- Remove elements if they hurt clarity
- Prefer bold simplicity over crowded completeness
- Every output should feel different

----------------------------------------
FINAL OUTPUT

Return ONLY raw HTML starting with <!DOCTYPE html>`;

    //     const USER_PROMPT = `
    // BACKGROUND IMAGE:
    // ${imageUrl}

    // LOGO:
    // ${logoUrl}

    // CANVAS:
    // - Size: ${width}x${height}px
    // - Orientation: ${orientation}
    // - Recommended max text width: ${textBlockWidth}px

    // SCENE CONTEXT:
    // ${scene}

    // AD MESSAGE (RAW INPUT — must be optimized):
    // ${userInput}

    // BRAND INFORMATION:
    // - Name: ${brandProfile?.analysis?.business_overview?.brand_name || ""}
    // - Summary: ${brandProfile?.analysisSummary || ""}
    // - Style: ${brandProfile?.analysis?.branding_guidelines?.visual_style || ""}

    // BRAND COLORS:
    // (Use ONLY for accents like CTA, divider, or subtle elements — NEVER for headline/body text)
    // ${Object.entries(brandProfile?.analysis?.branding_guidelines?.brand_colors|| {})
    //   .map(([k, v]) => `${k}: ${v}`)
    //   .join(", ")}

    // ----------------------------------------
    // CRITICAL DESIGN INSTRUCTIONS

    // 1. CONTENT SIMPLIFICATION
    // - Rewrite the message into a clean ad
    // - Reduce text aggressively if needed
    // - Do NOT try to include everything
    // - Fewer words = better design

    // 2. FLEXIBLE STRUCTURE
    // - You are NOT required to include:
    //   - bullets
    //   - divider
    //   - CTA
    // - Choose layout based on image and space
    // - Avoid repeating the same structure

    // 3. HEADLINE RULES
    // - 3–6 words preferred
    // - Can be 1 or 2 lines
    // - DO NOT force single-line
    // - Break naturally for readability
    // - If long → reduce font size

    // 4. SUPPORTING TEXT
    // - Optional
    // - Max 1–2 short lines OR 1–2 bullets (only if necessary)
    // - Skip completely if design looks cleaner

    // 5. SPACING PRIORITY
    // - Maintain generous empty space
    // - If layout feels crowded → REMOVE elements (not shrink spacing)

    // 6. TEXT FIT RULE
    // - ALL text must stay within ${textBlockWidth}px
    // - Use word-wrap: break-word
    // - Use overflow-wrap: break-word
    // - Never overflow container

    // 7. VISUAL HIERARCHY
    // - Headline is dominant
    // - Supporting text is subtle
    // - Avoid visual clutter

    // 8. LOGO RULE
    // - Must not overlap text
    // - Maintain clear spacing
    // - Place opposite to text block

    // 9. COLOR RULE
    // - Headline/body color ONLY from image luminance
    // - Brand colors ONLY for accents (CTA, small elements)
    // - Never use brand color for main text

    // 10. DESIGN FREEDOM
    // - You are allowed to:
    //   - remove elements
    //   - simplify structure
    //   - adjust typography
    // - Focus on making the ad look premium, not complete

    // ----------------------------------------
    // FINAL CHECK BEFORE OUTPUT

    // - Layout is clean and not crowded
    // - Text fits within ${textBlockWidth}px
    // - No overlapping with subject
    // - No unnecessary elements
    // - Design feels premium and intentional
    // - Output is ONLY raw HTML (no markdown, no explanation)
    // `;

    let requestedPlacementInstruction = "";
    if (data) {
      let cssRules = "";

      // Background and Color overrides
      cssRules +=
        "background: transparent !important; background-color: transparent !important; ";
      if (data.textColor) cssRules += `color: ${data.textColor} !important; `;

      // Font size scale logic (frontend sends relative size, backend scales if needed)
      // Usually frontend font size is in px but relative to a small preview.
      // We'll trust the LLM to apply the font size ratio, but we can enforce it.
      if (data.fontSize) {
        cssRules += `font-size: ${data.fontSize}px !important; `;
      }

      if (data.placement) {
        const p = data.placement;
        if (typeof p === "object" && p !== null) {
          if (p.x !== undefined && p.y !== undefined) {
            cssRules += `top: ${p.y}%; left: ${p.x}%; transform: translate(-50%, -50%); `;
          }
        } else if (typeof p === "string") {
          if (p === "center") {
            cssRules +=
              "top: 50%; left: 50%; transform: translate(-50%, -50%); ";
          } else if (p === "top-center") {
            cssRules += "top: 40px; left: 50%; transform: translateX(-50%); ";
          } else if (p === "bottom-center") {
            cssRules +=
              "bottom: 40px; left: 50%; transform: translateX(-50%); ";
          } else if (p === "middle-left") {
            cssRules += "top: 50%; left: 40px; transform: translateY(-50%); ";
          } else if (p === "middle-right") {
            cssRules += "top: 50%; right: 40px; transform: translateY(-50%); ";
          } else {
            if (p.includes("top")) cssRules += "top: 40px; ";
            if (p.includes("bottom")) cssRules += "bottom: 40px; ";
            if (p.includes("left")) cssRules += "left: 40px; ";
            if (p.includes("right")) cssRules += "right: 40px; ";
          }
        }
      }

      if (cssRules) {
        requestedPlacementInstruction = `\nCRITICAL CSS OVERRIDE:\nThe user has explicitly requested custom styling and position.\nYou MUST apply the following exact CSS properties to the main absolute positioned container:\n${cssRules}\nDO NOT auto-calculate the position. You MUST use these exact CSS properties!\n`;
      }
    }

    const USER_PROMPT = `
BACKGROUND IMAGE:
${imageUrl}

LOGO:
${logoUrl}

CANVAS:
- Size: ${width}x${height}px
- Orientation: ${orientation}
- Recommended max text width: ${textBlockWidth}px

SCENE CONTEXT:
${scene}

AD MESSAGE (RAW INPUT — must be optimized):
${data ? JSON.stringify(data) : userInput}
${requestedPlacementInstruction}
BRAND INFORMATION:
- Name: ${brandProfile?.company?.name || ""}
- Summary: ${brandProfile?.aiInsights?.summary || ""}
- Style: ${brandProfile?.visualIdentity?.designStyle || ""}

BRAND COLORS:
(Use ONLY for accents like CTA or subtle UI elements — NEVER for headline/body text)
${Object.entries(brandProfile?.visualIdentity?.colors || {})
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")}

----------------------------------------
CRITICAL DESIGN INSTRUCTIONS

1. CONTENT GENERATION
- Generate ad copy based on:
  → scene
  → business summary
  → user input (if relevant)
- Rewrite into clean, minimal marketing language
- Reduce content aggressively
- Do NOT copy raw input blindly

2. CONTENT LIMIT
- Prefer:
  → headline only
  OR
  → headline + 1 supporting line
- Maximum:
  → 2 text layers
- Avoid unnecessary elements

3. FLEXIBLE LAYOUT
- Do NOT follow fixed structure
- Do NOT always include:
  → CTA
- Choose layout based on image and space
- Each output should feel different

4. HEADLINE RULES
- 3–6 words preferred
- Can break into 1–2 lines naturally
- NEVER force single-line
- Avoid awkward line breaks
- Each line must feel intentional

5. WORD BREAKING RULE (CRITICAL)

- NEVER break words in the middle
- Words must stay intact

DO NOT USE:
- word-break: break-word
- overflow-wrap: break-word

USE:
- word-break: normal
- overflow-wrap: normal

IF text does not fit:
→ reduce font size
→ or move entire word to next line

6. FONT SCALING (VERY IMPORTANT)

- If headline exceeds width:
  → reduce font-size dynamically until it fits

Priority:
1. Keep words intact
2. Maintain readability
3. Then adjust size

- NEVER distort or break words to fit

7. TYPOGRAPHY

- Use ONLY ONE font family
- Prefer:
  'Helvetica Neue', Helvetica, Arial, sans-serif

- No serif + sans mixing

8. TEXT FIT RULE

- ALL text must stay within ${textBlockWidth}px
- No overflow outside container
- Use:
  word-break: normal;
  overflow-wrap: normal;

9. TEXT BLOCK WIDTH

- Keep width balanced:
  → ~35–40% of canvas
- Avoid overly wide blocks

10. SPACING PRIORITY

- Maintain generous empty space
- If layout feels crowded → REMOVE content
- Never compress spacing

11. OVERLAY USAGE (SMART)

- DO NOT add overlay by default

ONLY add overlay IF:
- background is too busy
- text readability is poor

Overlay must be:
- subtle
- minimal
- only behind text (not full canvas)

12. LOGO PLACEMENT (STRICT)

- ALWAYS place logo:
  → top-right corner

- Margin:
  → top: 32px–48px
  → right: 32px–48px

- NEVER:
  → add background behind logo
  → add border or container
  → overlap with text

13. VISUAL BALANCE

- Prefer:
  → text on left
  → logo top-right

- Avoid clutter in same area

14. COLOR RULE

- Headline/body color ONLY from image luminance
- Brand colors ONLY for accents
- Never use brand colors for main text

15. DESIGN FREEDOM

- You are allowed to:
  → remove elements
  → simplify layout
  → reduce content
  → adjust typography

- Focus on:
  → premium feel
  → clarity
  → balance

----------------------------------------
FINAL CHECK BEFORE OUTPUT

- No broken words
- No text overflow
- Text fits within ${textBlockWidth}px
- Layout is clean and not crowded
- Logo is top-right with margin
- No background behind logo
- Overlay used ONLY if needed
- No unnecessary elements
- Design feels premium

OUTPUT:
Return ONLY raw HTML (no markdown, no explanation)
`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: imageUrl },
              },
              {
                type: "text",
                text: USER_PROMPT,
              },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let html = response?.data?.content?.[0]?.text?.trim() || "";

    // Strip any accidental markdown fences
    html = html
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    // Validate the output is actual HTML before returning
    if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
      console.error(
        "generateAdHTML: unexpected model output →",
        html.slice(0, 300),
      );
      throw new Error("Invalid HTML input");
    }

    return {
      success: true,
      html,
    };
  } catch (error) {
    console.error(
      "generateAdHTML error:",
      error?.response?.data || error.message,
    );
    return {
      success: false,
      html: "",
      error: error.message,
    };
  }
};

// export const generateAdHTML = async ({
//   imageUrl,
//   logoUrl,
//   scene, userInput,
//   brandProfile, width, height
// }) => {
//   try {
//     if (!imageUrl) throw new Error("Image is required");

//     const SYSTEM_PROMPT = `You are an expert advertising designer, visual intelligence analyst, and front-end developer.

// Your task is to deep analyze a background image and generate a production-ready HTML advertisement using inline CSS.

// This will be rendered as a static image (NOT a webpage).

// ----------------------------------------
// STRICT RULES

// - No animations
// - No transitions
// - No hover effects
// - No JavaScript
// - Inline CSS only
// - Output ONLY raw HTML (no markdown, no comments)

// ----------------------------------------
// STEP 1: DEEP IMAGE ANALYSIS (MANDATORY)

// 1. DENSITY DETECTION
//    - Identify:
//      → High-density areas (subjects, objects, textures, bright/noisy regions)
//      → Low-density areas (empty, blurred, gradient, sky, clean surfaces)

// 2. SAFE ZONE IDENTIFICATION
//    - Find the largest uninterrupted clean area
//    - This is the ONLY valid content placement zone

// 3. SAFE ZONE SIZE ESTIMATION (IMPORTANT)
//    - SMALL → fits only headline + 1 line
//    - MEDIUM → headline + supporting text + CTA
//    - LARGE → full layout (headline + subtext + points + CTA)

// 4. POSITION DECISION
//    - LEFT / RIGHT / CENTER based on safe zone
//    - NEVER default blindly

// 5. NEVER:
//    - Overlap subjects or focal elements
//    - Place text in noisy areas

// ----------------------------------------
// STEP 2: BACKGROUND-AWARE STYLING

// Analyze SAFE ZONE background:

// - DARK background:
//   → Light text (white/off-white)
// - LIGHT background:
//   → Dark text (black/dark gray)
// - MIXED / LOW CONTRAST:
//   → Add soft gradient overlay behind content

// Ensure maximum readability at all times.

// ----------------------------------------
// STEP 3: HIERARCHY & TAGGING (MANDATORY)
// You must use semantic tags with the following font-size rules for a ${width}x${height} canvas:

// 1. <h1>: MAIN HEADLINE
//    - Size: 64px - 80px
//    - Weight: 800 (Extra Bold)

// 2. <h2>: SUPPORTING TEXT & FEATURE POINTS
//    - Size: 28px - 36px
//    - Weight: 600
//    - Use <h2> for EVERY bullet point to ensure they are large and premium.

// 3. <h3>: SECONDARY DETAILS / CTA LABEL
//    - Size: 18px - 22px

// ----------------------------------------
// STEP 4: FEATURE POINT (BULLET) STYLE
// - Every feature point must be wrapped in an <h2> tag.
// - Each point must have a large icon (e.g., a checkmark ✓) next to it.
// - Use flexbox (display: flex; align-items: center;) for points.
// - Add "margin-bottom: 24px" between points to prevent clutter.
// - Set "margin: 0; padding: 0;" on all h1/h2 tags to ensure layout precision.

// ----------------------------------------
// STEP 5: CTA RULE

// - Include ONLY if it improves the ad
// - Keep it subtle and premium
// - Button style (static, no effects)

// ----------------------------------------
// STEP 6: LOGO HANDLING (IMPORTANT) The logo must always be clearly visible and visually balanced.
// 1. LOGO SIZE: - Logo must occupy ~8% to 15% of total image width - Never too large (dominates layout) - Never too small (hard to recognize)
// 2. LOGO PLACEMENT: - Default: top-right corner with padding (24px–48px) - Must not overlap important background subjects
// 3. BACKGROUND CONTRAST HANDLING: Analyze the area behind the logo: - If background is DARK or busy: → Add a LIGHT (white) semi-transparent overlay behind logo → Example: rgba(255,255,255,0.6–0.85) - If background is LIGHT or bright: → Add a DARK semi-transparent overlay → Example: rgba(0,0,0,0.4–0.7) - If background is clean and already high contrast: → Do NOT add overlay
// 4. OVERLAY STYLE: - Soft rounded rectangle or subtle blur-style box - Padding inside overlay: 8px–16px - Border-radius: 8px–16px
// 5. LOGO IMAGE RULES: - Use object-fit: contain - Do NOT distort aspect ratio - Keep transparent background intact
// 6. NEVER: - Place logo directly on noisy or low-contrast background - Stretch or crop the logo

// ----------------------------------------
// STEP 7: IMAGE USAGE

// - Use EXACT provided URLs
// - Do NOT modify

// ----------------------------------------
// FINAL OUTPUT RULE

// Return ONLY raw HTML.

// - No markdown
// - No explanations
// - No comments
// - No \n characters

// ----------------------------------------
// FINAL GOAL

// Create a premium, visually balanced ad where:

// - Content is placed ONLY in the safest empty space
// - Layout adapts to available space intelligently
// - More space → more structured premium content
// - Less space → minimal clean message
// - Design always feels intentional, never crowded`;

//     const USER_PROMPT = `Background image URL:${imageUrl}
// Logo URL:${logoUrl}
// Ad size: ${width}x${height} px
// Scene description:${scene}
// What this ad should say or promote:${userInput}
// Business Summary:${brandProfile?.aiInsights?.summary}
// Brand Name:${brandProfile?.company?.name || ""}
// Brand Style:${brandProfile?.visualIdentity?.designStyle || ""}

// Brand Colors:
// ${Object.entries(brandProfile?.visualIdentity?.colors || {}).map(entry => entry[0] + '-' + entry[1]).join(', ')}

// IMPORTANT NOTES
// - Analyze the image carefully before placing content
// - Place content ONLY in the clean/safe area
// - Maintain strong visual balance
// - Keep the design premium and minimal
// - CTA should be included ONLY if relevant to the scene
// - Use brand colors for text ONLY when it improves readability and fits naturally with the background
// `;

//     console.log('colors codes', Object.entries(brandProfile?.visualIdentity?.colors || {}).map(entry => entry[0] + '-' + entry[1]).join(', '))

//     const response = await axios.post(
//       "https://api.anthropic.com/v1/messages",
//       {
//         model: "claude-haiku-4-5-20251001",
//         max_tokens: 2000,
//         system: SYSTEM_PROMPT,
//         messages: [
//           {
//             role: "user",
//             content: [
//               {
//                 type: "image",
//                 source: {
//                   type: "url",
//                   url: imageUrl
//                 }
//               },
//               {
//                 type: "text",
//                 text: USER_PROMPT
//               }
//             ]
//           }
//         ]
//       },
//       {
//         headers: {
//           "Content-Type": "application/json",
//           "x-api-key": process.env.ANTHROPIC_API_KEY,
//           "anthropic-version": "2023-06-01"
//         }
//       }
//     );

//     const html =
//       response?.data?.content?.[0]?.text?.trim() || "";

//     return {
//       success: true,
//       html
//     };

//   } catch (error) {
//     console.error("generateAdHTML error:", error?.response?.data || error.message);

//     return {
//       success: false,
//       html: "",
//       error: error.message
//     };
//   }
// };

export const htmlToImageBuffer = async ({
  html,
  width = 1024,
  height = 1024,
}) => {
  if (!html || typeof html !== "string") {
    throw new Error("Invalid HTML input");
  }

  let browser;

  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 2,
    });

    await page.setContent(html, {
      waitUntil: "networkidle0",
    });

    // wait for images
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      await Promise.all(
        imgs.map((img) => {
          if (img.complete) return;
          return new Promise((resolve) => {
            img.onload = img.onerror = resolve;
          });
        }),
      );
    });

    const buffer = await page.screenshot({
      type: "png",
    });

    if (!buffer) {
      throw new Error("Screenshot buffer is empty");
    }

    return buffer;
  } catch (error) {
    console.error("htmlToImageBuffer ERROR:", error.message);
    throw error;
  } finally {
    if (browser) await browser.close();
  }
};

export function cleanHTML(html) {
  return html
    .replace(/```html/g, "")
    .replace(/```/g, "")
    .trim();
}

//nano banana

export async function generateNanoBanana(
  prompt,
  params = {},
  userId = null,
  attachmentPath = [],
  isApprovalSkipped = false,
) {
  try {
    console.log("generateNanoBanana called with prompt length:", prompt);

    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling Gemini API");
    }

    const aspectRatio = params?.aspect || params?.ratio || "1:1";

    console.log("ASPECT RATIO:", aspectRatio, params);

    const attachmentUrl = attachmentPath?.[0]?.path;

    const rawImages = attachmentUrl
      ? [attachmentUrl]
      : (params?.imageUrls || []).filter(Boolean);

    console.log("Raw image URLs:", rawImages);

    const SUPPORTED_MIME_TYPES = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    };

    let logoUrl = null;
    let logoMimeType = null;
    let logoSkipped = false;

    if (!isApprovalSkipped && rawImages?.[0]) {
      try {
        const pathname = new URL(rawImages[0]).pathname;
        const extension = pathname
          .split(".")
          .pop()
          ?.toLowerCase()
          ?.split("?")[0];

        logoMimeType = SUPPORTED_MIME_TYPES[extension];

        if (logoMimeType) {
          logoUrl = rawImages[0];
        } else {
          logoSkipped = true;
          console.log(`Logo skipped. Unsupported file extension: ${extension}`);
        }
      } catch (err) {
        logoSkipped = true;
        console.error("Failed to validate logo:", err);
      }
    } else {
      logoSkipped = true;
      console.log(`Logo skipped. isApprovalSkipped=${isApprovalSkipped}`);
    }

    const token = await getAccessToken();
    const modelId = params?.model || "gemini-3.1-flash-image";

    if (
      modelId !== "gemini-3.1-flash-image" &&
      modelId !== "gemini-2.5-flash-image"
    ) {
      return generateImage(prompt, params);
    }

    const apiUrl = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${modelId}:generateContent`;

    const parts = [];

    const referenceImages = params?.characterImages || [];

    if (referenceImages.length > 0) {
      parts.push({
        text: "Reference Attachments",
      });

      for (const imageUrl of referenceImages) {
        try {
          const pathname = new URL(imageUrl).pathname;
          const extension = pathname
            .split(".")
            .pop()
            ?.toLowerCase()
            ?.split("?")[0];

          const mimeType = SUPPORTED_MIME_TYPES[extension];

          if (!mimeType) {
            console.log(`Skipping unsupported attachment: ${imageUrl}`);
            continue;
          }

          parts.push({
            file_data: {
              file_uri: imageUrl,
              mime_type: mimeType,
            },
          });
        } catch (err) {
          console.error("Failed to process attachment:", imageUrl, err);
        }
      }
      parts.push({
        text: `
The uploaded images are reference attachments.

Use them as visual references when relevant to the user's request.
Preserve identity and important details from the reference images when requested.
`,
      });
    }

    if (logoUrl && !logoSkipped) {
      parts.push(
        {
          text: "Reference Logo",
        },
        {
          file_data: {
            file_uri: logoUrl,
            mime_type: logoMimeType,
          },
        },
      );
    }

    const finalPrompt =
      logoUrl && !logoSkipped
        ? `${prompt.trim()}

OFFICIAL COMPANY LOGO

An official company logo reference image has been provided.

Use the uploaded logo exactly as supplied.

Do not recreate, redesign, modify, or generate variations of the logo.

Display the logo only once in the entire image.

Choose the single most natural placement for the advertisement.

Never duplicate the logo or show it in multiple locations.

The logo must remain visually identical to the uploaded reference.
`
        : prompt.trim();

    parts.push({
      text: finalPrompt,
    });

    const payload = {
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      generationConfig: {
        ...(modelId === "gemini-3.1-flash-image" && {
          responseModalities: ["IMAGE"],
          thinkingConfig: {
            thinkingLevel: "MINIMAL",
          },
        }),

        temperature: params?.temperature ?? 0.7,
        maxOutputTokens: params?.maxTokens ?? 4000,

        imageConfig: {
          aspectRatio,
        },
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const data = await response.json();

    console.log("Usage:", JSON.stringify(data?.usageMetadata, null, 2));

    const usage = data?.usageMetadata || {};
    usage.model = modelId;

    console.log({
      promptTokens: usage.promptTokenCount,
      outputTokens: usage.candidatesTokenCount,
      totalTokens: usage.totalTokenCount,
    });

    const candidate = data?.candidates?.[0];
    const partsRes = candidate?.content?.parts || [];

    const imagePart = partsRes.find((p) => p.inlineData || p.inline_data);

    if (imagePart) {
      const base64Image =
        imagePart.inlineData?.data || imagePart.inline_data?.data;

      const mimeType =
        imagePart.inlineData?.mimeType ||
        imagePart.inline_data?.mime_type ||
        "image/png";

      const finalBuffer = Buffer.from(base64Image, "base64");

      return {
        success: true,
        imageBase64: finalBuffer,
        mimeType,
        usage,
        logoSkipped,
      };
    }

    const output = partsRes?.[0]?.text || candidate;

    if (!output) {
      throw new Error("Empty response from Gemini");
    }

    return {
      success: true,
      output,
      raw: data,
      usage,
      logoSkipped,
    };
  } catch (error) {
    console.error("Gemini (Nano Banana) error:", error);
    const formatted = await logAndFormatAiError(error, "Vertex AI", {
      userId,
      feature: "generateNanoBanana",
      requestPayload: { prompt, params },
    });
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.errorCode;
    customErr.status = formatted.status;
    customErr.formattedError = formatted;
    throw customErr;
  }
}

const imageBuffer = {
  low: 20,
  medium: 10,
  high: 5
}

export async function generateChatGPT(
  prompt,
  params = {},
  userId = null,
  attachmentPath = [],
  isApprovalSkipped = false,
) {
  try {
    console.log("generateChatGPT image called with prompt length:", prompt);

    if (!prompt?.trim()) {
      throw new Error("Prompt is empty before calling Gemini API");
    }

    const aspectRatio = params?.dims || params?.ratio || "1:1";

    console.log("ASPECT RATIO:", aspectRatio, params);

    const attachmentUrl = attachmentPath?.[0]?.path;

    const rawImages = attachmentUrl
      ? [attachmentUrl]
      : (params?.imageUrls || []).filter(Boolean);

    console.log("Raw image URLs:", rawImages);

    const SUPPORTED_MIME_TYPES = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      webp: "image/webp",
      heic: "image/heic",
      heif: "image/heif",
    };

    let logoUrl = null;
    let logoMimeType = null;
    let logoSkipped = false;

    if (!isApprovalSkipped && rawImages?.[0]) {
      try {
        const pathname = new URL(rawImages[0]).pathname;
        const extension = pathname
          .split(".")
          .pop()
          ?.toLowerCase()
          ?.split("?")[0];

        logoMimeType = SUPPORTED_MIME_TYPES[extension];

        if (logoMimeType) {
          logoUrl = rawImages[0];
        } else {
          logoSkipped = true;
          console.log(`Logo skipped. Unsupported file extension: ${extension}`);
        }
      } catch (err) {
        logoSkipped = true;
        console.error("Failed to validate logo:", err);
      }
    } else {
      logoSkipped = true;
      console.log(`Logo skipped. isApprovalSkipped=${isApprovalSkipped}`);
    }


    const referenceImages = params?.characterImages || [];
    const finalImages = [...referenceImages]
    if (logoUrl && !logoSkipped) {
      finalImages.push(logoUrl)
    }

    const finalPrompt =
      logoUrl && !logoSkipped
        ? `${prompt.trim()}

OFFICIAL COMPANY LOGO

An official company logo reference image has been provided.

Use the uploaded logo exactly as supplied.

Do not recreate, redesign, modify, or generate variations of the logo.

Display the logo only once in the entire image.

Choose the single most natural placement for the advertisement.

Never duplicate the logo or show it in multiple locations.

The logo must remain visually identical to the uploaded reference.
`
        : prompt.trim();

    const callGpt = await generateWithOpenAI({
      prompt: finalPrompt,
      images: finalImages,
      quality: params?.resolution || "low",
      size: params?.dims || "1024x1024",
      bufferPercentage: imageBuffer[params?.resolution || "low"], // e.g. 10 => 10%
      marginPercentage: 100, // e.g. 25 => 25%
    })

    return {
      success: true,
      imageBase64: callGpt?.base64,
      mimeType: "image/png",
      usage: callGpt?.pricing,
      logoSkipped,
    };

  } catch (error) {
    console.error("Chat Gpt image generation error:", error);
    throw error;
  }
}

// ✅ helper (unchanged, just safer fallback)
function getMimeType(url) {
  if (url.endsWith(".png")) return "image/png";
  if (url.endsWith(".jpg") || url.endsWith(".jpeg")) return "image/jpeg";
  if (url.endsWith(".webp")) return "image/webp";
  return "image/png";
}

const isFromOurBucket = (url) => {
  if (!url) return false;

  return (
    url.includes(config.CLOUDFRONT_BASE_URL) ||
    url.includes(config.AWS_S3_BUCKET_NAME)
  );
};

const isSvg = (buffer) => {
  const str = buffer.toString("utf-8", 0, 200).toLowerCase();
  return str.includes("<svg");
};

export const normalizeAndUploadLogo = async (url) => {
  try {
    if (!url) throw new Error("Invalid URL");

    if (isFromOurBucket(url)) {
      return { url, isModified: false };
    }

    const origin = new URL(url).origin;

    let res;

    // 🔹 Attempt 1: normal fetch
    try {
      res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: origin,
          Origin: origin,
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (e) { }

    console.log(`Attempt 1 → ${url} → ${res?.status}`);

    // 🔹 Attempt 2: cookie-based retry
    if (!res || !res.ok) {
      try {
        console.log("Attempt 2 → Fetching cookies from homepage");

        const homeRes = await fetch(origin, {
          headers: {
            "User-Agent": "Mozilla/5.0",
          },
        });

        const setCookie = homeRes.headers.get("set-cookie");

        let cookieHeader = "";

        if (setCookie) {
          // extract only key=value
          cookieHeader = setCookie
            .split(",")
            .map((c) => c.split(";")[0])
            .join("; ");
        }

        console.log("Using cookies:", cookieHeader);

        res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: origin,
            Origin: origin,
            Cookie: cookieHeader,
          },
        });

        console.log(`Attempt 2 → ${res.status}`);
      } catch (e) {
        console.log("Cookie fallback failed:", e.message);
      }
    }

    // 🔹 Attempt 3: favicon fallback (guaranteed backup)
    if (!res || !res.ok) {
      const domain = new URL(url).hostname;
      const fallbackUrl = `https://www.google.com/s2/favicons?sz=256&domain=${domain}`;

      console.log("Attempt 3 → Favicon fallback:", fallbackUrl);

      res = await fetch(fallbackUrl);
    }

    if (!res.ok) {
      throw new Error(`Failed to fetch logo: ${res.status}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    let finalBuffer = buffer;
    let mimeType = "image/png";

    if (isSvg(buffer)) {
      finalBuffer = await sharp(buffer).png().toBuffer();
      mimeType = "image/png";
    } else {
      const type = await fileTypeFromBuffer(buffer);
      mimeType = type?.mime || "image/png";
    }

    const uploadedUrl = await uploadLogoBufferToS3(finalBuffer, mimeType);

    return { url: uploadedUrl, isModified: true };
  } catch (err) {
    console.error("normalizeAndUploadLogo error:", err);
    throw err;
  }
};

export async function urlToBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch: ${url}`);

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function composeImage(bgBuffer, logoUrl, options = {}) {
  const {
    position = "top-right",
    x = 0.8,
    y = 0.2,
    scale = 0.12,
    padding = 0.03,
    maxScale = 0.3,
  } = options;

  // Load images
  // const bgBuffer = await urlToBuffer(bgUrl);
  const actualBgBuffer = Buffer.isBuffer(bgBuffer)
    ? bgBuffer
    : Buffer.from(bgBuffer, "base64");
  const logoBuffer = await urlToBuffer(logoUrl);

  const bg = sharp(actualBgBuffer);
  const { width: bgW, height: bgH } = await bg.metadata();

  const aspect = bgW / bgH;

  // 🔥 FIXED scaling logic
  let logoWidth;

  if (aspect >= 1) {
    // Landscape + Square
    const adjustedScale = aspect === 1 ? scale * 1.6 : scale;
    logoWidth = bgW * adjustedScale;
  } else {
    // Portrait
    logoWidth = bgW * (scale * 1.2);
  }

  // Clamp max size
  const maxWidth = bgW * maxScale;
  logoWidth = Math.min(logoWidth, maxWidth);

  // Minimum size safeguard
  const minWidth = bgW * 0.08;
  logoWidth = Math.max(logoWidth, minWidth);

  logoWidth = Math.floor(logoWidth);

  // Max bounds for logo
  const maxLogoWidth = bgW * maxScale;
  const maxLogoHeight = bgH * maxScale;

  // Base size from width logic (your existing approach)
  let targetWidth = logoWidth;

  // Resize while respecting BOTH width & height
  const resizedLogo = await sharp(logoBuffer)
    .resize({
      width: Math.floor(targetWidth),
      kernel: sharp.kernel.lanczos3,
      height: Math.floor(maxLogoHeight),
      fit: "inside", // 🔥 ensures it never exceeds either dimension
      withoutEnlargement: true,
    })
    .toBuffer();

  const { width: logoW, height: logoH } = await sharp(resizedLogo).metadata();

  // Padding
  const padX = bgW * padding;
  const padY = bgH * padding;

  let left, top;

  switch (position) {
    case "top-left":
      left = padX;
      top = padY;
      break;

    case "top-right":
      left = bgW - logoW - padX;
      top = padY;
      break;

    case "bottom-left":
      left = padX;
      top = bgH - logoH - padY;
      break;

    case "bottom-right":
      left = bgW - logoW - padX;
      top = bgH - logoH - padY;
      break;

    case "center":
      left = (bgW - logoW) / 2;
      top = (bgH - logoH) / 2;
      break;

    case "custom":
      left = x * bgW - logoW / 2;
      top = y * bgH - logoH / 2;
      break;

    default:
      throw new Error("Invalid position");
  }

  // Composite
  return await bg
    .composite([
      {
        input: resizedLogo,
        left: Math.round(left),
        top: Math.round(top),
      },
    ])
    .toBuffer();
}

export const overlayLogoOnImage = async (
  bgBuffer,
  attachmentPath,
  messageId,
  params,
) => {
  try {
    const attachmentUrl =
      attachmentPath?.[0]?.path || attachmentPath?.[0] || attachmentPath || [];

    const rawImages = attachmentUrl
      ? [attachmentUrl]
      : (params?.imageUrls || []).filter(Boolean);
    console.log("Raw image URLs:", rawImages);

    // ✅ STEP 2: Normalize + track DB updates
    const processedResults = await Promise.all(
      rawImages.map(async (url) => {
        if (!url) return null;

        const result = await normalizeAndUploadLogo(url);

        return result.url;
      }),
    );

    // ✅ STEP 3: Final clean URLs
    const imageUrls = processedResults.filter(Boolean);

    const logoUrl = imageUrls?.[0];

    const message = await Message.findById(messageId).exec();

    // if (!message) {
    //   throw new Error("Message not found for ID: " + messageId);
    // }

    console.log("Message found for logo overlay:", message);

    const position = message?.logoPlacement?.position || {
      position: "top-right",
      x: 0.12,
      y: 0.1,
      scale: 0.1,
      maxScale: 0.3,
    };

    console.log(
      "Composing image with logo at URL:",
      logoUrl,
      "and position:",
      position,
    );

    const finalBuffer = await composeImage(bgBuffer, logoUrl, position);
    return finalBuffer;
  } catch (err) {
    console.error("overlayLogoOnImage error:", err);
    throw err;
  }
};

export const overlayLogoSimple = async (bgBuffer, logoUrl) => {
  if (!logoUrl) return bgBuffer;
  const { url } = await normalizeAndUploadLogo(logoUrl);

  return await composeImage(bgBuffer, url, {
    position: "top-right",
    scale: 0.12,
    padding: 0.03,
  });
};

// setTimeout(async () => {
//   const response = await fetch('https://dvjoibo2qkfpj.cloudfront.net/test/images/1776319942151.jpg');

//   if (!response.ok) {
//     throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
//   }

//   const arrayBuffer = await response.arrayBuffer();
//   const imageBuffer = Buffer.from(arrayBuffer);
//   const attachmentPath = [{ path: 'https://dvjoibo2qkfpj.cloudfront.net/test/logo/1776851433622.png' }]

//   const data = await overlayLogoOnImage(imageBuffer, attachmentPath, "69e89cf52c33e5b2c0d29b64")
//   // console.log('data here', data)
//   const mediaUrl = await uploadLogoBufferToS3(data)
//   console.log('mediaUrl', mediaUrl)

// }, 5000)

export const generateAdOverlaySuggestions = async ({
  imageUrl,
  scene,
  userInput,
  brandProfile,
  width,
  height,
  userId,
}) => {
  try {
    const SYSTEM_PROMPT = `You are a senior advertising art director and copywriter.
Your task is to analyze the background image and generate compelling text for an overlay ad, along with a suggested placement that avoids covering important subjects (like people or focal points).

OUTPUT STRICTLY AS JSON. No markdown formatting, no explanations.
The JSON must have this exact structure:
{
  "headline": "A short, punchy headline (1-6 words)",
  "subtext": "A brief supporting sentence (can be empty)",
  "cta": "Short call to action button text (e.g. 'Learn More', 'Shop Now', or empty)",
  "suggestedPlacement": "One of: top-left, top-center, top-right, middle-left, center, middle-right, bottom-left, bottom-center, bottom-right",
  "suggestedTheme": "Analyze the image colors at the suggested placement. If the background is light, return 'light' (so we use dark text). If the background is dark, return 'dark' (so we use light text).",
  "rationale": "Why you chose this placement and text based on the image's safe zones"
}`;

    const USER_PROMPT = `Background image URL:${imageUrl}
Ad size: ${width}x${height} px
What this ad should say or promote:${userInput || "Promotional image"}
Business/Personal Summary:${brandProfile?.analysisSummary || brandProfile?.analysis?.business_overview?.core_value_proposition || ""}
Brand/Creator Name:${brandProfile?.analysis?.business_overview?.brand_name || ""}

Generate the JSON now.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: imageUrl },
              },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    console.log(response.data, "response");

    let jsonStr = response.data.content[0].text;
    jsonStr = jsonStr
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // Credit tracking — uses the same token-based pipeline as estimateOverlayCost()
    // (computeCaptionCreditCost: live USD→INR from DB + 3x markup)
    // so the pre-flight estimate matches what actually gets deducted.
    const usage = response.data.usage;
    if (usage && userId) {
      try {
        const cost = await computeCaptionCreditCost(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929",
          true, // applyBuffer = true (3x markup)
        );
        if (cost.creditAmount > 0) {
          const deductResult = await deductDynamicCredit({
            userId,
            creditAmount: cost.creditAmount,
            serviceName: "adOverlaySuggestions",
            description: `Ad Overlay Suggestions | ${cost.formatted.credits}`,
            metadata: {
              prompt: (userInput || "").substring(0, 500),
              title: `Ad Overlay Suggestions`,
              extra: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                model: "claude-sonnet-4-5-20250929",
                costFormatted: cost.formatted.totalINR,
              },
            },
          });
          console.log(
            `✅ Deducted ${cost.creditAmount} credits (${cost.formatted.totalINR}) for ad overlays | walletBalance: ${deductResult.balanceAfter}`,
          );
        }
      } catch (creditErr) {
        console.error(
          `⚠️ Credit deduction failed for ad overlays: ${creditErr.message}`,
        );
      }
    }


    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error generating ad suggestions:", error);
    throw error;
  }
};

export const generateAdHTMLFromData = async ({
  imageUrl,
  width,
  height,
  data,
}) => {
  try {
    const { headline, subtext, cta, placement, theme, themeColors } = data;

    const isPortrait = height > width;
    const isSquare = Math.abs(width - height) < 100;

    const textBlockWidth = isPortrait
      ? Math.round(width * 0.85)
      : isSquare
        ? Math.round(width * 0.48)
        : Math.round(width * 0.44);

    let visualStylingRule = `If Theme is 'dark':
- Background: rgba(0, 0, 0, 0.7)
- Text color: #ffffff (White)
- Border: 1px solid rgba(255, 255, 255, 0.2)

If Theme is 'light':
- Background: rgba(255, 255, 255, 0.85)
- Text color: #000000 (Black)
- Border: 1px solid rgba(0, 0, 0, 0.1)`;

    if (themeColors && themeColors.bgHex && themeColors.textHex) {
      visualStylingRule = `- Background: ${themeColors.bgHex}CC (80% opacity)
- Text color: ${themeColors.textHex}
- Border: 1px solid ${themeColors.textHex}33 (20% opacity)`;
    }

    const SYSTEM_PROMPT = `You are a senior advertising art director at a world-class agency.

Your job is NOT to generate HTML mechanically.
Your job is to DESIGN a premium, minimal, high-conversion advertisement based on the image, and place the content EXACTLY where requested.

The output will be rasterized into a static image.

----------------------------------------
STRICT OUTPUT RULES

- Output ONLY raw HTML starting with <!DOCTYPE html>
- No markdown, no comments, no explanation
- Inline CSS only
- Use ONLY <h1> and <h2> for text
- No <p>, <span> for text blocks

----------------------------------------
CANVAS

Width: ${width}px
Height: ${height}px
Requested Placement: ${placement}
Requested Theme: ${theme || "dark"}

----------------------------------------
STEP 1 — LAYOUT PRECISION (CRITICAL)

- Container must EXACTLY match given size.
- Use absolute positioning to place the main content block exactly at: ${placement}.
- Use Flexbox inside the main content container to stack Headline, Subtext, and CTA.
- The text block width must be around ${textBlockWidth}px max. Do not stretch it across the entire canvas.

----------------------------------------
STEP 2 — VISUAL STYLING (CRITICAL)

You MUST style the main text block exactly like this to match the UI preview theme (${theme || "dark"}):

${visualStylingRule}

Universal Box Styles:
- Border radius: 8px
- Box shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5)
- Padding inside the box: ~16px to 24px.

ALWAYS use these exact semi-transparent box styles depending on the Requested Theme.

----------------------------------------
STEP 3 — CONTENT STYLE RULES

- HIERARCHY & TYPOGRAPHY:
  → Headline: Bold, sans-serif, tight line-height (leading-tight), margin-bottom: 4px.
  → Subtext: Normal weight, sans-serif, slightly smaller than headline, opacity: 0.8.
  → CTA (if provided): Very subtle, button-like, background: rgba(255,255,255,0.1), border: 1px solid rgba(255,255,255,0.2).

- SPACING:
  → Tightly stack Headline and Subtext. No huge gaps.
  → Do not add excessive padding.

- WORD BREAKING RULE:
  → NEVER break words in the middle.
  → Use word-break: normal; overflow-wrap: normal;
  → If headline exceeds width, scale font size dynamically using 'vw' or 'vh' relative units.

----------------------------------------
FINAL CHECK BEFORE OUTPUT

- No broken words
- No text overflow
- Text fits within ${textBlockWidth}px
- Exactly placed at ${placement}
- Design feels premium

OUTPUT:
Return ONLY raw HTML (no markdown, no explanation)`;

    const USER_PROMPT = `Background image URL: ${imageUrl}
Size: ${width}x${height} px
Headline: "${headline}"
Subtext: "${subtext}"
CTA: "${cta}"
Placement: ${placement}

Generate the HTML.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "url", url: imageUrl } },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let html = response?.data?.content?.[0]?.text?.trim() || "";

    html = html
      .replace(/^```html\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    if (!html.startsWith("<!DOCTYPE") && !html.startsWith("<html")) {
      console.error(
        "generateAdHTMLFromData: unexpected model output →",
        html.slice(0, 300),
      );
      throw new Error("Invalid HTML input");
    }

    return html;
  } catch (error) {
    console.error(
      "Error generating ad HTML from data:",
      error?.response?.data || error.message,
    );
    throw error;
  }
};

export const generateCaptionAndTags = async ({
  imageUrl,
  scene,
  userInput,
  brandProfile,
  userId,
}) => {
  try {
    const SYSTEM_PROMPT = `You are an expert social media manager and copywriter.
Your task is to analyze the image and generate an engaging caption and a list of highly relevant hashtags.

OUTPUT STRICTLY AS JSON. No markdown formatting, no explanations.
The JSON must have this exact structure:
{
  "caption": "An engaging, well-written social media caption (2-4 sentences). Use emojis appropriately.",
  "hashtags": ["tag1", "tag2", "tag3"] // Provide 5 to 10 relevant hashtags without the # symbol
}`;

    const USER_PROMPT = `Background image URL:${imageUrl}
Scene description:${scene || ""}
What this post should say or promote:${userInput || ""}
Business Summary:${brandProfile?.aiInsights?.summary || brandProfile?.description || ""}
Brand Name:${brandProfile?.company?.name || ""}

Generate the JSON now.`;

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "url", url: imageUrl },
              },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let jsonStr = response.data.content[0].text;
    jsonStr = jsonStr
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // Credit tracking — uses the same dynamic token-based pipeline (CaptionConfig + 3x markup)
    const usage = response.data.usage;
    if (usage && userId) {
      try {
        const cost = await computeCaptionCreditCost(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929",
          true, // applyBuffer = true (3x markup)
        );
        if (cost.creditAmount > 0) {
          const deductResult = await deductDynamicCredit({
            userId,
            creditAmount: cost.creditAmount,
            serviceName: "captionAndTagsGeneration",
            description: `Auto Caption & Hashtags | ${cost.formatted.credits}`,
            metadata: {
              prompt: (userInput || "").substring(0, 500),
              title: `Auto Caption & Hashtags`,
              extra: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                model: "claude-sonnet-4-5-20250929",
                costFormatted: cost.formatted.totalINR,
              },
            },
          });
          console.log(
            `✅ Deducted ${cost.creditAmount} credits (${cost.formatted.totalINR}) for caption/hashtags | walletBalance: ${deductResult.balanceAfter}`,
          );
        }
      } catch (creditErr) {
        console.error(
          `⚠️ Credit deduction failed for caption/hashtags: ${creditErr.message}`,
        );
      }
    }

    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error generating captions and tags:", error);
    throw error;
  }
};


const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RESPONSE_MODEL_PRICING = {
  "gpt-5": {
    input: 1.25,
    output: 10,
  },

  "gpt-5.5": {
    input: 5,
    output: 30,
  },

  "gpt-5.5-2026-04-23": {
    input: 5,
    output: 30,
  },
};

const IMAGE_PRICING = {
  "gpt-image-2": {
    "1024x1024": {
      low: 0.006,
      medium: 0.053,
      high: 0.211,
    },
    "1024x1536": {
      low: 0.005,
      medium: 0.041,
      high: 0.165,
    },
    "1536x1024": {
      low: 0.005,
      medium: 0.041,
      high: 0.165,
    },
  },

  "gpt-image-1.5": {
    "1024x1024": {
      low: 0.009,
      medium: 0.034,
      high: 0.133,
    },
    "1024x1536": {
      low: 0.013,
      medium: 0.050,
      high: 0.200,
    },
    "1536x1024": {
      low: 0.013,
      medium: 0.050,
      high: 0.200,
    },
  },

  "gpt-image-1": {
    "1024x1024": {
      low: 0.011,
      medium: 0.042,
      high: 0.167,
    },
    "1024x1536": {
      low: 0.016,
      medium: 0.063,
      high: 0.250,
    },
    "1536x1024": {
      low: 0.016,
      medium: 0.063,
      high: 0.250,
    },
  },

  "gpt-image-1-mini": {
    "1024x1024": {
      low: 0.005,
      medium: 0.011,
      high: 0.036,
    },
    "1024x1536": {
      low: 0.006,
      medium: 0.015,
      high: 0.052,
    },
    "1536x1024": {
      low: 0.006,
      medium: 0.015,
      high: 0.052,
    },
  },
};

const TOKEN_PRICING = {
  input: 5,
  output: 30,
};


export const generateTextWithOpenAI = async ({ systemPrompt, userPrompt }) => {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      max_tokens: 300,
      temperature: 0.7
    });
    return response.choices[0]?.message?.content?.trim() || "";
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "OpenAI", {
      endpoint: "generateTextWithOpenAI",
      requestPayload: { systemPrompt, userPrompt },
    });
    console.error("OpenAI Text Generation Error:", formatted.userMessage);
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.code;
    throw customErr;
  }
};

const getExchnageRate = async () => {
  try {

    const exchangeSetting = await settingValueModel?.findOne({ key: 'usd_exchange_rate_in_inr' }).lean()
    if (!exchangeSetting) {
      return 100
    }
    const rate = exchangeSetting?.values?.inr_exchange_rate || 100
    return rate

  } catch (error) {
    console.log('error', error)
    return 100
  }
}


export const generateWithOpenAI = async ({
  prompt,
  images = [],

  responseModel = "gpt-5",

  imageModel = "gpt-image-2",

  quality = "high",
  size = "1024x1024",

  background = "auto",
  outputFormat = "png",
  // Pricing
  bufferPercentage = 5, // e.g. 10 => 10%
  marginPercentage = 100, // e.g. 25 => 25%
}) => {

  console.log('generation params', imageModel, quality, size)
  console.log('reference images', images)
  try {
    const response = await openai.responses.create({
      model: responseModel,

      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },

            ...images.map((url) => ({
              type: "input_image",
              image_url: url,
            })),
          ],
        },
      ],

      tools: [
        {
          type: "image_generation",

          model: imageModel,

          size,
          quality,
          background,

          output_format: outputFormat,
        },
      ],
    });

    const image = response.output.find(
      (item) => item.type === "image_generation_call"
    );

    if (!image) {
      throw new Error("No image generated.");
    }

    const usage = response.usage ?? {};

    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;

    const responsePricing =
      RESPONSE_MODEL_PRICING[responseModel] ??
      RESPONSE_MODEL_PRICING["gpt-5"];

    const inputCost =
      (inputTokens / 1_000_000) *
      responsePricing.input;

    const outputCost =
      (outputTokens / 1_000_000) *
      responsePricing.output;

    const responseModelCost =
      inputCost + outputCost;

    const imageOutputCost =
      IMAGE_PRICING?.[imageModel]?.[size]?.[quality] ?? 0;

    const totalCostUSD =
      responseModelCost +
      imageOutputCost;

    const imageInputOverhead = images.length * 0.009;

    // --------------------
    // OpenAI Estimated Cost
    // --------------------

    const actualCostUSD =
      responseModelCost +
      imageInputOverhead +
      imageOutputCost;

    // --------------------
    // Platform Pricing
    // --------------------

    const bufferAmountUSD =
      actualCostUSD * (bufferPercentage / 100);

    const marginAmountUSD =
      actualCostUSD * (marginPercentage / 100);

    const chargeableCostUSD =
      actualCostUSD +
      bufferAmountUSD +
      marginAmountUSD;

    const USD_TO_INR = await getExchnageRate() || 100

    return {
      success: true,

      base64: image.result,

      usage,

      pricing: {
        responseModel,
        imageModel,

        inputTokens,
        outputTokens,
        totalTokens: usage.total_tokens ?? 0,

        usedExachangeRate: USD_TO_INR,

        responseModelCostUSD: Number(
          responseModelCost.toFixed(6)
        ),

        estimatedImageInputCostUSD: Number(
          imageInputOverhead.toFixed(6)
        ),

        imageOutputCostUSD: Number(
          imageOutputCost.toFixed(6)
        ),

        actualCost: {
          usd: Number(actualCostUSD.toFixed(6)),
          inr: Number((actualCostUSD * USD_TO_INR).toFixed(2)),
        },

        chargeableCost: {
          bufferPercentage,
          bufferAmountUSD: Number(bufferAmountUSD.toFixed(6)),

          marginPercentage,
          marginAmountUSD: Number(marginAmountUSD.toFixed(6)),

          usd: Number(chargeableCostUSD.toFixed(6)),
          inr: Number((chargeableCostUSD * USD_TO_INR).toFixed(2)),
        },
      }
    };
  } catch (error) {
    console.error("generateWithOpenAI error:", error);
    const formatted = await logAndFormatAiError(error, "OpenAI", {
      feature: "generateWithOpenAI",
      requestPayload: { prompt, responseModel, imageModel },
    });

    return {
      success: false,
      code: formatted.errorCode,
      error: formatted.userMessage,
    };
  }
};

async function fetchImageAsAnthropicBase64Block(imageUrl) {
  try {
    const response = await axios.get(imageUrl, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data, "binary");

    let mimeType = response.headers["content-type"] || "image/jpeg";

    // Anthropic is very strict about mime-type matching the actual file content bytes.
    // Check magic bytes to override incorrect content-type headers from S3/URLs
    if (buffer.length >= 4) {
      const header = buffer.toString("hex", 0, 4).toLowerCase();
      if (header.startsWith("89504e47")) {
        mimeType = "image/png";
      } else if (header.startsWith("ffd8ff")) {
        mimeType = "image/jpeg";
      } else if (header.startsWith("47494638")) {
        mimeType = "image/gif";
      } else if (
        header.startsWith("52494646") &&
        buffer.length >= 12 &&
        buffer.toString("hex", 8, 12).toLowerCase() === "57454250"
      ) {
        mimeType = "image/webp";
      }
    }

    const base64Data = buffer.toString("base64");
    return {
      type: "image",
      source: {
        type: "base64",
        media_type: mimeType,
        data: base64Data,
      },
    };
  } catch (error) {
    console.error(
      `Failed to fetch image for Anthropic API: ${imageUrl}`,
      error.message,
    );
    return null;
  }
}

export const generatePlatformSpecificCaptions = async ({
  imageUrl,
  mediaType = "image",
  scene,
  userInput,
  brandProfile,
  userId,
  platforms = [],
  targetAccounts = [],
  aiSummaryProfile,
}) => {
  try {
    // ── Build prompts via centralized builder (same function used by estimation) ──
    const {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      platformLimits,
      isAccountSpecific,
      fallbackLimits,
    } = await buildCaptionPrompts({
      brandProfile,
      userId,
      platforms,
      targetAccounts,
      aiSummaryProfile,
      mediaType,
      userInput,
      imageUrl,
      scene,
      includeAnalytics: true, // fetch SocialAnalyticsSnapshot data
    });

    // ── Calculate platform generation cost (uses platformLimits from builder) ──
    let totalPlatformCost = 0;
    if (isAccountSpecific) {
      targetAccounts.forEach((acc) => {
        const info = platformLimits.find(
          (p) => p.platform === acc.platform.toLowerCase(),
        );
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    } else {
      platforms.forEach((platform) => {
        const info = platformLimits.find((p) => p.platform === platform);
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    }

    const contentArray = [];
    if (mediaType === "image" && imageUrl) {
      const imageBlock = await fetchImageAsAnthropicBase64Block(imageUrl);
      if (imageBlock) {
        contentArray.push(imageBlock);
      }
    }
    contentArray.push({ type: "text", text: USER_PROMPT });

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: contentArray,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let jsonStr = response.data.content[0].text;
    jsonStr = jsonStr
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // ── Credit tracking (centralized via computeCaptionCreditCost) ──
    const usage = response.data.usage;
    if (usage && userId) {
      try {
        const actualCost = await computeCaptionCreditCost(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929",
          true, // 3x buffer markup
        );

        const actualCostWithoutBuffer = await computeCaptionCreditCostWithoutBuffer(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929"
        );

        // const estimationResult = await estimateCaptionCost({
        //   userId,
        //   promptHint: userInput,
        //   platforms,
        //   targetAccounts,
        //   mediaType,
        //   includeAnalytics: true,
        //   generationType: "platform",
        // });

        const totalCreditsToDeduct = actualCost.creditAmount;
        console.log("actualCost", actualCost);
        console.log(
          `[Platform Caption Deduction] ${platforms.join(", ")} | ${mediaType}`,
        );
        console.log(
          `  Tokens  -> Actual Raw: ${usage.input_tokens}in / ${usage.output_tokens}out`,
        );
        console.log(
          `  Credits -> Estimated/Deducting: ${totalCreditsToDeduct} (Actual would have been: ${actualCostWithoutBuffer.creditAmount})`,
        );

        if (totalCreditsToDeduct > 0) {
          await deductDynamicCredit({
            userId,
            creditAmount: totalCreditsToDeduct,
            serviceName: "platformSpecificCaptionGeneration",
            description: `Generated AI Captions for ${platforms.length} platform(s) (${platforms.join(", ")}) on a ${mediaType} post | ${totalCreditsToDeduct} credits | USD: ${actualCost.formatted.totalCost}`,
            metadata: {
              prompt: (userInput || "").substring(0, 500),
              title: `Platform Specific AI Captions`,
              extra: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                BufferInputTokens: actualCost.inputTokens,
                BufferOutputTokens: actualCost.outputTokens,
                model: "claude-sonnet-4-5-20250929",
                tokenCostFormatted: `${totalCreditsToDeduct} credits`,
                platformCost: totalPlatformCost,
                platforms: platforms,
                buffer: "3x",
              },
            },
          });
        }
      } catch (creditErr) {
        console.error(
          `Credit deduction failed for platform captions: ${creditErr.message}`,
        );
      }
    }
    let parsedData = JSON.parse(jsonStr);

    // Enforce absolute limits on the parsed data
    Object.keys(parsedData).forEach((accIdOrPlat) => {
      const aiData = parsedData[accIdOrPlat];
      let finalCaption = (aiData.caption || "").trim();
      let tagsArray = aiData.hashtags || [];

      let platformName = accIdOrPlat;
      if (isAccountSpecific) {
        const acc = targetAccounts.find(
          (a) => String(a.id) === String(accIdOrPlat),
        );
        if (acc) platformName = acc.platform.toLowerCase();
      } else {
        platformName = platformName.toLowerCase();
      }

      const limitInfo = platformLimits.find((p) => p.platform === platformName);
      const charLimit =
        limitInfo && limitInfo.characterLimit
          ? limitInfo.characterLimit
          : fallbackLimits[platformName] || 2000;

      const tagsStr =
        tagsArray.length > 0
          ? "\n\n" +
          tagsArray.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")
          : "";
      let tagsLen = tagsStr.length;

      if (tagsLen > charLimit * 0.5) {
        tagsArray = [];
        tagsLen = 0;
        aiData.hashtags = [];
      }

      let totalLength = finalCaption.length + tagsLen;
      if (totalLength > charLimit) {
        let allowedCaptionLength = charLimit - tagsLen;
        if (allowedCaptionLength > 0) {
          let truncated = finalCaption.substring(0, allowedCaptionLength);
          let lastPunctuation = Math.max(
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?"),
          );
          if (lastPunctuation > allowedCaptionLength * 0.6) {
            aiData.caption = truncated.substring(0, lastPunctuation + 1).trim();
          } else {
            let lastSpace = truncated.lastIndexOf(" ");
            if (lastSpace > 0) {
              aiData.caption = truncated.substring(0, lastSpace).trim() + "...";
            } else {
              aiData.caption = truncated.trim() + "...";
            }
          }
        }
      } else {
        aiData.caption = finalCaption;
      }
    });

    return parsedData;
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      userId,
      feature: "generatePlatformSpecificCaptions",
    });
    console.error("Error generating platform specific captions:", formatted.userMessage);
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.errorCode;
    throw customErr;
  }
};

export const generateSocialPostCaptions = async ({
  imageUrl,
  mediaType = "image",
  scene,
  userInput,
  brandProfile,
  userId,
  platforms = [],
  targetAccounts = [],
  draftId,
  mediaStoreId,
  aiSummaryProfile,
}) => {
  try {
    // ── Build prompts via centralized builder (same function used by estimation) ──
    const {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      platformLimits,
      isAccountSpecific,
      fallbackLimits,
    } = await buildCaptionPrompts({
      brandProfile,
      userId,
      platforms,
      targetAccounts,
      aiSummaryProfile,
      mediaType,
      userInput,
      imageUrl,
      scene,
      includeAnalytics: false,
    });

    // ── Calculate platform generation cost (uses platformLimits from builder) ──
    let totalPlatformCost = 0;
    if (isAccountSpecific) {
      targetAccounts.forEach((acc) => {
        const info = platformLimits.find(
          (p) => p.platform === acc.platform.toLowerCase(),
        );
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    } else {
      platforms.forEach((platform) => {
        const info = platformLimits.find((p) => p.platform === platform);
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    }

    const contentArray = [];
    if (mediaType === "image" && imageUrl) {
      const imageBlock = await fetchImageAsAnthropicBase64Block(imageUrl);
      if (imageBlock) {
        contentArray.push(imageBlock);
      }
    }
    contentArray.push({ type: "text", text: USER_PROMPT });

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: contentArray,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let jsonStr = response.data.content[0].text;
    jsonStr = jsonStr
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // ── Credit tracking (centralized via computeCaptionCreditCost) ──
    const usage = response.data.usage;
    if (usage && userId) {
      try {
        const actualCost = await computeCaptionCreditCost(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929",
          true, // 3x buffer markup
        );

        const actualCostWithoutBuffer = await computeCaptionCreditCostWithoutBuffer(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929"
        );

        // const estimationResult = await estimateCaptionCost({
        //   userId,
        //   promptHint: userInput,
        //   platforms,
        //   targetAccounts: [],
        //   mediaType,
        //   generationType: "social",
        // });

        const totalCreditsToDeduct = actualCost.creditAmount;
        console.log("actualCost", actualCost);
        console.log(
          `[Social Post Caption Deduction] ${platforms.join(", ")} | ${mediaType}`,
        );
        console.log(
          `  Tokens  -> Actual Raw: ${usage.input_tokens}in / ${usage.output_tokens}out`,
        );
        console.log(
          `  Credits -> Estimated/Deducting: ${totalCreditsToDeduct} (Actual would have been: ${actualCostWithoutBuffer.creditAmount})`,
        );

        if (totalCreditsToDeduct > 0) {
          await deductDynamicCredit({
            userId,
            creditAmount: totalCreditsToDeduct,
            serviceName: "socialPostCaptionGeneration",
            description: `Generated Social Post Captions for ${platforms.length} platform(s) (${platforms.join(", ")}) on a ${mediaType} post | ${totalCreditsToDeduct} credits | USD: ${actualCost.formatted.totalCost}`,
            metadata: {
              prompt: (userInput || "").substring(0, 500),
              title: `Social Post AI Captions`,
              extra: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                BufferInputTokens: actualCost.inputTokens,
                BufferOutputTokens: actualCost.outputTokens,
                model: "claude-sonnet-4-5-20250929",
                tokenCostFormatted: `${totalCreditsToDeduct} credits`,
                platformCost: totalPlatformCost,
                platforms: platforms,
                buffer: "3x",
              },
            },
          });
        }
      } catch (creditErr) {
        console.error(
          `Credit deduction failed for social post captions: ${creditErr.message}`,
        );
      }
    }

    let parsedData = {};
    try {
      parsedData = JSON.parse(jsonStr);

      // Enforce absolute char limits — handles both single caption and captions array (threads)
      Object.keys(parsedData).forEach((accIdOrPlat) => {
        const aiData = parsedData[accIdOrPlat];
        let tagsArray = aiData.hashtags || [];

        // Resolve platform name and per-account thread count
        let platformName = accIdOrPlat;
        let accountThreadCount = 1;
        if (isAccountSpecific) {
          const acc = targetAccounts.find(
            (a) => String(a.id) === String(accIdOrPlat),
          );
          if (acc) {
            platformName = acc.platform.toLowerCase();
            accountThreadCount = acc.threadCount || 1;
          }
        } else {
          platformName = platformName.toLowerCase();
        }

        const limitInfo = platformLimits.find(
          (p) => p.platform === platformName,
        );
        const charLimit =
          limitInfo && limitInfo.characterLimit
            ? limitInfo.characterLimit
            : fallbackLimits[platformName] || 2000;

        const tagsStr =
          tagsArray.length > 0
            ? "\n\n" +
            tagsArray.map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ")
            : "";
        let tagsLen = tagsStr.length;

        if (tagsLen > charLimit * 0.5) {
          tagsArray = [];
          tagsLen = 0;
          aiData.hashtags = [];
        }

        // Shared truncation helper
        const truncateCaption = (text) => {
          const trimmed = (text || "").trim();
          if (trimmed.length + tagsLen <= charLimit) return trimmed;
          const allowed = charLimit - tagsLen;
          if (allowed <= 0) return "";
          const truncated = trimmed.substring(0, allowed);
          const lastPunct = Math.max(
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?"),
          );
          if (lastPunct > allowed * 0.6)
            return truncated.substring(0, lastPunct + 1).trim();
          const lastSpace = truncated.lastIndexOf(" ");
          return lastSpace > 0
            ? truncated.substring(0, lastSpace).trim() + "..."
            : truncated.trim() + "...";
        };

        aiData.caption = truncateCaption(aiData.caption);
      });
    } catch (e) {
      console.error("Failed to parse AI JSON:", e);
      parsedData = {};
    }

    // Save directly to the database draft
    if (draftId && mediaStoreId) {
      try {
        const post = await SocialPost.findById(draftId);
        if (post) {
          let isModified = false;

          if (post.posts && post.posts.length > 0) {
            // NEW SCHEMA: post.posts
            Object.keys(parsedData).forEach((accIdOrPlat) => {
              const aiData = parsedData[accIdOrPlat];

              let parsedPosts = [];
              if (Array.isArray(aiData)) {
                parsedPosts = aiData;
              } else {
                const captionParts =
                  Array.isArray(aiData.captions) && aiData.captions.length > 0
                    ? aiData.captions
                    : aiData.caption
                      ? [aiData.caption]
                      : [];
                parsedPosts = captionParts.map((text, i) => ({
                  title: aiData.title || "",
                  caption: text,
                  hashtags:
                    i === captionParts.length - 1 ? aiData.hashtags || [] : [],
                }));
              }

              let threadIndex = 0;
              post.posts.forEach((p, pIndex) => {
                // Match either by accountId or platform
                if (
                  String(p.accountId) === String(accIdOrPlat) ||
                  p.platform === accIdOrPlat
                ) {
                  const matchesMedia =
                    p.media &&
                    p.media.some(
                      (m) =>
                        String(m.mediaStoreId) === String(mediaStoreId) ||
                        String(m.url) === String(imageUrl),
                    );

                  // If no media is explicitly set on the post yet, or it matches our target media
                  if (matchesMedia || !p.media || p.media.length === 0) {
                    const aiPost =
                      parsedPosts[threadIndex] || parsedPosts[0] || {};
                    post.posts[pIndex].caption = aiPost.caption || "";
                    post.posts[pIndex].hashtags = aiPost.hashtags || [];
                    if (aiPost.title) {
                      post.posts[pIndex].title = aiPost.title;
                    }
                    isModified = true;
                  }
                  threadIndex++;
                }
              });
            });

            if (isModified) {
              post.markModified("posts");
              await post.save();
            }
          } else {
            // LEGACY SCHEMA: post.media
            const mediaItemIndex = post.media.findIndex(
              (m) =>
                String(m.mediaStoreId) === String(mediaStoreId) ||
                String(m.url) === String(imageUrl),
            );
            if (mediaItemIndex > -1) {
              const mediaItem = post.media[mediaItemIndex];

              Object.keys(parsedData).forEach((accIdOrPlat) => {
                const aiData = parsedData[accIdOrPlat];
                const existingIndex =
                  mediaItem.platformSpecificCaptions.findIndex(
                    (c) =>
                      String(c.accountId) === String(accIdOrPlat) ||
                      c.platform === accIdOrPlat,
                  );

                let finalCaption = aiData.caption || "";
                const tagsArray = aiData.hashtags || [];

                if (existingIndex > -1) {
                  mediaItem.platformSpecificCaptions[existingIndex].title =
                    aiData.title || "";
                  mediaItem.platformSpecificCaptions[existingIndex].caption =
                    finalCaption;
                  mediaItem.platformSpecificCaptions[existingIndex].hashtags =
                    tagsArray;
                } else {
                  mediaItem.platformSpecificCaptions.push({
                    accountId: accIdOrPlat,
                    platform: accIdOrPlat,
                    title: aiData.title || "",
                    caption: finalCaption,
                    hashtags: tagsArray,
                  });
                }
              });

              post.markModified(
                `media.${mediaItemIndex}.platformSpecificCaptions`,
              );
              await post.save();
            }
          }
        }
      } catch (dbErr) {
        console.error(
          "Failed to update SocialPost draft with AI captions",
          dbErr,
        );
      }
    }

    return parsedData;
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      userId,
      feature: "generateSocialPostCaptions",
    });
    console.error("Error generating social post captions:", formatted.userMessage);
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.errorCode;
    throw customErr;
  }
};

export const generateTextSocialPostCaptions = async ({
  userInput,
  brandProfile,
  userId,
  platforms = [],
  targetAccounts = [],
  draftId,
}) => {
  try {
    // ── Build prompts via centralized builder (same function used by estimation) ──
    const {
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: USER_PROMPT,
      platformLimits,
      isAccountSpecific,
      fallbackLimits,
    } = await buildCaptionPrompts({
      brandProfile,
      userId,
      platforms,
      targetAccounts,
      mediaType: "text", // text-only: enables thread support + condensed instructions
      userInput,
    });

    // ── Calculate platform generation cost (uses platformLimits from builder) ──
    let totalPlatformCost = 0;
    if (isAccountSpecific) {
      targetAccounts.forEach((acc) => {
        const info = platformLimits.find(
          (p) => p.platform === acc.platform.toLowerCase(),
        );
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    } else {
      platforms.forEach((platform) => {
        const info = platformLimits.find((p) => p.platform === platform);
        if (info) totalPlatformCost += info.generationCost || 0;
      });
    }

    const contentArray = [{ type: "text", text: USER_PROMPT }];

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: contentArray,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      },
    );

    let jsonStr = response.data.content[0].text;
    jsonStr = jsonStr
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    // ── Credit tracking (centralized via computeCaptionCreditCost, 1 call per API response) ──
    const usage = response.data.usage;
    if (usage && userId) {
      try {
        // Calculate the actual cost for analytics/logging
        const actualCost = await computeCaptionCreditCost(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929",
          true, // 3x buffer markup
        );

        const actualCostWithoutBuffer = await computeCaptionCreditCostWithoutBuffer(
          usage.input_tokens,
          usage.output_tokens,
          "claude-sonnet-4-5-20250929"
        );

        // IMPORTANT: Calculate the estimated cost to deduct.
        // This ensures the deduction perfectly matches the quoted estimation in the UI!
        // const estimationResult = await estimateCaptionCost({
        //   userId,
        //   promptHint: userInput,
        //   platforms,
        //   targetAccounts,
        //   mediaType: "text",
        //   generationType: "text",
        // });
        console.log("actualCost", actualCost);
        const totalCreditsToDeduct = actualCost.creditAmount;
        const accountSummary = isAccountSpecific
          ? `${targetAccounts.length} account(s) [${targetAccounts.map((a) => `${a.platform}${a.threadCount > 1 ? ` x${a.threadCount}threads` : ""}`).join(", ")}]`
          : `${platforms.join(", ")}`;

        console.log(`[Text Caption Deduction] ${accountSummary}`);
        console.log(
          `  Tokens  -> Actual Raw: ${usage.input_tokens}in / ${usage.output_tokens}out`,
        );
        console.log(
          `  Credits -> Estimated/Deducting: ${totalCreditsToDeduct} (Actual would have been: ${actualCostWithoutBuffer.creditAmount})`,
        );

        if (totalCreditsToDeduct > 0) {
          await deductDynamicCredit({
            userId,
            creditAmount: totalCreditsToDeduct,
            serviceName: "textSocialPostCaptionGeneration",
            description: `AI Text Captions: ${accountSummary} | ${totalCreditsToDeduct} credits | USD: ${actualCost.formatted.totalCost}`,
            metadata: {
              prompt: (userInput || "").substring(0, 500),
              title: `Text-only Social Post AI Captions`,
              extra: {
                inputTokens: usage.input_tokens,
                outputTokens: usage.output_tokens,
                BufferInputTokens: actualCost.inputTokens,
                BufferOutputTokens: actualCost.outputTokens,
                buffer: "3x",
                model: "claude-sonnet-4-5-20250929",
                tokenCostFormatted: `${totalCreditsToDeduct} credits`,
                platformCost: 0,
                platforms,
                accountCount: isAccountSpecific
                  ? targetAccounts.length
                  : platforms.length,
              },
            },
          });
        }
      } catch (creditErr) {
        console.error(
          `Credit deduction failed for text captions: ${creditErr.message}`,
        );
      }
    }

    let parsedData = {};
    try {
      parsedData = JSON.parse(jsonStr);

      // Enforce absolute char limits — supports single caption AND captions array (threads)
      Object.keys(parsedData).forEach((accIdOrPlat) => {
        const aiData = parsedData[accIdOrPlat];
        let tagsArray = aiData.hashtags || [];

        // Resolve platform name and per-account thread count
        let platformName = accIdOrPlat;
        let accountThreadCount = 1;
        if (isAccountSpecific) {
          const acc = targetAccounts.find(
            (a) => String(a.id) === String(accIdOrPlat),
          );
          if (acc) {
            platformName = acc.platform.toLowerCase();
            accountThreadCount = acc.threadCount || 1;
          }
        } else {
          platformName = platformName.toLowerCase();
        }

        const limitInfo = platformLimits.find(
          (p) => p.platform === platformName,
        );
        const charLimit =
          limitInfo && limitInfo.characterLimit
            ? limitInfo.characterLimit
            : fallbackLimits[platformName] || 2000;

        // Shared truncation helper
        const truncateCaption = (text, tagsLength) => {
          const trimmed = (text || "").trim();
          if (trimmed.length + tagsLength <= charLimit) return trimmed;
          const allowed = charLimit - tagsLength;
          if (allowed <= 0) return "";
          const truncated = trimmed.substring(0, allowed);
          const lastPunct = Math.max(
            truncated.lastIndexOf("."),
            truncated.lastIndexOf("!"),
            truncated.lastIndexOf("?"),
          );
          if (lastPunct > allowed * 0.6)
            return truncated.substring(0, lastPunct + 1).trim();
          const lastSpace = truncated.lastIndexOf(" ");
          return lastSpace > 0
            ? truncated.substring(0, lastSpace).trim() + "..."
            : truncated.trim() + "...";
        };

        if (Array.isArray(aiData)) {
          aiData.forEach((item) => {
            let itemTagsArray = item.hashtags || [];
            let itemTagsStr =
              itemTagsArray.length > 0
                ? "\n\n" +
                itemTagsArray
                  .map((t) => (t.startsWith("#") ? t : `#${t}`))
                  .join(" ")
                : "";
            let itemTagsLen = itemTagsStr.length;
            if (itemTagsLen > charLimit * 0.5) {
              item.hashtags = [];
              itemTagsLen = 0;
            }
            item.caption = truncateCaption(item.caption, itemTagsLen);
          });
        } else {
          const tagsStr =
            tagsArray.length > 0
              ? "\n\n" +
              tagsArray
                .map((t) => (t.startsWith("#") ? t : `#${t}`))
                .join(" ")
              : "";
          let tagsLen = tagsStr.length;
          if (tagsLen > charLimit * 0.5) {
            tagsArray = [];
            tagsLen = 0;
            aiData.hashtags = [];
          }

          if (Array.isArray(aiData.captions)) {
            aiData.captions = aiData.captions.map((part) =>
              truncateCaption(part, tagsLen),
            );
            aiData.caption = aiData.captions[0] || "";
          } else {
            aiData.caption = truncateCaption(aiData.caption, tagsLen);
          }
        }
      });
    } catch (e) {
      console.error("Failed to parse AI JSON:", e);
      parsedData = {};
    }

    // Save directly to the database draft
    if (draftId) {
      try {
        const post = await SocialPost.findById(draftId);
        if (post) {
          let isModified = false;

          if (post.posts && post.posts.length > 0) {
            // NEW SCHEMA: post.posts
            Object.keys(parsedData).forEach((accIdOrPlat) => {
              const aiData = parsedData[accIdOrPlat];

              let parsedPosts = [];
              if (Array.isArray(aiData)) {
                parsedPosts = aiData;
              } else {
                const captionParts =
                  Array.isArray(aiData.captions) && aiData.captions.length > 0
                    ? aiData.captions
                    : aiData.caption
                      ? [aiData.caption]
                      : [];
                parsedPosts = captionParts.map((text, i) => ({
                  title: aiData.title || "",
                  caption: text,
                  hashtags:
                    i === captionParts.length - 1 ? aiData.hashtags || [] : [],
                }));
              }

              let threadIndex = 0;
              post.posts.forEach((p, pIndex) => {
                // Match either by accountId or platform
                if (
                  String(p.accountId) === String(accIdOrPlat) ||
                  p.platform === accIdOrPlat
                ) {
                  const aiPost =
                    parsedPosts[threadIndex] || parsedPosts[0] || {};
                  post.posts[pIndex].caption = aiPost.caption || "";
                  post.posts[pIndex].hashtags = aiPost.hashtags || [];
                  if (aiPost.title) {
                    post.posts[pIndex].title = aiPost.title;
                  }
                  isModified = true;
                  threadIndex++;
                }
              });
            });

            if (isModified) {
              post.markModified("posts");
              await post.save();
            }
          }
        }
      } catch (dbErr) {
        console.error(
          "Failed to update SocialPost draft with AI captions",
          dbErr,
        );
      }
    }

    return parsedData;
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      userId,
      feature: "generateTextSocialPostCaptions",
    });
    console.error("Error generating text platform specific captions:", formatted.userMessage);
    const customErr = new Error(formatted.userMessage);
    customErr.code = formatted.errorCode;
    throw customErr;
  }
};

export { calculateCaptionCost };
