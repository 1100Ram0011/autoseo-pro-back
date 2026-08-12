import Anthropic from "@anthropic-ai/sdk";
import axios from "axios";
import { calculateCost } from "./claudPricingCalculate.js";
import { deductDynamicCredit } from "./creditTracker.js";
import { logAndFormatAiError } from "./aiErrorHandler.js";

export async function describeCharacterWithClaude(imageUrls, userId) {
  try {
    if (!imageUrls || imageUrls.length === 0 || !userId) return null;

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Download images and convert to base64
    const imageContents = await Promise.all(
      imageUrls.map(async (url) => {
        try {
          const response = await axios.get(url, { responseType: "arraybuffer" });
          const buffer = Buffer.from(response.data, "binary");
          const base64 = buffer.toString("base64");
          const mimeType = response.headers["content-type"] || "image/jpeg";
          
          // Anthropic requires specific media types
          const allowedMimeTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
          const finalMimeType = allowedMimeTypes.includes(mimeType) ? mimeType : "image/jpeg";

          return {
            type: "image",
            source: {
              type: "base64",
              media_type: finalMimeType,
              data: base64,
            },
          };
        } catch (err) {
          console.error(`Failed to fetch image ${url} for Claude Vision:`, err.message);
          return null;
        }
      })
    );

    const validImageContents = imageContents.filter(Boolean);
    if (validImageContents.length === 0) return null;

    const promptText = {
      type: "text",
      text: "Analyze these reference images of the subject. Provide a highly detailed, concise visual description of the subject's face, body type, clothing, and distinct physical features. This description will be used to enforce character consistency in a video generation AI. Only output the description without any conversational filler, starting directly with the physical attributes.",
    };

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: [...validImageContents, promptText],
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
            serviceName: "characterDescription",
            description: `Character Description | ${cost.formatted}`,
            metadata: { source: "describeCharacterWithClaude" }
          });
        }
      } catch (costErr) {
        console.error("Failed to deduct credits for Claude Character Description:", costErr.message);
      }
    }

    return response.content[0].text;
  } catch (error) {
    const formattedError = await logAndFormatAiError(error, "Anthropic", {
      endpoint: "describeCharacterWithClaude",
      userId,
      requestPayload: { imageUrlsCount: imageUrls?.length },
    });
    console.error("Error generating character description with Claude:", formattedError.userMessage);
    return null;
  }
}
