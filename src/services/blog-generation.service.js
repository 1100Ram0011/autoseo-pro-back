import { GoogleGenerativeAI } from "@google/generative-ai";
import { uploadBase64ToS3 } from "../utils/uploadBase64ToS3.js";
import FirecrawllogModel from "../models/Firecrawllog.model.js";
import crypto from "crypto";
import { overlayLogoOnImage } from "./aiService.js";
import { calculateExecutionCost } from "../utils/costCalculatorblog.js";
import Sharp from "sharp";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);

const textModel = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: {
    responseMimeType: "application/json",
  },
});

// ✅ FIX: Pricing object ko top par global scope mein rakh diya taaki ReferenceError kabhi na aaye
const IMAGE_PRICING_INR = {
  "gemini-2.5-flash-image": 3.5, // Standard Imagen 3 Rate (~$0.03)
  "gemini-2.0-flash-preview-image-generation": 2.0,
};

function safeParseJSON(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

export async function generateTitleSuggestions(analysis, websiteUrl) {
  const { business_overview, services_and_offerings, target_market } = analysis;

  // ─── Firecrawl se page URLs nikalo ───
  let pageUrls = [];
  try {
    const websiteHash = crypto
      .createHash("sha256")
      .update(websiteUrl)
      .digest("hex");
    const log = await FirecrawllogModel.findOne({
      websiteHash,
      status: "success",
    }).lean();

    const links = log?.response?.data?.links || log?.response?.links || [];
    console.log("🔗 Raw links from Firecrawl:", links.slice(0, 5));

    const domain = new URL(websiteUrl).hostname.replace(/^www\./, "");
    pageUrls = links
      .filter((link) => {
        try {
          const linkDomain = new URL(link).hostname.replace(/^www\./, "");
          return linkDomain === domain;
        } catch {
          return false;
        }
      })
      .slice(0, 20);

    console.log("✅ Filtered page URLs:", pageUrls);
  } catch (err) {
    console.warn("⚠️ Could not fetch page URLs:", err.message);
  }

  const prompt = `
You are an SEO blog title expert.
Business: ${business_overview?.company_name || business_overview?.brand_name}
Industry: ${JSON.stringify(business_overview?.industries || [])}
Core Value: ${business_overview?.core_value_proposition}
Target: ${target_market?.primary_customer_segments?.slice(0, 2).join(", ")}
 
Available website pages (pick most relevant URL for each title):
${pageUrls.length > 0 ? pageUrls.join("\n") : websiteUrl}
 
Generate 5 compelling SEO-optimized blog titles.
For each title, pick the MOST relevant page URL from the list above.
If no specific page fits, use: ${websiteUrl}
 
Return ONLY valid JSON array of 5 objects. No explanation. No markdown.
Format:
[
  { "title": "...", "url": "https://..." }
]
`;

  const result = await textModel.generateContent(prompt);
  const usage = result.response.usageMetadata;
  const costBreakdown = calculateExecutionCost(usage, false);
  console.log("\n📊 [TITLES GENERATION] Token Usage Matrix:");
  console.log(`🔹 Input Tokens  (Prompt): ${usage?.promptTokenCount || 0}`);
  console.log(`🔹 Output Tokens (Titles): ${usage?.candidatesTokenCount || 0}`);
  console.log(`🔹 Total Tokens Used     : ${usage?.totalTokenCount || 0}\n`);
  return safeParseJSON(result.response.text());
}

async function generateBlogCoverImage(
  selectedTitle,
  companyName,
  imageLayout = "full-width",
) {
  const models = [
    "gemini-2.5-flash-image",
    "gemini-2.0-flash-preview-image-generation",
  ];

  const layoutInstructions =
    imageLayout === "extra-width"
      ? "ultra-wide cinematic 2.39:1 landscape blog banner"
      : "16:9 landscape blog cover image";

  for (const modelName of models) {
    try {
      console.log(`🖼 Trying model: ${modelName}`);

      const imageGenModel = genAI.getGenerativeModel({ model: modelName });

      const result = await imageGenModel.generateContent({
        contents: [
          {
            role: "user",
            parts: [
              {
                //text: `Professional blog cover image for article titled "${selectedTitle}". Company: ${companyName}. Style: clean, modern, corporate, no text overlay. Dimensions: ${layoutInstructions}.`,
                text: `
Professional modern blog cover image for "${selectedTitle}" by ${companyName}.
 
Requirements:
- ${layoutInstructions}
- horizontal composition
- cinematic wide framing
- clean modern corporate style
- realistic lighting
- website hero banner style
- no text overlay
- high quality
`,
              },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
        },
      });

      const parts = result.response.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find((p) =>
        p.inlineData?.mimeType?.startsWith("image/"),
      );

      if (!imagePart?.inlineData?.data) {
        console.warn(`🖼 ${modelName}: No image in response, trying next...`);
        continue;
      }

      console.log(`✅ Image generated with: ${modelName}`);

      // 1. Get the raw image buffer from Gemini
      const rawBuffer = Buffer.from(imagePart.inlineData.data, "base64");

      // 👇 YEH LOG ADD KIYA HAI: Exact Image Cost in Rupees track karne ke liye
      const exactImageCost = IMAGE_PRICING_INR[modelName] || 2.0;
      console.log("-----------------------------------------");
      console.log(`🎨 [IMAGE GENERATION COST]`);
      console.log(`🔹 Model Triggered : ${modelName}`);
      console.log(`💰 Money Deducted  : ₹${exactImageCost.toFixed(2)} INR`);
      console.log("-----------------------------------------");

      // 2. ✂️ Use Sharp to resize and crop to EXACTLY 1000x420
      const resizedBuffer = await Sharp(rawBuffer)
        .resize({
          width: 1000,
          height: 420,
          fit: "cover", // Ensures it fills the space without squishing or distorting
          position: "center", // Crops from the center if needed
        })
        .toBuffer();

      console.log(`✅ Image successfully resized to 1000x420`);

      // 3. Return the exact sizes you need
      return {
        imageBuffer: resizedBuffer,
        imageBase64: resizedBuffer.toString("base64"),
        mimeType: imagePart.inlineData.mimeType, // usually "image/png" or "image/jpeg"
        exactImageCost: exactImageCost,
      };
    } catch (err) {
      console.warn(`⚠️ ${modelName} failed: ${err.message}`);
    }
  }

  console.warn("🖼 All models failed — no cover image");
  return null;
}

 

export async function generateBlogFromTitle(
  analysis,
  selectedTitle,
  websiteUrl,
  blogPageUrl,
  attachmentPath,
) {
  const { business_overview, services_and_offerings, customer_insights } =
    analysis;

  const isUrlTitle = selectedTitle.startsWith("http");

  // ─── STEP 1: Blog content generate karo ───
  const prompt = `
${isUrlTitle ? `Write a professional blog post based on the topic of this URL: ${selectedTitle}. Create a highly engaging and catchy title for it.` : `Write a professional blog post titled: "${selectedTitle}"`}
Company: ${business_overview?.company_name || business_overview?.brand_name}
Services: ${services_and_offerings?.primary_services?.slice(0, 4).join(", ")}
Pain points addressed: ${customer_insights?.pain_points?.slice(0, 3).join(", ")}
 
Write 1000-1200 words in markdown with H2/H3 headings.
 
${
  websiteUrl
    ? `IMPORTANT: At the end of the blog, add a natural backlink section like:
---
*Learn more about our services at [${business_overview?.company_name || business_overview?.brand_name || "our website"}](${websiteUrl})*`
    : ""
}
 
${
  blogPageUrl && blogPageUrl !== websiteUrl
    ? `Also naturally reference this specific page somewhere in the content: [explore here](${blogPageUrl})`
    : ""
}
 
IMPORTANT RULES:
- Return ONLY valid JSON, nothing else
- No trailing commas
- Escape all quotes inside strings with \"
- Do not use single quotes anywhere
- No newlines inside JSON values, use \\n instead
 
Return in this exact format:
{ "title": "Your Catchy Title Here", "content": "...", "tags": ["tag1","tag2","tag3"], "excerpt": "..." }
`;

  const geminiResult = await textModel.generateContent(prompt);

  // 👇 YEH LOG ADD KAREIN (Full Blog Content ke tokens dekhne ke liye)
  const blogUsage = geminiResult.response.usageMetadata;
  const blogCostBreakdown = calculateExecutionCost(blogUsage, true);
  console.log("\n📊 [BLOG PIPELINE COMPLETE] Final Cost Matrix:");
  console.log(`🔹 Total Text Tokens : ${blogUsage?.totalTokenCount || 0}`);
  console.log(`🔹 Text Generation   : ₹${blogCostBreakdown.textCost}`);
  console.log(`🔹 Image Generation  : ₹${blogCostBreakdown.imageCost}`);
  console.log(`🔥 Total Money Spent : ${blogCostBreakdown.formattedTotal}\n`);

  const text = geminiResult.response.text();
  const clean = text
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  console.log("gemini Result", text);

  // ─── STEP 2: JSON parse karo ───
  let blogResult;
  try {
    blogResult = JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      blogResult = JSON.parse(match[0]);
    } else {
      throw new Error("Gemini returned invalid JSON: " + e.message);
    }
  }

  // ─── STEP 3: Cover image generate karo ───
  // console.log("🖼 Generating cover image for:", selectedTitle);

  // const coverImageResult = await generateBlogCoverImage(
  //   selectedTitle,
  //   business_overview?.company_name || business_overview?.brand_name,
  //   "extra-width",
  // );

  // if (coverImageResult) {
  //   try {
  //     let finalBase64 = coverImageResult.imageBase64; // ✅ work in base64 throughout

  //     // ✅ Only overlay logo if attachmentPath is a fully valid URL
  //     if (
  //       attachmentPath &&
  //       typeof attachmentPath === "string" &&
  //       attachmentPath.startsWith("http") &&
  //       !attachmentPath.includes("undefined")
  //     ) {
  //       console.log("🖼 Overlaying logo on cover image...");
  //       const overlaid = await overlayLogoOnImage(
  //         finalBase64,    // ✅ pass base64 string, NOT Buffer
  //         attachmentPath, // ✅ valid logo URL
  //         "",
  //         "",
  //       );
  //       if (overlaid) {
  //         // normalize — overlayLogoOnImage may return Buffer or base64
  //         finalBase64 = Buffer.isBuffer(overlaid)
  //           ? overlaid.toString("base64")
  //           : overlaid;
  //       }
  //     } else {
  //       console.log(
  //         "🖼 No valid logo URL — skipping overlay. attachmentPath:",
  //         attachmentPath,
  //       );
  //     }

  //     // ✅ Upload final image to S3
  //     const uploadedUrl = await uploadBase64ToS3(finalBase64);
  //     blogResult.coverImage = uploadedUrl;
  //     console.log("🖼 Cover image uploaded:", uploadedUrl);
  //   } catch (imgErr) {
  //     console.error("❌ Cover image processing failed:", imgErr.message);
  //     // Don't throw — blog content is still valid without cover image
  //   }
  // }

  // ─── STEP 3: Cover image generate karo ───
  // ─── STEP 3: Cover image generate karo ───
  console.log("🖼 Generating cover image for:", selectedTitle);

  const coverImageResult = await generateBlogCoverImage(
    selectedTitle,
    business_overview?.company_name || business_overview?.brand_name,
    "extra-width",
  );

  if (coverImageResult) {
    try {
      let finalBase64 = coverImageResult.imageBase64; // Fallback ke liye

      // ✅ Only overlay logo if attachmentPath is a fully valid URL
      if (
        attachmentPath &&
        typeof attachmentPath === "string" &&
        attachmentPath.startsWith("http")
      ) {
        console.log("🖼 Overlaying logo on cover image...");

        // 👇 FIX: finalBase64 string ki jagah binary imageBuffer pass karein
        const overlaid = await overlayLogoOnImage(
          coverImageResult.imageBuffer, // 👈 Changed from finalBase64 to imageBuffer
          [attachmentPath],
          null,
          null,
        );

        if (overlaid) {
          // normalize — overlayLogoOnImage may return Buffer or base64
          finalBase64 = Buffer.isBuffer(overlaid)
            ? overlaid.toString("base64")
            : overlaid;
        }
      } else {
        console.log(
          "🖼 No valid logo URL — skipping overlay. attachmentPath:",
          attachmentPath,
        );
      }

      // ✅ Upload final image to S3
      const uploadedUrl = await uploadBase64ToS3(finalBase64);
      blogResult.coverImage = uploadedUrl;
      console.log("🖼 Cover image uploaded:", uploadedUrl);
    } catch (imgErr) {
      console.error("❌ Cover image processing failed:", imgErr.message);
      // Don't throw — blog content is still valid without cover image
    }
  }

  // ─── STEP 4: Return ───
// ─── STEP 4: Return object at the end of generateBlogFromTitle ───
return {
  blogContentCost: blogCostBreakdown.textCost,
  blogImageCost: (coverImageResult?.exactImageCost || 0) * 13, // ✅ Safe access + proper multiplier
  blogResult,
};
  // return blogResult;
}
