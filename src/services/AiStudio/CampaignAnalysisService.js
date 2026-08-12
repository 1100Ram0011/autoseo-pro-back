import { GoogleGenerativeAI } from "@google/generative-ai";

/**
 * Clean LLM JSON response (strip markdown wrappers like ```json ... ```)
 */
function cleanJsonResponse(rawText) {
  if (!rawText) return {};
  try {
    let clean = rawText.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
    }
    return JSON.parse(clean);
  } catch (err) {
    console.error("Error parsing JSON from LLM response:", err, rawText);
    return {};
  }
}

/**
 * Generate comprehensive AI Pre-Production Package for a campaign
 * @param {Object} campaignDetails 
 * @param {Object} celebrityInfo 
 * @returns {Promise<Object>} aiProductionPackage
 */
export async function generateCampaignAnalysis(campaignDetails, celebrityInfo = {}) {
  const apiKey = process.env.GEMINI_API_KEY;

  const prompt = `
You are an expert AI Video Producer and Campaign Director at Borade AI Studio.
Analyze the following campaign parameters and script, then generate a comprehensive Pre-Production Package in valid JSON format.

CAMPAIGN PARAMETERS:
- Title: ${campaignDetails.title || "Untitled Campaign"}
- Objective: ${campaignDetails.objective || "Brand promotion"}
- Target Audience: ${campaignDetails.targetAudience || "General Audience"}
- Duration (seconds): ${campaignDetails.durationSeconds || 30}
- Script / Concept: ${campaignDetails.scriptText || "No script provided."}
- Celebrity Talent: ${celebrityInfo.fullName || "Celebrity Avatar"} (${celebrityInfo.talentType || "Talent"})

OUTPUT SPECIFICATION (Return ONLY valid JSON):
{
  "campaignSummary": "A concise overview of the campaign goal, tone, and strategic positioning.",
  "scriptSummary": "A breakdown of the narrative flow and main message points.",
  "characterBreakdown": "Instructions for visual style, emotional tone, attire, voice inflection, and performance pacing for the celebrity avatar.",
  "sceneBreakdown": [
    {
      "sceneNumber": 1,
      "title": "Opening Scene",
      "description": "Visual setting and camera shot.",
      "dialogue": "Spoken dialogue for this scene.",
      "visualCues": "Lighting, motion, on-screen text, graphics."
    }
  ],
  "storyboard": [
    {
      "frameNumber": 1,
      "visualDescription": "Detailed composition description.",
      "promptText": "AI image generation prompt for scene visual mockup.",
      "imageUrl": ""
    }
  ],
  "propsList": [
    "Prop 1", "Prop 2"
  ],
  "productionNotes": "Technical guidelines, aspect ratio (16:9 / 9:16), audio balance, and rendering hints."
}
`;

  try {
    if (apiKey) {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      const responseText = await result.response.text();
      const parsed = cleanJsonResponse(responseText);

      if (parsed.campaignSummary) {
        return {
          campaignSummary: parsed.campaignSummary || "",
          scriptSummary: parsed.scriptSummary || "",
          characterBreakdown: parsed.characterBreakdown || "",
          sceneBreakdown: parsed.sceneBreakdown || [],
          storyboard: parsed.storyboard || [],
          propsList: parsed.propsList || [],
          productionNotes: parsed.productionNotes || "",
          generatedAt: new Date(),
        };
      }
    }
  } catch (error) {
    console.error("Gemini AI Campaign Analysis error, falling back to smart defaults:", error.message);
  }

  // Fallback production package if API key is not present or API call fails
  return {
    campaignSummary: `AI-driven campaign "${campaignDetails.title || 'Brand Video'}" targeting ${campaignDetails.targetAudience || 'general users'}.`,
    scriptSummary: campaignDetails.scriptText
      ? `Script summary based on submitted text: ${campaignDetails.scriptText.substring(0, 150)}...`
      : "Script summary based on campaign objectives.",
    characterBreakdown: `Professional appearance by ${celebrityInfo.fullName || 'Celebrity'}, confident tone, high-clarity voice delivery.`,
    sceneBreakdown: [
      {
        sceneNumber: 1,
        title: "Hook & Introduction",
        description: "Close-up of celebrity avatar addressing the camera directly.",
        dialogue: campaignDetails.scriptText ? campaignDetails.scriptText.substring(0, 100) : "Welcome to our brand introduction!",
        visualCues: "Soft studio lighting, brand logo overlay at top right.",
      },
      {
        sceneNumber: 2,
        title: "Core Offer & Call to Action",
        description: "Medium shot with product highlight background graphics.",
        dialogue: campaignDetails.scriptText ? campaignDetails.scriptText.substring(100, 250) : "Check out our latest product lineup today.",
        visualCues: "Dynamic transition, call to action button overlay.",
      },
    ],
    storyboard: [
      {
        frameNumber: 1,
        visualDescription: "Framing 1: High definition studio avatar portrait.",
        promptText: `Professional portrait of ${celebrityInfo.fullName || 'celebrity'}, studio lighting, cinematic 8k.`,
        imageUrl: "",
      },
      {
        frameNumber: 2,
        visualDescription: "Framing 2: Product presentation shot.",
        promptText: `Modern product showcase studio setting, sleek design, commercial lighting.`,
        imageUrl: "",
      },
    ],
    propsList: ["Brand Logo SVG", "Product Prototype Graphic", "Subtitles Overlay"],
    productionNotes: "Format: 1080p Full HD, 16:9 landscape. Voice tone: Warm & professional. Background noise level: Silent studio.",
    generatedAt: new Date(),
  };
}
