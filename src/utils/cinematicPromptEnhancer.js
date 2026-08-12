import Anthropic from "@anthropic-ai/sdk";
import logger from "../config/logger.js";
import { calculateCost } from "./claudPricingCalculate.js";
import { deductDynamicCredit } from "./creditTracker.js";
import { logAndFormatAiError } from "./aiErrorHandler.js";

/**
 * Enhances a raw user prompt into a structured cinematic block.
 * Specifically used for 8-second single-clip videos to match the long-form quality.
 *
 * @param {string} prompt The raw user prompt
 * @param {string} userId The user's ID to deduct credits
 * @returns {Promise<string>} The structured cinematic prompt
 */
export async function enhancePromptCinematically(prompt, userId) {
  try {
    if (!userId) {
      logger.warn("[CinematicEnhancer] Missing userId for credit deduction.");
      return prompt;
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const systemPrompt = `You are AXIS — an elite AI Auteur and cinematic director.

Your job is to take a raw user request for a short video clip and break it down into strict cinematic data parameters.

If the user already provides narration, dialogue, or a voiceover, preserve it while improving grammar or shortening it only if necessary.

If the user already provides narration, dialogue, or a voiceover, preserve it while improving grammar or shortening it only if necessary.

If the user does not provide a voiceover, automatically generate a professional commercial voiceover based on the user's request.

The generated voiceover must:
- Complete naturally and smoothly within the timeframe of the video.
- Be concise (approximately 18–22 spoken words).
- Flow smoothly with natural pacing.
- Use conversational, human-sounding language.
- Avoid repeating words, phrases, or ideas.
- Avoid filler words and unnecessary adjectives.
- Match the scene, mood, and subject.
- End before the visual ending.
- Return only the spoken narration (no quotes, no speaker labels).

OUTPUT FORMAT: Valid JSON only. No markdown. No code fences.

JSON SCHEMA:
{
  "cinematicData": {
    "action": "Scene action, cinematography, movement only.",
    "subject": "Detailed character breakdown and anatomy...",
    "environment": "Setting and background elements...",
    "lighting": "Lighting setup, key/fill/backlight...",
    "camera": "Lens, angle, and framing...",
    "mood": "Emotional undertone...",
    "style": "Visual aesthetic and color grading...",
    "motion": "Camera or subject momentum...",
    "voiceover": "Commercial narration delivered smoothly within the video timeframe."
  }
}`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      temperature: 0.5,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `Break down this video request into the cinematicData JSON format: "${prompt}"`,
        },
      ],
    });

    if (response.usage) {
      try {
        const cost = await calculateCost(response.usage, "claude-sonnet-4-5-20250929");
        if (cost.cost.credits > 0) {
          await deductDynamicCredit({
            userId,
            creditAmount: cost.cost.credits,
            serviceName: "cinematicPromptEnhancer",
            description: `Cinematic Prompt Enhancement | ${cost.formatted}`,
            metadata: { source: "enhancePromptCinematically" }
          });
        }
      } catch (costErr) {
        logger.error(`[CinematicEnhancer] Failed to deduct credits: ${costErr.message}`);
      }
    }

    let content = response.content[0].text.trim();
    // Strip markdown if accidentally included
    if (content.startsWith("```json")) {
      content = content.substring(7);
    }
    if (content.endsWith("```")) {
      content = content.substring(0, content.length - 3);
    }

    const parsed = JSON.parse(content);
    const data = parsed.cinematicData || parsed;

    // Compile into the strict prompt block
    let finalEnhancedPrompt = `[VISUAL]
[SUBJECT]: ${data.subject || ""}
[ENVIRONMENT]: ${data.environment || ""}
[LIGHTING]: ${data.lighting || ""}
[CAMERA]: ${data.camera || ""}
[MOTION]: ${data.motion || ""}
[MOOD & STYLE]: ${data.mood || ""}, ${data.style || ""}
[ACTION]: ${data.action || ""}`;

    if (data.voiceover) {
      finalEnhancedPrompt += `\n\n[AUDIO]\nVoiceover script (smooth delivery within timeframe): "${data.voiceover}"`;
    }

    logger.info("[CinematicEnhancer] Successfully enhanced prompt for 8s clip");
    return finalEnhancedPrompt;
  } catch (error) {
    await logAndFormatAiError(error, "Anthropic", {
      endpoint: "enhancePromptCinematically",
      userId,
      requestPayload: { prompt },
    });
    logger.error(`[CinematicEnhancer] Failed to enhance prompt: ${error.message}`);
    // Fallback to original prompt if Claude fails
    return prompt;
  }
}
