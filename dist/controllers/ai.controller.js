"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateAiChat = exports.generateAiAnalysis = exports.generateAiSchema = exports.generateAiBlog = exports.generateAiKeywords = void 0;
const genai_1 = require("@google/genai");
const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MOCK_KEY' });
const generateAiKeywords = async (req, res) => {
    const { topic } = req.body;
    if (!topic)
        return res.status(400).json({ error: 'Topic is required' });
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(resolve => setTimeout(resolve, 1500));
            return res.json({
                keywords: [
                    { keyword: `best ${topic}`, volume: 12000, difficulty: 'Medium' },
                    { keyword: `${topic} tools`, volume: 5400, difficulty: 'Low' },
                    { keyword: `how to use ${topic}`, volume: 8900, difficulty: 'High' },
                    { keyword: `free ${topic} software`, volume: 3200, difficulty: 'Low' },
                ]
            });
        }
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate 5 SEO keyword ideas for the topic: "${topic}". Return ONLY a JSON array of objects with "keyword" (string), "volume" (number, realistic estimate), and "difficulty" (string: Low/Medium/High). Do not include markdown codeblocks like \`\`\`json. Just the raw JSON array.`
        });
        const text = response.text || "[]";
        const keywords = JSON.parse(text);
        res.json({ keywords });
    }
    catch (error) {
        console.error('Gemini Error:', error);
        res.status(500).json({ error: 'Failed to generate keywords' });
    }
};
exports.generateAiKeywords = generateAiKeywords;
const generateAiBlog = async (req, res) => {
    const { keyword } = req.body;
    if (!keyword)
        return res.status(400).json({ error: 'Keyword is required' });
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return res.json({
                post: `# The Ultimate Guide to ${keyword}\n\nThis is a mock blog post generated because a valid Gemini API key was not found in the \`.env\` file.\n\n## Why is ${keyword} important?\nIt helps with SEO and engaging your audience.\n\n## Top 3 Tips\n1. Be consistent.\n2. Write for humans, optimize for bots.\n3. Keep paragraphs short.\n\n> This is a blockquote about the topic.\n\nHappy ranking!`
            });
        }
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro', // Using pro for longer, better content
            contents: `You are an expert SEO copywriter. Write a comprehensive, highly-engaging, EEAT-optimized blog post targeting the primary keyword: "${keyword}". The blog post should be in Markdown format, with proper H1, H2, H3 tags, bullet points, and a conclusion. Ensure it reads naturally and is highly valuable to the reader. Do not include a meta description or title tag, just the markdown body starting with an H1.`
        });
        const post = response.text || "Failed to generate content.";
        res.json({ post });
    }
    catch (error) {
        console.error('Gemini Blog Error:', error);
        res.status(500).json({ error: 'Failed to generate blog post' });
    }
};
exports.generateAiBlog = generateAiBlog;
const generateAiSchema = async (req, res) => {
    const { topic, type = 'FAQPage' } = req.body;
    if (!topic)
        return res.status(400).json({ error: 'Topic is required' });
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(resolve => setTimeout(resolve, 1500));
            return res.json({
                schema: {
                    "@context": "https://schema.org",
                    "@type": "FAQPage",
                    "mainEntity": [{
                            "@type": "Question",
                            "name": `What is ${topic}?`,
                            "acceptedAnswer": {
                                "@type": "Answer",
                                "text": `This is a mock schema for ${topic}.`
                            }
                        }]
                }
            });
        }
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a valid JSON-LD Schema of type ${type} for the topic: "${topic}". Return ONLY the raw JSON object, without any markdown formatting, backticks, or extra text.`
        });
        const text = response.text || "{}";
        let schema;
        try {
            schema = JSON.parse(text);
        }
        catch (e) {
            // If it has markdown, try to strip it
            const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
            schema = JSON.parse(cleanText);
        }
        res.json({ schema });
    }
    catch (error) {
        console.error('Gemini Schema Error:', error);
        res.status(500).json({ error: 'Failed to generate schema' });
    }
};
exports.generateAiSchema = generateAiSchema;
const generateAiAnalysis = async (req, res) => {
    const { siteUrl, data } = req.body;
    if (!data)
        return res.status(400).json({ error: 'Dashboard data is required' });
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(resolve => setTimeout(resolve, 3000));
            return res.json({
                analysis: {
                    overallHealthScore: 78,
                    summary: `Based on the provided data for ${siteUrl || 'your site'}, the overall SEO and performance are moderate. There are some critical technical issues blocking optimal indexing, and the core web vitals need improvement, especially regarding mobile load times.`,
                    keyFindings: [
                        { title: "Traffic is Stable", description: "You have maintained steady visitor numbers this week with slight positive growth." },
                        { title: "High Number of Unindexed Pages", description: "A significant portion of your pages are not indexed by Google, which means they are not receiving organic traffic." },
                        { title: "Performance Issues", description: "PageSpeed Insights shows a low score, largely due to unoptimized images and render-blocking scripts." }
                    ],
                    actionPlan: [
                        { task: "Compress all hero images on the homepage", priority: "High", impact: "Improves LCP and PageSpeed score significantly." },
                        { task: "Check Google Search Console for coverage errors", priority: "High", impact: "Fixes the high number of unindexed pages." },
                        { task: "Publish new content targeting long-tail keywords", priority: "Medium", impact: "Capitalizes on stable traffic to drive more targeted users." }
                    ]
                }
            });
        }
        // Minify data to prevent blowing up token limit
        const minifiedData = JSON.stringify({
            metrics: data.metrics,
            healthReport: data.healthReport,
            roadmap: data.roadmap,
            keywords: data.keywordTrend?.slice(0, 5) || [],
        });
        const prompt = `
      Act as an expert SEO and Data Analyst. Analyze the following Google Search Console, Google Analytics, and PageSpeed Insights data for the website ${siteUrl || "the user's site"}.
      
      Data:
      ${minifiedData}
      
      Generate a structured JSON response containing:
      1. "overallHealthScore": A number (0-100) representing your expert assessment of their current state.
      2. "summary": A concise paragraph summarizing the site's current state and main opportunities.
      3. "keyFindings": An array of objects with 'title' (string) and 'description' (string) highlighting the 3-4 most important positive or negative insights.
      4. "actionPlan": An array of objects with 'task' (string), 'priority' (string: High/Medium/Low), and 'impact' (string) detailing step-by-step actions they should take right now.
      
      Do not include markdown tags like \`\`\`json. Just return the raw JSON object.
    `;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        const text = response.text || "{}";
        let analysis;
        try {
            analysis = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
        }
        catch (e) {
            analysis = { summary: "Failed to parse AI response. " + text, overallHealthScore: 0, keyFindings: [], actionPlan: [] };
        }
        res.json({ analysis });
    }
    catch (error) {
        console.error('Gemini Analysis Error:', error);
        res.status(500).json({ error: 'Failed to generate analysis' });
    }
};
exports.generateAiAnalysis = generateAiAnalysis;
const generateAiChat = async (req, res) => {
    const { message, context } = req.body;
    if (!message)
        return res.status(400).json({ error: 'Message is required' });
    try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return res.json({ reply: 'This is a mock response because GEMINI_API_KEY is not set.' });
        }
        const prompt = `You are an expert AI SEO Copilot for AutoSEO Pro.
User message: "${message}"
Context (if any): ${JSON.stringify(context || {})}
Please provide a helpful, concise, and actionable SEO response.`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        res.json({ reply: response.text });
    }
    catch (error) {
        console.error('Gemini Chat Error:', error);
        res.status(500).json({ error: 'Failed to generate chat response' });
    }
};
exports.generateAiChat = generateAiChat;
//# sourceMappingURL=ai.controller.js.map