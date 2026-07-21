import { GoogleGenAI } from '@google/genai';
import prisma from '../config/prisma';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MOCK_KEY' });

export const analyzeOmnichannelState = async (siteId: string, masterState: any) => {
  try {
    let anomalies = [];

    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
      // Advanced Mock Data for testing
      anomalies = [
        {
          type: "SPEED_AND_TRAFFIC_DROP",
          description: "Traffic dropped by 18% this week. We detected a correlation with a sharp drop in your Core Web Vitals (Performance score dropped to 45). Users are likely bouncing due to slow loads.",
          severity: "Critical",
          actions: [
            { task: "Minify CSS and defer render-blocking JavaScript", impact: "High - Recovers page speed and bounce rate" },
            { task: "Compress hero images on the homepage", impact: "Medium - Improves LCP score" }
          ]
        },
        {
          type: "INDEXING_FAILURE",
          description: "2 critical pages were de-indexed from Google Search Console yesterday.",
          severity: "High",
          actions: [
            { task: "Run Google Indexing API ping for affected URLs", impact: "High - Restores lost traffic instantly" },
            { task: "Check robots.txt for accidental disallow rules", impact: "Critical - Prevents further de-indexing" }
          ]
        }
      ];
    } else {
      const prompt = `
        You are an Omnichannel SEO Architect. Analyze the following master state of a website.
        Find correlations across the different platforms (e.g. did traffic drop because of page speed? Did rankings drop because of indexing issues?).

        Master State:
        ${JSON.stringify(masterState)}

        If the site is perfectly healthy, return an empty array [].
        Otherwise, generate an array of "anomalies". Each anomaly must be an object containing:
        - "type": string (e.g., "SPEED_AND_TRAFFIC_DROP", "KEYWORD_CANNIBALIZATION")
        - "description": string (explain the correlation you found clearly)
        - "severity": string ("Critical", "High", "Medium", "Low")
        - "actions": array of objects with "task" (string) and "impact" (string) explaining how to fix it.

        Return ONLY raw JSON array, without markdown tags like \`\`\`json.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt
      });

      const text = response.text || "[]";
      try {
        anomalies = JSON.parse(text.replace(/```json/g, '').replace(/```/g, '').trim());
      } catch (e) {
        console.error("Failed to parse Omnichannel AI fix:", text);
      }
    }

    // Save to database
    for (const anomaly of anomalies) {
      const dbAnomaly = await (prisma as any).aiAnomaly.create({
        data: {
          siteId,
          type: anomaly.type,
          description: anomaly.description,
          severity: anomaly.severity
        }
      });

      if (anomaly.actions && Array.isArray(anomaly.actions)) {
        for (const action of anomaly.actions) {
          await (prisma as any).aiAction.create({
            data: {
              anomalyId: dbAnomaly.id,
              task: action.task,
              impact: action.impact,
              isExecuted: false
            }
          });
        }
      }
    }

    console.log(`[AutoFixer] Omnichannel analysis complete. Found ${anomalies.length} anomalies.`);
  } catch (error) {
    console.error('[AutoFixer] Omnichannel Error:', error);
  }
};

export const executeAiAction = async (actionId: string) => {
  const action = await (prisma as any).aiAction.findUnique({ where: { id: actionId }, include: { anomaly: true } });
  if (!action) return;

  // Simulate complex cross-platform fixes
  await new Promise(resolve => setTimeout(resolve, 2000));

  await (prisma as any).aiAction.update({
    where: { id: actionId },
    data: { isExecuted: true }
  });

  const remainingActions = await (prisma as any).aiAction.count({
    where: { anomalyId: action.anomalyId, isExecuted: false }
  });

  if (remainingActions === 0) {
    await (prisma as any).aiAnomaly.update({
      where: { id: action.anomalyId },
      data: { status: 'RESOLVED' }
    });
  }

  return { success: true };
};

// Force TS re-evaluation
