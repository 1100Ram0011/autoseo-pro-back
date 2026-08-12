import axios from "axios";
import {
  APPROVAL_SYSTEM_IMAGE_PROMPT,
  APPROVAL_SYSTEM_IMAGE_PROMPT_WITH_OVERLAY_SUPPORT,
  BUSINESS_SUMMARY_PROMPT,
  PROMPT_APPROVAL_SYSTEM_PROMPT,
  PROMPT_APPROVAL_SYSTEM_PROMPT_LTX,
} from "../prompts/claudeBusinessSummary.prompt.js";
import ApiCredential from "../models/ApiCredential.js";
import AISetting from "../models/AISetting.js";
import { decrypt } from "../utils/crypto.js";
import { GoogleAuth } from "google-auth-library";
import config from "../config/config.js";
import { FreeUsage } from "../models/credits/index.js";

import { BRAND_PROFILE_PROMPT } from "../prompts/systemPrompts.js";
import BrandProfile from "../models/BrandProfile.js";
import {
  generateImagePrompt,
  getLogoColors,
  processBusinessBranding,
} from "./aiService.js";
import userModel from "../models/userModel.js";
import { logAndFormatAiError } from "../utils/aiErrorHandler.js";

/* ===================================================== */
/*  SHARED JSON SANITIZER (CRITICAL)                    */
/* ===================================================== */
function extractJson(text) {
  if (!text || typeof text !== "string") return null;

  return text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
}

export async function runClaudeAnalysisOld(firecrawlData) {
  try {
    /* -----------------------------
           1️⃣ GET ACTIVE GROQ KEY
        ----------------------------- */
    const credential = await ApiCredential.findOne({
      provider: "GROQ",
      isActive: true,
    }).lean();

    if (!credential) {
      throw new Error("No active Groq API credential found");
    }

    /* -----------------------------
           2️⃣ DECRYPT API KEY
        ----------------------------- */
    const apiKey = decrypt(credential.credentials.apiKey);

    /* -----------------------------
           3️⃣ CALL GROQ (FREE MODEL)
        ----------------------------- */
    const response = await axios.post(
      credential.meta?.baseUrl?.length
        ? credential.meta.baseUrl
        : "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        max_tokens: 6000,
        temperature: 0.2,
        messages: [
          /* ✅ SYSTEM PROMPT */
          {
            role: "system",
            content: BUSINESS_SUMMARY_PROMPT,
          },

          /* ✅ USER DATA */
          {
            role: "user",
            content: `Website Data:\n${JSON.stringify(firecrawlData)}`,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      },
    );

    /* -----------------------------
           4️⃣ PARSE + RETURN
        ----------------------------- */
    const text = response?.data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error("Groq returned empty response");
    }

    return JSON.parse(text);
  } catch (error) {
    /* -----------------------------
           5️⃣ ERROR HANDLING
        ----------------------------- */

    // Axios / HTTP error
    if (axios.isAxiosError(error)) {
      console.error("❌ Groq API Error", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });

      throw new Error(
        `Groq API failed (${error.response?.status || "NO_STATUS"})`,
      );
    }

    // JSON parsing error
    if (error instanceof SyntaxError) {
      console.error("❌ LLM JSON Parse Error", error.message);
      throw new Error("Invalid JSON returned by Groq");
    }

    // Any other error
    console.error("❌ runGroqAnalysis failed:", error.message);
    throw error;
  }
}

export async function runGoogleGeminiAnalysis(firecrawlData) {
  try {
    /* -----------------------------
           1️⃣ CONFIG
        ----------------------------- */
    const PROJECT_ID = config.GOOGLE_PROJECT_ID;
    const LOCATION = "global";
    const MODEL_ID = "gemini-3-pro-preview";

    /* -----------------------------
           2️⃣ GOOGLE AUTH
        ----------------------------- */
    const auth = new GoogleAuth({
      keyFile: "C:/Mytek/MytekAI/vertex-ai.json",
      // keyFile: "D:/gcp-keys/vertex-ai.json",
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    if (!token) {
      throw new Error("Failed to obtain Google access token");
    }

    /* -----------------------------
           3️⃣ CALL VERTEX GEMINI
        ----------------------------- */
    const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

    const response = await axios.post(
      url,
      {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `
${BUSINESS_SUMMARY_PROMPT}

IMPORTANT OUTPUT RULES:
- Return ONLY valid JSON
- Do NOT wrap the response in markdown
- Do NOT use \`\`\`json fences
- Response must be directly parseable by JSON.parse()

Website Data:
${JSON.stringify(firecrawlData)}
                                `,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 6000,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      },
    );

    /* -----------------------------
           4️⃣ PARSE GEMINI RESPONSE
        ----------------------------- */
    const text = response.data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      ?.join("");

    if (!text) {
      throw new Error("Gemini returned empty response");
    }

    const cleaned = extractJson(text);

    try {
      return JSON.parse(cleaned);
    } catch (err) {
      console.error("❌ GEMINI RAW OUTPUT:\n", text);
      throw new Error("Invalid JSON returned by Gemini");
    }
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ Vertex Gemini API Error", {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
      throw new Error(
        `Vertex Gemini failed (${error.response?.status || "NO_STATUS"})`,
      );
    }

    throw error;
  }
}

export async function generateAnalysisSummary(analysisData) {
  try {
    const apiKey = config.ANTHROPIC_API_KEY;

    const lightData = {
      business_overview: analysisData.business_overview,
      target_market: analysisData.target_market,
      competitor_analysis: analysisData.competitor_analysis,
      seo_scores: analysisData.seo_scores,
      growth_scorecard: analysisData.growth_scorecard,
      digital_marketing_needs: {
        current_gaps: analysisData.digital_marketing_needs?.current_gaps,
        recommended_channels:
          analysisData.digital_marketing_needs?.recommended_channels,
        growth_opportunities:
          analysisData.digital_marketing_needs?.growth_opportunities,
        social_links: analysisData.digital_marketing_needs?.social_links,
      },
      conversion_funnel_insights: analysisData.conversion_funnel_insights,
      competitive_differentiation_matrix:
        analysisData.competitive_differentiation_matrix,
      execution_recommendations: analysisData.execution_recommendations,
      contact_info: analysisData.contact_info,
      confidence_levels: analysisData.confidence_levels,
      trust_and_compliance_positioning:
        analysisData.trust_and_compliance_positioning,
      persona_specific_marketing_angles:
        analysisData.persona_specific_marketing_angles,
      branding_guidelines: analysisData.branding_guidelines,
      content_strategy: analysisData.content_strategy,
    };

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        temperature: 0.3,
        system: `You are a senior brand strategist and creative director. Given a structured business intelligence JSON, write a single dense, professional summary (250–350 words) that will be used as a creative brief for generating marketing images and videos.

Your summary MUST cover these elements clearly so an AI image/video generator can use it as reference:

BUSINESS IDENTITY:
- Brand name, what they do, their industry
- Core value proposition in one crisp sentence
- Geographic focus and target audience

BRAND VISUAL IDENTITY:
- Brand colors (hex codes if available, or descriptive names)
- Font style and visual tone (modern, corporate, minimal, bold, etc.)
- Logo usage notes if mentioned
- Overall visual style (clean, vibrant, dark, professional, etc.)

TARGET AUDIENCE & MESSAGING:
- Who the customer is (role, industry, pain points)
- Emotional triggers and what message converts them
- Tone of voice for content (formal, conversational, aspirational, etc.)

CONTENT DIRECTION:
- Platform focus (LinkedIn, Instagram, YouTube, etc.)
- Content goals and pillars
- Key pain points the content should address
- CTAs that work for this audience

COMPETITIVE CONTEXT:
- How they are positioned vs competitors
- What makes them different (speed, price, tech, trust)

Rules:
- Write in flowing prose, no bullet points, no headers
- Be specific — use actual brand names, colors, scores, and roles from the data
- If brand colors are missing, infer a professional tone based on industry
- If visual style is missing, infer from business type and target audience
- Do not hallucinate certifications, partnerships, or client names
- Output ONLY the paragraph, nothing else`,

        messages: [
          {
            role: "user",
            content: JSON.stringify(lightData),
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        timeout: 30000,
      },
    );

    const summary = response?.data?.content
      ?.filter((b) => b.type === "text")
      ?.map((b) => b.text)
      ?.join("")
      ?.trim();

    if (!summary) throw new Error("Empty summary returned");

    return summary;
  } catch (error) {
    console.error("❌ Summary generation failed:", error.message);
    return "";
  }
}

export async function runClaudeAnalysis(
  firecrawlData,
  userId = null,
  isAdminOutreach = false,
  isReanalysis = false,
) {
  try {
    const apiKey = config.ANTHROPIC_API_KEY;

    let videoCount = 0;
    let imageCount = 0;

    if (userId) {
      const freeUsage = await FreeUsage.findOne({ userId });
      if (freeUsage) {
        const videoLimit = freeUsage.usage?.aiVideoGen?.limit ?? 0;
        const imageLimit = freeUsage.usage?.aiImageGen?.limit ?? 0;

        console.log("video Free Limit", videoLimit);
        console.log("image Free Limit", imageLimit);

        // Dynamic according to limit number (multiplied by 5 as per user example "limit 1 -> 5 video")
        videoCount = isReanalysis
          ? 0
          : isAdminOutreach
            ? 0
            : videoLimit === -1
              ? 1
              : Math.max(0, videoLimit);

        imageCount = isReanalysis
          ? 0
          : isAdminOutreach
            ? 2
            : imageLimit === -1
              ? 1
              : Math.max(0, imageLimit);

        console.log("videoCount", videoCount);
        console.log("imageCount", imageCount);
      }
    }

    const imageColorAnalysisPrompt = `while generating image and video prompt use this rules Contrast Rule:
- Ensure text and logo placement areas always have strong contrast with the background
- If using light backgrounds → use dark text
- If using dark backgrounds → use light text
- Prioritize readability over strict color usage
- Make sure understand the logo colors and update according that the bg should properly oppoiste color to the logo color logo should display properly 

────────────────────────
CREATIVE INTENT
────────────────────────
Create a premium advertisement-style visual where:
- The business is instantly understood through imagery
- The composition feels high-end, clean, and intentional
- Text and logo areas are always clearly visible and readable

A striking, modern, premium advertising visual that communicates clearly through imagery and maintains perfect contrast.`;

    const dynamicPrompt = BUSINESS_SUMMARY_PROMPT.replace(
      /{{VIDEO_COUNT}}/g,
      videoCount,
    ).replace(/{{IMAGE_COUNT}}/g, imageCount);

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 8192, // Anthropic's absolute maximum output token limit for Sonnet models is 8192
        temperature: 0.2,
        system: dynamicPrompt,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  userPrompt: `IF NO BRAND COLORS THEN CRAWL BY USING WEBSITE URL ${firecrawlData?.url} AND GIVE IT ACCURATE COLORS OF THE WEBSITE AND MAKE SURE IT SHOULS NOT LIGHT COLORS like WHITE AND MAKE SURE COLOR SHOULD IN HEX CODE`,
                  website_url: firecrawlData?.url || "",
                  scraped_website_data: {
                    ...firecrawlData,
                    // Truncate markdown to a safe ~120,000 characters to ensure we never exceed Claude's 200k token limit, even for non-English sites
                    markdown: firecrawlData?.markdown ? firecrawlData.markdown.substring(0, 120000) : "",
                    // Limit noisy arrays to keep JSON payload clean
                    links: firecrawlData?.links ? firecrawlData.links.slice(0, 150) : [],
                    images: firecrawlData?.images ? firecrawlData.images.slice(0, 100) : []
                  },
                  imageColorAnalysisPrompt,
                }),
              },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "max-tokens-3-5-sonnet-2024-07-15" // Required header to unlock 8192 output tokens
        },
        // timeout: 120000
      },
    );

    // console.log("response - ", response);
    // console.log("response data - ", response.data);

    const blocks = response?.data?.content;
    if (!Array.isArray(blocks)) {
      throw new Error("Invalid Claude response structure");
    }

    let text = blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    text = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!text.startsWith("{") || !text.endsWith("}")) {
      console.error("❌ Non-JSON output:\n", text);
      throw new Error("Claude did not return pure JSON");
    }

    return JSON.parse(text);
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      endpoint: "runClaudeAnalysis",
      userId,
      requestPayload: { websiteUrl: firecrawlData?.url },
    });

    const errToThrow = new Error(formatted.userMessage);
    errToThrow.code = formatted.code;
    errToThrow.status = formatted.status;
    errToThrow.formattedAiError = formatted;
    throw errToThrow;
  }
}

// export async function runClaudePromptApproval({
//     generationType,
//     userPrompt,
//     businessContext
// }) {
//     const response = await axios.post(
//         "https://api.anthropic.com/v1/messages",
//         {
//             model: "claude-sonnet-4-5",
//             max_tokens: 1500, // keep this LOW
//             temperature: 0.2,
//             system: generationType === "image" ? APPROVAL_SYSTEM_IMAGE_PROMPT : PROMPT_APPROVAL_SYSTEM_PROMPT,
//             messages: [
//                 {
//                     role: "user",
//                     content: [
//                         {
//                             type: "text",
//                             text: JSON.stringify({
//                                 generation_type: generationType,
//                                 user_prompt: userPrompt,
//                                 business_context: businessContext
//                             })
//                         }
//                     ]
//                 }
//             ]
//         },
//         {
//             headers: {
//                 "Content-Type": "application/json",
//                 "x-api-key": config.ANTHROPIC_API_KEY,
//                 "anthropic-version": "2023-06-01"
//             },
//             timeout: 60000
//         }
//     );

//     const blocks = response.data.content;

//     const text = blocks
//         .filter(b => b.type === "text")
//         .map(b => b.text)
//         .join("")
//         .replace(/```json|```/gi, "")
//         .trim();

//     return JSON.parse(text);
// }

export async function runClaudePromptApproval({
  generationType,
  userPrompt,
  analysisSummary,
  brandContext,
  userId,
  parsedParams,
  verifiedBusinessInformation,
  logoSkipped
}) {

  try {
    const activeModelSetting = await AISetting.findOne({
      key: "activeVideoModel",
    });
    const user = await userModel.findById(userId);
    const activeVideoModel = activeModelSetting
      ? activeModelSetting.value
      : "veo";

    let systemPrompt = PROMPT_APPROVAL_SYSTEM_PROMPT;
    if (activeVideoModel === "ltx") {
      systemPrompt = PROMPT_APPROVAL_SYSTEM_PROMPT_LTX;
    }

    let BusinessLogo = verifiedBusinessInformation?.logo_url;
    const isBusiness = user.accountType === "business";

    if (BusinessLogo === "" && isBusiness) {
      BusinessLogo = await processBusinessBranding(userId);
    }

    const logoData = await getLogoColors(BusinessLogo);

    console.log("logoData", logoData);
    console.log('logo is skipped here', logoSkipped ? "APPROVAL_SYSTEM_IMAGE_PROMPT_WITH_OVERLAY_SUPPORT" : "APPROVAL_SYSTEM_IMAGE_PROMPT")

    let response;
    if (generationType === "image") {
      // response = await generateImagePrompt({scene: userPrompt, brandProfile: BusinessDetails})
      response = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 4000, // keep this LOW
          temperature: 0.2,
          system: `
          You are a content safety assistant. Analyze the user input and ensure it is safe for text or image generation.

Rules:
1. Detect unsafe content, including:
   - Hate speech, racism, discrimination
   - Violence, self-harm, or threats
   - Sexual, adult, or explicit content
   - Instructions for illegal activity
   - Harassment, bullying, or intimidation

   3. If fully safe, final prompt should match the original input.
4. Do not generate unsafe content yourself.
5. Ensure JSON is valid and parsable.

${logoSkipped ? APPROVAL_SYSTEM_IMAGE_PROMPT_WITH_OVERLAY_SUPPORT : APPROVAL_SYSTEM_IMAGE_PROMPT}
          `,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `USER REQUEST

${userPrompt}`
                },

                {
                  type: "text",
                  text: `VERIFIED BUSINESS INFORMATION

${JSON.stringify(
                    verifiedBusinessInformation,
                    null,
                    2
                  )}`
                },
                {
                  type: "text",
                  text: `Business Summary

${analysisSummary}`
                },

                {
                  type: "text",
                  text: `BRAND CONTEXT

${JSON.stringify(
                    brandContext,
                    null,
                    2
                  )}`
                },

                {
                  type: "text",
                  text: `GENERATION PARAMETERS

${JSON.stringify(
                    {
                      ...parsedParams, color_direction: {
                        base_colors: logoData.strategy.base,
                        accent_colors: logoData.strategy.accent,
                        avoid_colors: logoData.strategy.avoid,

                        instruction:
                          "Use these only as internal guidance. Never output hex codes, RGB values, CMYK values, or numeric color values in final_prompt. Convert them into descriptive color names."
                      }
                    } || {},
                    null,
                    2
                  )}
                  
                  `
                }
              ]
            }
          ]
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
    } else {
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
                    generation_type: generationType,
                    user_prompt: userPrompt,
                    business_context: analysisSummary || "",
                    generation_params: parsedParams || {},
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
    const usage = response.data.usage;
    const parsed = JSON.parse(text);
    const req = parsed.understood_requirements || {};

    // ========================================
    // RETURN STRUCTURED RESPONSE
    // ========================================
    return {
      usage,
      role: "assistant",

      // → message.content (shown in chat bubble to user)
      userExplanation: parsed.user_explanation || parsed.approval_message || "",

      // → message.prompt (sent to video generation model)
      finalPrompt: parsed.final_prompt || "",

      logoPlacement: parsed.logoPlacement || {},

      // → message.understoodRequirements
      understoodRequirements: {
        business_focus: req.business_focus || null,
        target_audience: req.target_audience || null,
        key_message: req.key_message || null,
        tone: req.tone || null,
        visual_style: req.visual_style || null,
        environment: req.environment || null,
        camera_style: req.camera_style || null,
        duration: req.duration || null,
        trend_integration: req.trend_integration || null,
      },

      // → message.promptAssumptions
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions : [],

      approvalMessage: parsed.approval_message || "",

      // ========================================
      // NEW: BRAND DATA TRACEABILITY
      // ========================================
      brandDataTraceability: parsed.brand_data_traceability || null,
      colorApplication: parsed.color_application || null,
      textSourcingValidation: parsed.text_sourcing_validation || null,
      trendJustification: parsed.trend_justification || null,
    };
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      endpoint: "runClaudePromptApproval",
      userId,
      requestPayload: { userPrompt, generationType },
    });

    const errToThrow = new Error(formatted.userMessage);
    errToThrow.code = formatted.code;
    errToThrow.status = formatted.status;
    errToThrow.formattedAiError = formatted;
    throw errToThrow;
  }
}

export async function runClaudePostContentGeneration({
  userPrompt,
  mediaType, // "video" | "image"
  businessContext,
  businessURL,
  businessData
}) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 1500,
        temperature: 0.2,
        system: `
You are an expert social media copywriter.

Your task:
- Generate post-ready content using the provided BUSINESS CONTEXT and USER PROMPT.
- SOURCE OF TRUTH: Always prioritize facts (timelines, features, names) found in the 'context' or 'businessURL' over generic industry assumptions.
- If the context says a service takes "minutes," do NOT say "hours" or "weeks."

CRITICAL RULES:
- Output ONLY valid JSON.
- No markdown, no explanations, no emojis.
- Content must be ready to paste into a post composer.
- GIVE ME STRICTLY ONLY ONE description & hashtags.

MEDIA RULES:
- If media_type = "video": Write a high-engagement video description/script outline.
- If media_type = "image": Write a concise, professional image caption.

HASHTAGS:
- 7–10 niche-specific hashtags. Include the brand name as a hashtag.

Output JSON schema:
{
  "description": "string",
  "hashtags": ["string"]
}
`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `USER REQUEST

${userPrompt}`
              },

              {
                type: "text",
                text: `VERIFIED BUSINESS INFORMATION

${JSON.stringify(businessData, null, 2)}`
              },

              {
                type: "text",
                text: `BRAND PROFILE

${JSON.stringify({
                  brand_name: businessContext?.brand_name,
                  industry: businessContext?.industry,
                  target_audience: businessContext?.target_audience,
                  branding_guidelines: businessContext?.branding_guidelines
                }, null, 2)}`
              },

              {
                type: "text",
                text: `ADDITIONAL CONTEXT

${JSON.stringify(businessContext, null, 2)}`
              }
            ]
          }
        ]
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

    const text = response.data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .replace(/```json|```/gi, "")
      .trim();

    return JSON.parse(text);
  } catch (error) {
    const formatted = await logAndFormatAiError(error, "Anthropic", {
      endpoint: "runClaudePostContentGeneration",
      requestPayload: { userPrompt, mediaType },
    });

    const errToThrow = new Error(formatted.userMessage);
    errToThrow.code = formatted.code;
    errToThrow.status = formatted.status;
    errToThrow.formattedAiError = formatted;
    throw errToThrow;
  }
}

// NVDIA
const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "moonshotai/kimi-k2.5";

const nvidiaHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.NVIDIA_API_KEY}`,
};

function extractNvidiaText(response) {
  const content = response?.data?.choices?.[0]?.message?.content;

  if (!content) return null;

  // Case 1: string
  if (typeof content === "string") {
    return content.trim();
  }

  // Case 2: array of blocks (Kimi / OpenAI-style)
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
  }

  return null;
}

function logNvidiaResponse(label, response) {
  const text = extractNvidiaText(response);

  console.log(`🟢 NVIDIA ${label}`, {
    reqId: response.headers?.["nvcf-reqid"],
    status: response.status,
    fulfilled: response.headers?.["nvcf-status"],
    model: response.data?.model,
    usage: response.data?.usage,
    outputPreview: text ? text.slice(0, 200) : null,
  });
}

export async function runNvidiaAnalysis(firecrawlData) {
  try {
    const response = await axios.post(
      NVIDIA_URL,
      {
        model: NVIDIA_MODEL,
        max_tokens: 30000,
        temperature: 0.2,
        messages: [
          { role: "system", content: BUSINESS_SUMMARY_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              website_url: firecrawlData?.url || "",
              scraped_website_data: firecrawlData,
            }),
          },
        ],
      },
      { headers: nvidiaHeaders },
    );

    logNvidiaResponse("Analysis", response);

    const text = extractNvidiaText(response);

    if (!text) {
      console.error("❌ NVIDIA Analysis: Empty output", response.data);
      throw new Error("Empty response from NVIDIA");
    }

    const cleanText = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();

    if (!cleanText.startsWith("{") || !cleanText.endsWith("}")) {
      console.error("❌ NVIDIA Analysis: Non-JSON output", cleanText);
      throw new Error("Model did not return pure JSON");
    }

    return JSON.parse(cleanText);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ NVIDIA Analysis API Error", {
        status: error.response?.status,
        data: error.response?.data,
      });
      throw new Error("NVIDIA Analysis API failed");
    }

    if (error instanceof SyntaxError) {
      console.error("❌ NVIDIA Analysis JSON Parse Error");
      throw new Error("Invalid JSON returned by NVIDIA Analysis");
    }

    console.error("❌ NVIDIA Analysis Unknown Error", error);
    throw error;
  }
}

export async function runNvdiaPromptApproval({
  generationType,
  userPrompt,
  businessContext,
}) {
  try {
    const response = await axios.post(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        model: "moonshotai/kimi-k2.5",
        max_tokens: 1500,
        temperature: 0.2,
        top_p: 1.0,
        stream: false,

        messages: [
          {
            role: "system",
            content: PROMPT_APPROVAL_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: JSON.stringify({
              generation_type: generationType,
              user_prompt: userPrompt,
              business_context: businessContext,
            }),
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${config.NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        timeout: 60000,
      },
    );

    // ---- TRACK NVIDIA RESPONSE (SAFE) ----
    logNvidiaResponse("PromptApproval", response);

    // ---- EXTRACT MODEL OUTPUT (Kimi-safe) ----
    const content = response?.data?.choices?.[0]?.message?.content;

    let text = null;

    if (typeof content === "string") {
      text = content.trim();
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
    }

    if (!text) {
      console.error(
        "❌ NVIDIA PromptApproval: Empty model output",
        response.data,
      );
      throw new Error("Empty response from NVIDIA PromptApproval");
    }

    const cleanText = text.replace(/```json|```/gi, "").trim();

    return JSON.parse(cleanText);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("❌ NVIDIA PromptApproval API Error", {
        status: error.response?.status,
        reqId: error.response?.headers?.["nvcf-reqid"],
        data: error.response?.data,
      });
      throw new Error("NVIDIA PromptApproval API failed");
    }

    if (error instanceof SyntaxError) {
      console.error("❌ NVIDIA PromptApproval JSON Parse Error");
      throw new Error("Invalid JSON returned by NVIDIA PromptApproval");
    }

    console.error("❌ NVIDIA PromptApproval Unknown Error", error);
    throw error;
  }
}

export async function runNvdiaPostContentGeneration({
  userPrompt,
  mediaType, // "video" | "image"
}) {
  const response = await axios.post(
    NVIDIA_URL,
    {
      model: NVIDIA_MODEL,
      max_tokens: 900,
      temperature: 0.2,

      messages: [
        {
          role: "system",
          content: `
You are an expert social media copywriter.

Your task:
- Generate post-ready content for social media.
- Use ONLY the provided prompt.
- Optimize for clarity, engagement, and conversions.

CRITICAL RULES:
- Output ONLY valid JSON
- No markdown
- No explanations
- No emojis
- No line like "Here is the post"
- Content must be ready to paste into a post composer
- GIVE ME STRICT ONLY ONE description & hashtags

MEDIA RULES:
- If media_type = "video":
  Write a short-form video description explaining the idea clearly.
- If media_type = "image":
  Write a concise image caption aligned with the prompt.

HASHTAGS:
- 7–10 relevant hashtags
- No #spam or generic tags

Output JSON schema:
{
  "description": "string",
  "hashtags": ["string"]
}
`,
        },
        {
          role: "user",
          content: JSON.stringify({
            media_type: mediaType,
            prompt: userPrompt || null,
          }),
        },
      ],
    },
    { headers: nvidiaHeaders, timeout: 60000 },
  );

  const text = response?.data?.choices?.[0]?.message?.content
    ?.replace(/```json|```/gi, "")
    .trim();

  return JSON.parse(text);
}

const dynamicPrompt = BRAND_PROFILE_PROMPT;

export function cleanClaudeJSON(text) {
  if (!text) return null;

  // remove markdown fences
  text = text.replace(/```json/g, "");
  text = text.replace(/```/g, "");

  // trim whitespace
  text = text.trim();

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("Claude returned invalid JSON");
  }
}

export async function analyzeWebsiteClaude(firecrawlData, userId) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const cleanedData = {
      url: firecrawlData?.url,
      markdown: firecrawlData?.response?.data?.markdown?.slice(0, 20000),
      metadata: firecrawlData?.response?.data?.metadata,
      branding: firecrawlData?.response?.data?.branding,
      summary: firecrawlData?.response?.data?.summary,
    };

    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-haiku-4-5-20251001",

        max_tokens: 4096,

        temperature: 0.2,

        system: dynamicPrompt,

        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  website_url: cleanedData.url,
                  scraped_website_data: cleanedData,
                }),
              },
            ],
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        timeout: 120000,
      },
    );

    const text = response.data?.content?.[0]?.text || "";

    // console.log('generation result', text)

    const parsed = cleanClaudeJSON(text);
    // console.log('parsed data', parsed)

    const saved = await BrandProfile.create({
      userId,
      websiteUrl: firecrawlData?.websiteUrl,
      websiteHash: firecrawlData?.websiteHash,
      ...parsed,
    });

    return saved;
  } catch (error) {
    console.error(
      "Claude analyze error:",
      error?.response?.data || error.message,
    );

    throw error;
  }
}

export async function generateAICommentReply({
  commentText,
  postCaption,
  username,
  commenterName = "User",
  platform = "Instagram"
}) {
  try {
    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const apiKey = config.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("Gemini API key is missing");

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const invalidNames = ["user", "commenter", "unknown"];
    const actualName = commenterName && typeof commenterName === "string" ? commenterName.trim() : "";
    const isValidName = actualName && !invalidNames.includes(actualName.toLowerCase());

    const viewerContext = isValidName ? `VIEWER: ${actualName}` : "";
    const nameRule = isValidName 
        ? `- Address ${actualName} by name, woven naturally into the sentence.`
        : `- DO NOT address the user by name since we don't know it. Do NOT use generic terms like "User" or "Commenter". Just reply directly.`;

    const prompt = `
You are replying to a ${platform} comment as the real person behind the account "@${username}" — not as a bot, not as a brand account. Write the way a genuine creator replies to comments: quickly, warmly, in your own voice.

${viewerContext}
POST CONTEXT: "${postCaption || 'No caption'}"
THEIR COMMENT: "${commentText}"

STEP 1 — Read the tone of their comment first. It could be:
- Positive / appreciative / excited
- A question
- Constructive criticism or a complaint
- Rude, hostile, or trolling
- Neutral/short (e.g. just an emoji or "nice")

STEP 2 — Reply according to that tone:
- Positive: match their energy, reference something SPECIFIC they said. Don't over-thank.
- Question: actually answer it.
- Constructive criticism: take it seriously, acknowledge the specific point.
- Rude or hostile: stay calm, brief, and secure. Do NOT argue or get defensive.
- Neutral/short: keep your reply just as short.

RULES:
${nameRule}
- 1-3 sentences max. Match the length to the comment.
- No hashtags, no emoji unless it fits the tone, no generic phrases like "Thanks for sharing!"
- Vary your sentence structure.
- Sound like a real person typed this in 15 seconds.

Return ONLY the reply text. No quotes, no labels, no explanation.
`.trim();

    const result = await model.generateContent(prompt);
    let reply = result.response.text().trim();
    if (reply.startsWith('"') && reply.endsWith('"')) {
        reply = reply.slice(1, -1);
    }
    return reply;
  } catch (error) {
    console.error("AI comment generation failed:", error.response?.data || error.message);
    return "Thank you for commenting! We really appreciate your feedback.";
  }
}
