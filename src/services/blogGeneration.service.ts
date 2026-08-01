import { GoogleGenAI } from '@google/genai';
import prisma from '../config/prisma';
import crypto from 'crypto';

const ai = new GoogleGenAI({ apiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || "") });

function safeParseJSON(text: string) {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const match = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e;
  }
}

export async function generateTitleSuggestions(siteId: string) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { keywords: true }
  });

  if (!site) throw new Error("Site not found");

  const keywordsStr = site.keywords.map(k => k.keyword).join(', ');

  const prompt = `
You are an SEO blog title expert.
Website: ${site.url}
Keywords to target: ${keywordsStr || "general SEO, marketing"}

Generate 5 compelling SEO-optimized blog titles for this website.
For each title, assign the most relevant URL. If no specific page fits, use: ${site.url}
 
Return ONLY valid JSON array of 5 objects. No explanation. No markdown.
Format:
[
  { "title": "...", "url": "https://..." }
]
`;

  const result = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt
  });
  
  return safeParseJSON((result as any).text || "");
}

export async function generateBlogFromTitle(
  siteId: string,
  selectedTitle: string,
  blogPageUrl?: string
) {
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    include: { keywords: true }
  });

  if (!site) throw new Error("Site not found");
  const keywordsStr = site.keywords.map(k => k.keyword).join(', ');
  const isUrlTitle = selectedTitle.startsWith("http");

  const prompt = `
${isUrlTitle ? `Write a professional blog post based on the topic of this URL: ${selectedTitle}. Create a highly engaging and catchy title for it.` : `Write a professional blog post titled: "${selectedTitle}"`}
Website Context: ${site.url}
Target SEO Keywords: ${keywordsStr}
 
Write 1000-1200 words in markdown with H2/H3 headings.
 
IMPORTANT: At the end of the blog, add a natural backlink section like:
---
*Learn more at [our website](${site.url})*
 
${blogPageUrl && blogPageUrl !== site.url ? `Also naturally reference this specific page somewhere in the content: [explore here](${blogPageUrl})` : ""}
 
IMPORTANT RULES:
- Return ONLY valid JSON, nothing else
- No trailing commas
- Escape all quotes inside strings with \\"
- Do not use single quotes anywhere
- No newlines inside JSON values, use \\n instead
 
Return in this exact format:
{ "title": "Your Catchy Title Here", "content": "...", "tags": ["tag1","tag2","tag3"], "excerpt": "..." }
`;

  const geminiResult = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt
  });

  const text = (geminiResult as any).text || "";
  let blogResult;
  try {
    blogResult = safeParseJSON(text);
  } catch (e: any) {
    throw new Error("Gemini returned invalid JSON: " + e.message);
  }

  return { blogResult };
}
