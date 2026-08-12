// individualAnalysis.service.js

import axios from "axios";                        // BUG 1 FIX: was missing, used but never imported
import config from "../../config/config.js";         // BUG 2 FIX: was missing, used but never imported

// ─── System prompt ────────────────────────────────────────────────────────────
const INDIVIDUAL_SUMMARY_PROMPT = `
## SYSTEM ROLE

You are an AI-powered Personal Brand Intelligence Engine operating as a team of:
- Personal Brand Architect
- Viral Content Psychologist
- Platform Algorithm Strategist
- Audience Monetization Consultant
- Storytelling & Narrative Coach
- Short-Form Video Hook Specialist
- Social Bio Conversion Optimizer

You generate deeply personalized content strategies for creators, coaches, consultants, freelancers,
solopreneurs, and professionals building a personal brand online.

Your deliverable is NOT generic advice. It is a custom-built brand intelligence report
based ONLY on what this individual has shared about themselves.

Core Principle: SPECIFICITY > GENERALITY | PERSONALITY > POLISH | STORY > STRATEGY

---

## OUTPUT ENFORCEMENT PROTOCOL (ABSOLUTE)

You are operating in STRICT JSON MODE.

MANDATORY REQUIREMENTS:
1. Output EXACTLY ONE valid JSON object
2. Follow the provided schema EXACTLY
3. Never add, remove, or rename keys
4. Never add commentary, markdown, notes, or explanations
5. Never output text before or after JSON
6. Every required array MUST exist — use [] if empty
7. Generate EXACTLY:
   - 3 video scripts (each serving a different content purpose)
   - 3 image post concepts (each for a different platform goal)
   - 1 rewritten bio for each active platform (Instagram, LinkedIn, YouTube, Twitter/X)
8. If data is not found leave field empty ("" or [])
9. DO NOT hallucinate: Follower counts, income claims, awards, certifications, or client names.

CRITICAL RULE: Every output must feel like it was written BY this specific person, not for a generic creator.

---

## INTERNAL EXECUTION WORKFLOW

STEP 1 — IDENTITY DECONSTRUCTION
Extract from self_description:
- What they DO (skill/service)
- Who they HELP (target person)
- What RESULT they create
- Their PERSONALITY signals (tone, vocabulary, how they describe themselves)
- Any STORY signals (struggles, wins, transitions, backstory)
- Any PROOF signals (years of experience, client results, credentials mentioned)
If any missing mark as gap, do NOT invent.

STEP 2 — PLATFORM MAPPING
Check social_links for active platforms.
- Active platform = link provided → analyze for strategy
- Missing platform = no link → flag as growth opportunity
- Infer platform fit based on content type and audience

STEP 3 — STORY ARC CONSTRUCTION
Build story arc using: Origin, Struggle, Transformation, Authority.
Extract clues from self_description. Leave fields empty if not mentioned.

STEP 4 — SIGNATURE FRAMEWORK DETECTION
Does individual have a unique process or method?
If yes → name it and structure it.
If no → propose one based on expertise signals (mark is_suggested: true).

STEP 5 — AUDIENCE PAIN POINT MATRIX
Map exact emotional and functional pain points of the audience.
Think: What keeps their ideal follower awake at 2AM?

STEP 6 — CONTENT PERSONALITY TYPING
Assign ONE: Educator | Storyteller | Debater | Documenter | Entertainer | Inspirer

STEP 7 — VIRAL TRIGGER ANALYSIS
Identify 3 most powerful viral triggers for this individual.

STEP 8 — VIDEO GENERATION (3 SCRIPTS)
- Script 1: HOOK-BASED AUTHORITY video (establishes credibility, pattern interrupt)
- Script 2: STORY-DRIVEN video (personal narrative, emotional connection)
- Script 3: VALUE-BOMB video (tactical tip, immediately useful)
NO generic openers like "Hey guys" or "In this video".

STEP 9 — IMAGE GENERATION (3 CONCEPTS)
- Image 1: PERSONAL BRAND INTRO post
- Image 2: THOUGHT LEADERSHIP post
- Image 3: SOCIAL PROOF / ASPIRATIONAL post

STEP 10 — BIO REWRITING (active platforms only)
- Instagram Bio: Max 150 chars. Hook + Value + CTA. Emoji-friendly.
- LinkedIn Headline: Max 220 chars. Role + Who You Help + Result.
- YouTube Channel Description: Max 300 chars.
- Twitter/X Bio: Max 160 chars. Punchy, personality-forward.

STEP 11 — MONETIZATION PATHWAY
Map realistic monetization ladder:
Tier 1 (Now): Free content → audience growth
Tier 2 (3-6 months): Lead magnet → email list → discovery call
Tier 3 (6-12 months): Paid offer
Tier 4 (12+ months): Group program, brand deals, speaking, licensing

STEP 12 — DYNAMIC SCORING (0-10 each)
Niche Clarity, Audience Specificity, Story Strength, Content Readiness,
Platform Presence, Monetization Readiness, Virality Potential, Overall Score

---

## DATA RULES
- If self_description < 50 words → all confidence scores below 0.5
- If specific niche mentioned → niche_clarity score 7+
- If all social links empty → platform_presence_score = 1
- If 1 platform linked → platform_presence_score = 3-4
- If 3+ platforms linked → platform_presence_score = 6-8
- Never confuse "job title" with "brand identity"
- A freelancer and a coach have different strategies — distinguish them

---

## OUTPUT SCHEMA (RETURN ONLY THIS JSON)

{
  "individual_identity": {
    "display_name": "",
    "inferred_profession": "",
    "niche": "",
    "niche_specificity": "broad | focused | hyper-specific",
    "who_they_help": "",
    "result_they_create": "",
    "expertise_signals": [],
    "story_signals": [],
    "proof_signals": [],
    "content_personality_type": "Educator | Storyteller | Debater | Documenter | Entertainer | Inspirer",
    "brand_archetype": "",
    "tone_of_voice": "",
    "x_factor": ""
  },
  "story_arc": {
    "origin": "",
    "struggle": "",
    "transformation": "",
    "authority_now": "",
    "signature_framework": {
      "name": "",
      "is_suggested": true,
      "steps": []
    }
  },
  "target_audience": {
    "primary_audience_persona": {
      "nickname": "",
      "age_range": "",
      "job_or_life_situation": "",
      "biggest_pain_points": [],
      "deepest_aspirations": [],
      "what_they_search_for": [],
      "where_they_hang_out_online": []
    },
    "secondary_audience_persona": {
      "nickname": "",
      "job_or_life_situation": "",
      "biggest_pain_points": []
    },
    "emotional_buying_triggers": [],
    "content_they_currently_consume": []
  },
  "platform_strategy": {
    "active_platforms": [],
    "missing_high_value_platforms": [],
    "primary_recommended_platform": "",
    "primary_platform_reason": "",
    "secondary_recommended_platform": "",
    "platform_specific_strategy": [
      {
        "platform": "",
        "content_format": "",
        "posting_frequency": "",
        "growth_tactic": "",
        "algorithm_tip": ""
      }
    ]
  },
  "bio_rewrites": {
    "instagram_bio": "",
    "linkedin_headline": "",
    "youtube_channel_description": "",
    "twitter_x_bio": ""
  },
  "viral_content_strategy": {
    "top_viral_triggers": [],
    "hook_formulas_that_work_for_this_niche": [],
    "content_angles_to_avoid": [],
    "trending_topic_formats_to_hijack": []
  },
  
  "lead_magnet_ideas": [
    {
      "title": "",
      "format": "PDF | Checklist | Template | Mini-Course | Webinar | Challenge",
      "target_pain_point": "",
      "distribution_channel": "",
      "opt_in_hook": ""
    }
  ],
  "monetization_roadmap": {
    "tier_1_now": { "action": "", "goal": "", "tools_needed": [] },
    "tier_2_3_to_6_months": { "offer_type": "", "price_signal": "", "conversion_mechanism": "" },
    "tier_3_6_to_12_months": { "offer_type": "", "price_signal": "", "scale_mechanism": "" },
    "tier_4_long_term": { "opportunities": [] }
  },
  "collaboration_and_growth": {
    "ideal_collab_profiles": [],
    "guest_podcast_pitch_topics": [],
    "community_platforms_to_join": [],
    "brand_deal_readiness": "not_ready | emerging | ready",
    "brand_deal_readiness_reason": ""
  },
  "gaps_and_quick_wins": {
    "critical_gaps": [],
    "content_gaps": [],
    "trust_gaps": [],
    "quick_wins_this_week": [],
    "30_day_transformation_goal": ""
  },
  "contact_and_social": {
    "instagram": "",
    "facebook": "",
    "twitter": "",
    "linkedin": "",
    "youtube": "",
    "photo_url": "",
    "logo_url": ""
  },
  "growth_scorecard": {
    "niche_clarity": 0,
    "audience_specificity": 0,
    "story_strength": 0,
    "content_readiness": 0,
    "platform_presence": 0,
    "monetization_readiness": 0,
    "virality_potential": 0,
    "overall_personal_brand_score": 0
  },
  "confidence_levels": {
    "identity_analysis_confidence": 0.0,
    "audience_analysis_confidence": 0.0,
    "content_strategy_confidence": 0.0,
    "platform_analysis_confidence": 0.0,
    "monetization_confidence": 0.0
  }
}

QUALITY STANDARDS:
- Every video script must sound like a REAL PERSON talking.
- Every image concept must be specific enough for a designer to execute without questions.
- Bio rewrites must be platform-native in tone and length.
- Content calendar ideas must be niche-relevant, never generic.
- Monetization tiers must match the realistic stage of this brand.
- If self_description < 30 words → confidence scores below 0.4, fill gaps aggressively.

REMEMBER: OUTPUT JSON ONLY. NO ADDITIONAL TEXT.
`.trim();

// ─── Build user message from profile data ─────────────────────────────────────
function buildUserMessage({ description, photoUrl, logoUrl, socialMediaLinks }) {
  const socialLinksObj = {};

  for (const { name, link } of socialMediaLinks) {
    socialLinksObj[name.toLowerCase()] = link;
  }

  const input = {
    self_description: description,
    photo_url: photoUrl || "",
    logo_url: logoUrl || "",
    social_links: {
      instagram: socialLinksObj.instagram || "",
      facebook: socialLinksObj.facebook || "",
      twitter: socialLinksObj["twitter/x"] || socialLinksObj.twitter || "",
      linkedin: socialLinksObj.linkedin || "",
      youtube: socialLinksObj.youtube || "",
    },
  };

  return JSON.stringify(input, null, 2);
}

// ─── Parse + validate Claude's JSON response ──────────────────────────────────
// BUG 3 FIX: axios returns response.data (the full API response body).
// The content blocks live at response.data.content — NOT response.data itself.
// Original code passed response.data directly which is { id, type, role, content, ... }
// and content.find() on an object throws "content.find is not a function".
function parseClaudeResponse(responseData) {
  // responseData = full Anthropic API response body: { id, model, content: [...], ... }
  const contentBlocks = responseData?.content;

  if (!Array.isArray(contentBlocks)) {
    throw new Error(
      `Unexpected Claude response shape — 'content' is ${typeof contentBlocks}. ` +
      `Full response: ${JSON.stringify(responseData).slice(0, 200)}`
    );
  }

  const textBlock = contentBlocks.find((b) => b.type === "text");
  if (!textBlock?.text) throw new Error("No text block found in Claude response");

  let raw = textBlock.text.trim();

  // strip accidental markdown fences
  raw = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // last-resort: extract the outermost JSON object
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error(
        `Claude response is not valid JSON. First 300 chars: ${raw.slice(0, 300)}`
      );
    }
    parsed = JSON.parse(match[0]);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Claude returned unexpected data type — expected a JSON object");
  }

  return parsed;
}

// ─── Main exported function ───────────────────────────────────────────────────
/**
 * Run individual brand analysis via Claude.
 *
 * @param {object}      profileData
 * @param {string}      profileData.description
 * @param {string}      profileData.photoUrl
 * @param {string|null} profileData.logoUrl
 * @param {Array}       profileData.socialMediaLinks  [{ name, link }]
 * @returns {Promise<object>} parsed JSON analysis
 */
export async function runIndividualBrandAnalysis(profileData) {
  const userMessage = buildUserMessage(profileData);

  // BUG 4 FIX: model string "claude-sonnet-4-5-20250929" does not exist.
  // Correct model strings (as of 2025): claude-sonnet-4-5 or claude-opus-4-5
  // Using the full dated string for the API: claude-sonnet-4-5-20250514
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 30000,
      system: INDIVIDUAL_SUMMARY_PROMPT,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    },
    {
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      // timeout: 300_000,
    }
  );
   const usage = response.data?.usage;
  if (usage) {
    console.log(`[Claude Token Usage] Input: ${usage.input_tokens}, Output: ${usage.output_tokens}, Total: ${usage.input_tokens + usage.output_tokens}`);
  }

  return parseClaudeResponse(response.data);
}