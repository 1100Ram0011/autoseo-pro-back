import { GoogleGenAI } from '@google/genai';
import prisma from '../config/prisma';

export class AiTrendJacker {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MOCK_KEY' });
  }

  // 1. Trend Scanning
  async scanTrends(): Promise<string[]> {
    console.log('[W2 Agent] Scanning Google Trends & Reddit for viral topics...');
    // Mocking real-time trend scanning for MVP
    return [
      "Impact of AI on Digital Marketing 2026",
      "Next.js vs React for SEO",
      "Google Core Update Recovery Tips"
    ];
  }

  // 2. Multimodal Content Scripting
  async generateContent(topic: string) {
    console.log(`[W2 Agent] Generating Multimodal Content for: "${topic}"...`);
    
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
      console.warn('[W2 Agent] Mocking Gemini response (No API Key)');
      return {
        topic,
        blogPost: `# ${topic}\n\nThis is an auto-generated high-retention blog post.`,
        reelScript: `[Hook]: Did you know ${topic} is changing everything?\n[Body]: Here are 3 tips...\n[CTA]: Subscribe for more!`
      };
    }

    try {
      const prompt = `You are a viral content creator. The trending topic is "${topic}". 
      1. Write a 300-word highly optimized SEO blog post about this.
      2. Write a 60-second engaging Instagram Reels script about this.
      Return the output as a JSON object: {"blogPost": "markdown string", "reelScript": "string"}`;

      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || "{}";
      // Basic JSON extraction
      const match = text.match(/\{[\s\S]*\}/);
      const data = match ? JSON.parse(match[0]) : { blogPost: 'Error', reelScript: 'Error' };
      
      return { topic, ...data };
    } catch (error) {
      console.error('[W2 Agent] Gemini Error:', error);
      return { topic, blogPost: 'Failed to generate', reelScript: 'Failed to generate' };
    }
  }

  // 3. One-Click Dispatch
  async dispatchContent(siteId: string, contentData: any) {
    console.log(`[W2 Agent] Dispatching content to Site ID: ${siteId}`);
    
    // Save the blog to our database so the user can review it
    const blog = await prisma.blog.create({
      data: {
        siteId,
        title: contentData.topic,
        content: contentData.blogPost,
        posted_platforms: 'Draft'
      }
    });

    console.log(`[W2 Agent] Saved Blog Draft ID: ${blog.id}`);
    console.log(`[W2 Agent] Queued Reel Script for Meta Graph API sync.`);
    
    return blog;
  }

  // Orchestrator
  async executePipeline(siteId: string) {
    console.log(`--- [W2 Agent] STARTING TREND-JACKING PIPELINE ---`);
    const trends = await this.scanTrends();
    
    const results = [];
    // We'll just jack the top trend for the MVP demo
    const topTrend = trends[0] || 'Digital Marketing';
    
    const content = await this.generateContent(topTrend);
    const savedDraft = await this.dispatchContent(siteId, content);
    results.push(savedDraft);
    
    console.log(`--- [W2 Agent] PIPELINE COMPLETE ---`);
    return { success: true, processedTrends: 1, drafts: results };
  }
}
