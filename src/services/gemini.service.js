


// const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// const model = genAI.getGenerativeModel({
//     model: "gemini-1.5-flash"
// });


export const analyzeWebsite = async (scrapeData, userId) => {
    try {

        if (!scrapeData?.response?.data) {
            throw new Error("Invalid scrape data");
        }

        const cleanData = {
            markdown: scrapeData.response.data.markdown,
            branding: scrapeData.response.data.branding,
            metadata: scrapeData.response.data.metadata,
            summary: scrapeData.response.data.summary,
            links: scrapeData.response.data.links?.slice(0, 30)
        };

        const prompt = `
SYSTEM:
${systemPrompt}

USER INPUT:
Analyze this website scrape data and generate a structured brand profile.

${JSON.stringify(cleanData)}
`;

        const result = await callGemini(prompt, systemPrompt)

        console.log('response', result)

        const response = result.response;
        const responseText = response.candidates[0].content.parts[0].text;
        console.log("Gemini Response:", responseText);

        const structuredData = extractJSON(responseText);

        if (!structuredData) {
            throw new Error("Failed to parse Gemini response");
        }

        const savedProfile = await BrandProfile.create({
            userId,
            websiteUrl: scrapeData.websiteUrl,
            websiteHash: scrapeData.websiteHash,
            ...structuredData
        });

        return savedProfile;

    } catch (error) {
        console.error("Gemini Analyze Error:", error.message);
        throw error;
    }
};
function extractJSON(text) {

    try {

        const match = text.match(/\{[\s\S]*\}/);

        if (!match) return null;

        return JSON.parse(match[0]);

    } catch (error) {
        return null;
    }

}



// import axios from "axios";
// import BrandProfile from "../../models/BrandProfile.js";

import { BRAND_PROFILE_PROMPT } from "../prompts/systemPrompts.js";
import BrandProfile from "../models/BrandProfile.js";
import axios from "axios";



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
            summary: firecrawlData?.response?.data?.summary
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
                                    scraped_website_data: cleanedData
                                })
                            }
                        ]
                    }
                ]
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01"
                },
                timeout: 120000
            }
        );

        const text = response.data?.content?.[0]?.text || "";

        console.log('generation result', text)

        const parsed = cleanClaudeJSON(text);
        console.log('parsed data', parsed)

        const saved = await BrandProfile.create({
            userId,
            websiteUrl: firecrawlData?.websiteUrl,
            websiteHash: firecrawlData?.websiteHash,
            ...parsed
        });

        return saved;

    } catch (error) {

        console.error("Claude analyze error:", error?.response?.data || error.message);

        throw error;

    }
}

