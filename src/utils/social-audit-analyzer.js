// social-audit-analyzer.js
// =============================================================================
// Claude Sonnet 4.6  +  structured outputs
// Input:  Apify LinkedIn profile data  +  VADER sentiment data
// Output: Structured JSON — score, breakdown, sentiment, strengths,
//         weaknesses, recommendations, next post ideas, limitations, brand context
// =============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// ---------------------------------------------------------------------------
// Zod schema — what Claude MUST return (structured output)
// ---------------------------------------------------------------------------

const ScoreBreakdownSchema = z.object({
  linkValidity: z.number(),
  brandMatch: z.number(),
  platformFit: z.number(),
  ctaQuality: z.number(),
  dataDepth: z.number(),
});

const SentimentSchema = z.object({
  label: z.string(),
  score: z.number(),
  confidence: z.number(),
  positiveSignals: z.array(z.string()),
  negativeSignals: z.array(z.string()),
});

const BrandContextSchema = z.object({
  subjectType: z.string(),
  subjectName: z.string(),
  brandName: z.string(),
  businessType: z.string(),
  professionalPositioning: z.string(),
  associatedBrands: z.array(z.string()),
  valueProposition: z.string(),
  primaryCta: z.string(),
});

// --- 10 Premium Report Modules ---
const GrowthForecastSchema = z.object({
  lowEffortRate: z.number(),
  steadyEffortRate: z.number(),
  aggressiveEffortRate: z.number(),
});

const GrowthSnapshotSchema = z.object({
  executiveSummary: z.string(),
  trendExplanation: z.string(),
  growthForecast: GrowthForecastSchema,
  forecastDetails: z.string(),
});

const TopPostSuccessSchema = z.object({
  postId: z.string(),
  score: z.number(),
  reasonForSuccess: z.string(),
  patternIdentified: z.string(),
});

const TopPerformingContentSchema = z.object({
  posts: z.array(TopPostSuccessSchema),
  successPatterns: z.array(z.string()),
  futureRecommendations: z.array(z.string()),
});

const AudienceLoveMeterSchema = z.object({
  loveScore: z.number(),
  loveRatingLabel: z.string(),
  attachmentTriggers: z.array(z.string()),
  customRankings: z.object({
    mostLovedTheme: z.string(),
    mostSharedTheme: z.string(),
    mostSavedTheme: z.string(),
  }),
});

const TopCommenterSchema = z.object({
  username: z.string(),
  frequency: z.number(),
  typicalSentiment: z.string(),
  topicsMentioned: z.array(z.string()),
});

const FanSegmentSchema = z.object({
  segmentName: z.string(),
  description: z.string(),
  recommendedEngagementAction: z.string(),
});

const BiggestFansSchema = z.object({
  fanAdvocacyScore: z.number(),
  topCommenters: z.array(TopCommenterSchema),
  fanSegments: z.array(FanSegmentSchema),
});

const SuggestedScheduleItemSchema = z.object({
  dayOfWeek: z.string(),
  hourOfDay: z.number(),
  predictedEngagementBoost: z.number(),
  contentFormatRecommendation: z.string(),
});

const BestTimeToPostSchema = z.object({
  suggestedSchedule: z.array(SuggestedScheduleItemSchema),
  rationalDetails: z.string(),
});

const FormatRankItemSchema = z.object({
  format: z.string(),
  avgEngagement: z.number(),
  productionEffort: z.string(),
  efficiencyRatio: z.number(),
  roiGrade: z.string(),
});

const ContentTypeRankingSchema = z.object({
  efficiencyRank: z.array(FormatRankItemSchema),
  strategicContentMix: z.string(),
});

const ViralityBlueprintSchema = z.object({
  hookIdea: z.string(),
  emotionalAngle: z.string(),
  shareTactic: z.string(),
});

const ViralityScoreSchema = z.object({
  score: z.number(),
  viralityPotentialLabel: z.string(),
  triggersUsed: z.array(z.string()),
  viralTriggerBlueprint: ViralityBlueprintSchema,
});

const EmotionTrendItemSchema = z.object({
  emotion: z.string(),
  triggerTopic: z.string(),
  percentageOfComments: z.number(),
});

const FanSentimentAnalysisSchema = z.object({
  sentimentSummary: z.string(),
  scorePercentage: z.object({
    positive: z.number(),
    neutral: z.number(),
    negative: z.number(),
  }),
  emotionalTrends: z.array(EmotionTrendItemSchema),
});

const RoadmapItemSchema = z.object({
  topic: z.string(),
  requestedFormat: z.string(),
  suggestedHook: z.string(),
  strategicPriority: z.string(),
});

const WhatFansWantMoreOfSchema = z.object({
  extractedRequests: z.array(z.string()),
  contentRoadmap: z.array(RoadmapItemSchema),
});

const BrandHealthSummarySchema = z.object({
  overallGrade: z.string(),
  scorecardGrades: z.object({
    audienceQuality: z.string(),
    cadenceConsistency: z.string(),
    engagementDepth: z.string(),
    brandAlignment: z.string(),
    viralityPotential: z.string(),
  }),
  swotAnalysis: z.object({
    strengths: z.array(z.string()),
    weaknesses: z.array(z.string()),
    opportunities: z.array(z.string()),
    threats: z.array(z.string()),
  }),
  executiveStrategyPivots: z.array(z.string()),
});

const AuditOutputSchema = z.object({
  score: z.number(),
  scoreBreakdown: ScoreBreakdownSchema,
  sentiment: SentimentSchema,
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  recommendations: z.array(z.string()),
  keyFindings: z.array(z.string()),
  nextPostIdeas: z.array(z.string()),
  limitations: z.array(z.string()),
  brandContext: BrandContextSchema,
  analysisReportModules: z.object({
    growthSnapshot: GrowthSnapshotSchema,
    topPerformingContent: TopPerformingContentSchema,
    audienceLoveMeter: AudienceLoveMeterSchema,
    biggestFans: BiggestFansSchema,
    bestTimeToPost: BestTimeToPostSchema,
    contentTypeRanking: ContentTypeRankingSchema,
    viralityScore: ViralityScoreSchema,
    fanSentimentAnalysis: FanSentimentAnalysisSchema,
    whatFansWantMoreOf: WhatFansWantMoreOfSchema,
    brandHealthSummary: BrandHealthSummarySchema,
  }),
});

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT =
  `You are a senior social-media auditor and brand growth architect. You receive public social profile/channel/page data, per-post/per-comment VADER sentiment scores, computed backend stats, an audit subject, and optional website context.

Your job: produce a structured JSON audit. The output must populate both the standard audit fields AND the detailed ` + "`" + `analysisReportModules` + "`" + ` containing 10 premium analysis modules:

## Subject Identification
The pasted social URL/profile/channel/page is the primary audit subject. Website context is secondary reference only.
- If auditSubject.alignmentMode is "self_profile", audit the social profile/channel/page as itself.
- If auditSubject.alignmentMode is "brand_alignment", compare the social profile/channel/page against the supplied website brand.

---

## Instructions for the 10 Premium Report Modules:

### 1. growthSnapshot
- executiveSummary: Provide a high-level overview of the creator's current growth momentum.
- trendExplanation: Explain any recent positive or negative growth spikes based on the post publication timelines and engagement trends.
- growthForecast: Project the follower count in 12 months under three posting cadences (lowEffortRate, steadyEffortRate, aggressiveEffortRate) using realistic multipliers based on the platform's standard growth rates.
- forecastDetails: Detail the strategic assumptions and roadmap needed to achieve the aggressive target.

### 2. topPerformingContent
- posts: List the top-performing posts. For each, assign a custom quality score (0-100), explain the reason for success, and identify the specific content pattern.
- successPatterns: Identify 2-4 recurring topics, tones, or copy formats that consistently win.
- futureRecommendations: Recommend 2-3 specific post concepts to publish next.

### 3. audienceLoveMeter
- loveScore (0-100): Composite index. High scores require a combination of positive comment sentiment, high comment-to-like ratio, and organic sharing signals.
- loveRatingLabel: Define their status: "Adored", "Highly Engaged", "Passive", or "Detached".
- attachmentTriggers: List specific elements of the creator's personality or content that spark deep devotion.
- customRankings: Outline what exact theme gets the most love (comments), the most shares, and the most saves.

### 4. biggestFans
- fanAdvocacyScore (0-100): Rate the depth of fan engagement.
- topCommenters: Identify the most active commenters, their comment frequencies, typical sentiments, and topics they mention.
- fanSegments: Group fans into distinct clusters (e.g. Brand Advocates, Advice Seekers, Casual Viewers) and suggest a specialized engagement tactic for each.

### 5. bestTimeToPost
- suggestedSchedule: Formulate a custom weekly schedule with specific days, hours, predicted engagement boosts, and the ideal format (e.g., Reel, Carousel).
- rationalDetails: Justify this schedule using historical engagement peaks.

### 6. contentTypeRanking
- efficiencyRank: Compare each content format (Reels, Carousels, Static Images, Text Updates) and rate its average engagement, production effort (High/Medium/Low), and ROI efficiency ratio. Assign an ROI grade (A to D).
- strategicContentMix: Propose the ideal weekly distribution budget of formats (e.g., "3 Reels, 1 Carousel, and 1 static Q&A").

### 7. viralityScore
- score (0-100): Compound score. High scores represent high views-to-followers ratio and comment velocity.
- viralityPotentialLabel: "High", "Medium", or "Low".
- triggersUsed: Core emotional or algorithmic hooks detected (e.g., "Relatability", "Trend Hijacking").
- viralTriggerBlueprint: Outline a step-by-step blueprint (hook, emotional angle, share tactic) for their next piece of content.

### 8. fanSentimentAnalysis
- sentimentSummary: Explain the emotional undertone of the audience's comments.
- scorePercentage: Extract the percentage breakdown of Positive, Neutral, and Negative sentiments.
- emotionalTrends: Identify specific emotional trends (e.g., Skepticism, Admiration, Curiosity) along with the topics that trigger them.

### 9. whatFansWantMoreOf
- extractedRequests: Extract direct requests, questions, or product queries from comments (e.g., "where is the link", "make a tutorial").
- contentRoadmap: Propose a structured topic roadmap indicating requested format, suggested hook, and priority (High/Medium/Low).

### 10. brandHealthSummary
- overallGrade: Assign an executive letter grade (A+ to F).
- scorecardGrades: Grade five pillars: audienceQuality, cadenceConsistency, engagementDepth, brandAlignment, viralityPotential.
- swotAnalysis: Construct a solid SWOT matrix (Strengths, Weaknesses, Opportunities, Threats) for their brand.
- executiveStrategyPivots: Provide 2-3 immediate, high-priority pivots for the celebrity's team.

---

Be specific. Every strength, weakness, recommendation, post idea, and roadmap item must be traceable back to the data provided. Do not hallucinate metrics or features not present in the input.`.replace(
    /- recommendedChannels:[^\n]*\n/,
    "",
  );

// ---------------------------------------------------------------------------
// Build a compact text payload (token-efficient)
// ---------------------------------------------------------------------------

function buildPromptText(input) {
  const {
    profile,
    metrics,
    posts,
    comments,
    vaderPosts,
    vaderComments,
    vaderSummary,
    urlParts,
    websiteContext = {},
    auditSubject = {},
    computedStats = {},
    brandPartnerships = [],
  } = input;

  websiteContext.brandName ||= "not provided";
  websiteContext.businessType ||= "not provided";
  websiteContext.valueProposition ||= "not provided";
  websiteContext.primaryCta ||= "not provided";
  if (!Array.isArray(websiteContext.recommendedChannels) || !websiteContext.recommendedChannels.length) {
    websiteContext.recommendedChannels = ["not provided"];
  }

  let text = `=== AUDIT SUBJECT ===
Platform: ${auditSubject.platform || "not provided"}
Subject type: ${auditSubject.subjectType || "public_profile"}
Alignment mode: ${auditSubject.alignmentMode || "self_profile"}
Subject name: ${auditSubject.subjectName || profile.name || "not provided"}
Subject handle: ${auditSubject.subjectHandle || profile.username || "not provided"}
Website context role: ${auditSubject.websiteContextRole || "secondary_reference"}
Instruction: audit the social subject first. Use website context only when alignmentMode is brand_alignment or when the profile/posts clearly mention that website brand.

=== PROFILE ===
Name: ${profile.name || "—"}
Username: @${profile.username || "—"}
Bio: ${(profile.bio || "").slice(0, 500) || "—"}
Verified: ${profile.verified ? "yes" : "no"}
${urlParts ? `URL: ${urlParts.host}${urlParts.path} (handle: ${urlParts.handle})` : ""}

=== METRICS ===
Followers: ${metrics.followers ?? 0}
Posts: ${metrics.posts ?? 0}
Likes: ${metrics.likes ?? 0}  (avg per post: ${metrics.averageLikes ?? 0})
Comments: ${metrics.comments ?? 0}  (avg: ${metrics.averageComments ?? 0})
Shares: ${metrics.shares ?? 0}
Total engagements: ${metrics.publicEngagements ?? 0}
Engagement rate: ${metrics.publicEngagementRate ?? 0}%

=== WEBSITE CONTEXT ===
Brand name: ${websiteContext.brandName || "â€”"}
Business type: ${websiteContext.businessType || "â€”"}
Value proposition: ${websiteContext.valueProposition || "â€”"}
Primary CTA: ${websiteContext.primaryCta || "â€”"}
Website recommended channels: ${Array.isArray(websiteContext.recommendedChannels) ? websiteContext.recommendedChannels.join(", ") : "â€”"}

=== VADER SENTIMENT SUMMARY ===
Posts: ${vaderSummary.posts.total} total — ${vaderSummary.posts.positive} positive / ${vaderSummary.posts.neutral} neutral / ${vaderSummary.posts.negative} negative
Comments: ${vaderSummary.comments.total} total — ${vaderSummary.comments.positive} positive / ${vaderSummary.comments.neutral} neutral / ${vaderSummary.comments.negative} negative
Overall: ${vaderSummary.all.total} items — ${vaderSummary.all.positive} positive / ${vaderSummary.all.neutral} neutral / ${vaderSummary.all.negative} negative

=== COMPUTED PLATFORM STATS ===
- Posting Frequency by Day of Week: ${JSON.stringify(computedStats.postingFrequency || {})}
- Content Format Performance Averages: ${JSON.stringify(computedStats.formatBreakdown || {})}
- Average Likes/Comments Growth History: ${JSON.stringify(computedStats.monthlyLikes || {})}
- Top Commenters and Comment Volume: ${JSON.stringify(computedStats.topCommenters || [])}
- Branded vs Organic Ratio: ${computedStats.brandingPercentage || 0}%

=== EVIDENCE-BACKED BRAND PARTNERSHIPS ===
${Array.isArray(brandPartnerships) && brandPartnerships.length
  ? brandPartnerships
      .map(
        (partnership) =>
          `- ${partnership.brandName || partnership.brandHandle}: ${partnership.relationshipType || "brand association"}; ${partnership.postCount || 0} evidence posts; ${partnership.isConfirmedPaid ? "confirmed paid" : "not confirmed paid"}`,
      )
      .join("\n")
  : "No evidence-backed partnership records were found. Do not infer paid partnerships."}

=== POSTS (with per-post VADER) ===\n`;

  for (const p of posts) {
    const v = vaderPosts.find((vp) => vp.id === p.id);
    const vader = v?.vader || {};
    text += `
--- Post ${p.id.slice(-8)} ---
Date: ${p.publishedAt}
Likes: ${p.metrics?.likes ?? 0} | Comments: ${p.metrics?.comments ?? 0} | Shares: ${p.metrics?.shares ?? 0}
${v ? `VADER: ${vader.label || "N/A"} (score: ${Number.isFinite(vader.score) ? vader.score.toFixed(2) : "N/A"}, compound: ${Number.isFinite(vader.metrics?.compound) ? vader.metrics.compound.toFixed(4) : "N/A"})` : "VADER: N/A"}
Text: ${(p.text || "").slice(0, 1200)}
`;
  }

  if (comments.length > 0) {
    text += `\n=== COMMENTS (with per-comment VADER) ===\n`;
    for (const c of comments) {
      const v = vaderComments.find((vc) => vc.id === c.id);
      const vader = v?.vader || {};
      text += `- [${c.author || "anon"}] "${c.text}"${v ? ` → VADER: ${vader.label || "N/A"} (${Number.isFinite(vader.score) ? vader.score.toFixed(2) : "N/A"})` : ""}\n`;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Analyze a public social profile/channel/page using Claude Sonnet 4.6 + VADER sentiment data.
 *
 * @param {Anthropic} client - Initialized Anthropic SDK client
 * @param {object} input
 * @param {object} input.profile - Apify profile (name, username, bio, avatar, verified, ...)
 * @param {object} input.metrics - Apify metrics (followers, likes, comments, shares, ...)
 * @param {object[]} input.posts - Apify posts (id, text, url, publishedAt, metrics)
 * @param {object[]} input.comments - Apify comments (id, author, text, publishedAt)
 * @param {object[]} input.vaderPosts - VADER per-post results (id, label, score, confidence, positiveSignals, negativeSignals, metrics)
 * @param {object[]} input.vaderComments - VADER per-comment results
 * @param {object} input.vaderSummary - VADER aggregated counts {posts:{total,positive,neutral,negative}, comments:{...}, all:{...}}
 * @param {object} [input.urlParts] - Parsed URL {host, path, handle}
 * @returns {Promise<object>} Structured audit — {score, scoreBreakdown, sentiment, strengths, weaknesses, recommendations, nextPostIdeas, limitations, brandContext}
 */
export async function analyzeSocialAudit(client, input) {
  const promptText = buildPromptText(input);

  // We provide a JSON template to force the exact structure without using the strict tool schema that exceeds Anthropic's grammar size.
  const jsonTemplate = `
{
  "score": 0,
  "scoreBreakdown": { "linkValidity": 0, "brandMatch": 0, "platformFit": 0, "ctaQuality": 0, "dataDepth": 0 },
  "sentiment": { "label": "", "score": 0, "confidence": 0, "positiveSignals": [], "negativeSignals": [] },
  "strengths": [],
  "weaknesses": [],
  "recommendations": [],
  "keyFindings": [],
  "nextPostIdeas": [],
  "limitations": [],
  "brandContext": { "subjectType": "", "subjectName": "", "brandName": "", "businessType": "", "professionalPositioning": "", "associatedBrands": [], "valueProposition": "", "primaryCta": "" },
  "analysisReportModules": {
    "growthSnapshot": { "executiveSummary": "", "trendExplanation": "", "growthForecast": { "lowEffortRate": 0, "steadyEffortRate": 0, "aggressiveEffortRate": 0 }, "forecastDetails": "" },
    "topPerformingContent": { "posts": [ { "postId": "", "score": 0, "reasonForSuccess": "", "patternIdentified": "" } ], "successPatterns": [], "futureRecommendations": [] },
    "audienceLoveMeter": { "loveScore": 0, "loveRatingLabel": "", "attachmentTriggers": [], "customRankings": { "mostLovedTheme": "", "mostSharedTheme": "", "mostSavedTheme": "" } },
    "biggestFans": { "fanAdvocacyScore": 0, "topCommenters": [ { "username": "", "frequency": 0, "typicalSentiment": "", "topicsMentioned": [] } ], "fanSegments": [ { "segmentName": "", "description": "", "recommendedEngagementAction": "" } ] },
    "bestTimeToPost": { "suggestedSchedule": [ { "dayOfWeek": "", "hourOfDay": 0, "predictedEngagementBoost": 0, "contentFormatRecommendation": "" } ], "rationalDetails": "" },
    "contentTypeRanking": { "efficiencyRank": [ { "format": "", "avgEngagement": 0, "productionEffort": "", "efficiencyRatio": 0, "roiGrade": "" } ], "strategicContentMix": "" },
    "viralityScore": { "score": 0, "viralityPotentialLabel": "", "triggersUsed": [], "viralTriggerBlueprint": { "hookIdea": "", "emotionalAngle": "", "shareTactic": "" } },
    "fanSentimentAnalysis": { "sentimentSummary": "", "scorePercentage": { "positive": 0, "neutral": 0, "negative": 0 }, "emotionalTrends": [ { "emotion": "", "triggerTopic": "", "percentageOfComments": 0 } ] },
    "whatFansWantMoreOf": { "extractedRequests": [], "contentRoadmap": [ { "topic": "", "requestedFormat": "", "suggestedHook": "", "strategicPriority": "" } ] },
    "brandHealthSummary": { "overallGrade": "", "scorecardGrades": { "audienceQuality": "", "cadenceConsistency": "", "engagementDepth": "", "brandAlignment": "", "viralityPotential": "" }, "swotAnalysis": { "strengths": [], "weaknesses": [], "opportunities": [], "threats": [] }, "executiveStrategyPivots": [] }
  }
}
`;

  const stream = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 32000,
    stream: true,
    system: SYSTEM_PROMPT + "\n\nIMPORTANT: You must return ONLY raw valid JSON matching the exact schema structure provided below. Do not include any conversational text. Output ONLY the raw JSON object starting with '{' and ending with '}'. Do NOT wrap the JSON in markdown code blocks.\nCRITICAL: Generate the JSON output immediately. Do NOT over-analyze or think extensively. Keep your thinking block as brief as possible to ensure you don't run out of output tokens.\n" + jsonTemplate,
    messages: [
      {
        role: "user",
        content: `Analyze this public social profile/channel/page data and VADER sentiment output. Return a structured JSON audit.\n\n${promptText}`,
      }
    ],
  });

  let parsed_output;
  let rawText = "";
  let inputTokens = 0;
  let outputTokens = 0;
  
  try {
    for await (const chunk of stream) {
      if (chunk.type === "message_start" && chunk.message?.usage) {
        inputTokens = chunk.message.usage.input_tokens || 0;
      }
      if (chunk.type === "message_delta" && chunk.usage) {
        outputTokens = chunk.usage.output_tokens || 0;
      }
      if (chunk.type === "content_block_delta" && chunk.delta && chunk.delta.type === "text_delta") {
        rawText += chunk.delta.text;
      }
    }
    
    rawText = rawText.trim();
    if (!rawText) {
      throw new Error("Empty response received from Claude.");
    }

    // Safely strip out markdown formatting if Claude disobeys the instruction
    if (rawText.startsWith("```json")) {
      rawText = rawText.substring(7);
    } else if (rawText.startsWith("```")) {
      rawText = rawText.substring(3);
    }
    if (rawText.endsWith("```")) {
      rawText = rawText.substring(0, rawText.length - 3);
    }
    
    parsed_output = JSON.parse(rawText.trim());
  } catch (e) {
    console.error("Failed to parse Claude JSON output. Raw text length:", rawText.length, "Preview:", rawText.substring(0, 100));
    throw new Error("Claude returned malformed JSON: " + e.message);
  }

  return { 
    response: { 
      usage: { 
        input_tokens: inputTokens, 
        output_tokens: outputTokens 
      } 
    }, 
    parsed_output 
  };
}

// ---------------------------------------------------------------------------
// One-shot convenience
// ---------------------------------------------------------------------------

/**
 * Run an audit in a single call (creates the SDK client internally).
 * Reads ANTHROPIC_API_KEY from the environment, or pass it explicitly.
 *
 * @param {object} input - Same shape as analyzeSocialAudit's input
 * @param {string} [apiKey] - Optional API key override
 * @returns {Promise<object>} Structured audit JSON
 */
export async function runAudit(input, apiKey) {
  const client = new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });
  return analyzeSocialAudit(client, input);
}
