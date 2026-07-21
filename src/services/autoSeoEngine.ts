import { EventEmitter } from 'events';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import * as cheerio from 'cheerio';
import prisma from '../config/prisma';
import { getGa4Overview } from './ga4';
import { getGscOverview, getGscKeywords } from './gsc';
import { runFullAnalysis } from './pagespeed';
import { MOCK_GA4, MOCK_GSC, generateMockPageSpeed } from '../config/mockData';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || 'MOCK_KEY' });

// Global event emitter for SSE
export const autoSeoEmitter = new EventEmitter();

export class AutoSeoEngine {
  private reportId: string;
  private siteId: string;
  private userId: string;
  private url: string;

  constructor(reportId: string, siteId: string, userId: string, url: string) {
    this.reportId = reportId;
    this.siteId = siteId;
    this.userId = userId;
    this.url = url;
  }

  private emit(step: string, status: string, message: string) {
    autoSeoEmitter.emit(`update-${this.reportId}`, { step, status, message });
  }

  private async generateAiReport(prompt: string): Promise<string> {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'MOCK_KEY') {
      await new Promise(r => setTimeout(r, 2000)); // Simulate delay
      return `Mock AI Report for: ${prompt.substring(0, 50)}...\n\n- Ensure tags are optimized.\n- Improve page speed.\n- Fix broken links.`;
    }

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-pro',
        contents: prompt
      });
      return response.text || "No report generated.";
    } catch (error) {
      console.error("Gemini Error:", error);
      return "Error generating AI report.";
    }
  }

  public async runScan() {
    try {
      // 1. Initializing
      this.emit('init', 'running', 'Initializing Auto SEO scan...');
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { status: 'InProgress' }
      });
      this.emit('init', 'completed', 'Initialized successfully.');

      // 2. Google Analytics
      this.emit('ga', 'running', 'Fetching Google Analytics data & generating AI report...');
      let gaData: any = MOCK_GA4.overview;
      try {
        const site = await prisma.site.findUnique({ where: { id: this.siteId } });
        if (site?.ga4PropertyId) {
          gaData = await getGa4Overview(site.ga4PropertyId, this.userId) || MOCK_GA4.overview;
        }
      } catch (e) {
        console.warn('GA4 fetch failed, using mock data', e);
      }
      const gaReport = await this.generateAiReport(`Analyze this Google Analytics data for ${this.url} and provide a comprehensive report and solutions for improvement. Data: ${JSON.stringify(gaData)}`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { gaData: JSON.stringify(gaData), gaReport }
      });
      this.emit('ga', 'completed', 'GA analysis complete.');

      // 3. Google Search Console
      this.emit('gsc', 'running', 'Fetching Google Search Console data & generating AI report...');
      let gscData: any = MOCK_GSC.overview;
      try {
        const site = await prisma.site.findUnique({ where: { id: this.siteId } });
        const gscUrl = site?.gscPropertyId || this.url;
        gscData = await getGscOverview(gscUrl, this.userId) || MOCK_GSC.overview;
      } catch (e) {
        console.warn('GSC overview fetch failed, using mock data', e);
      }
      const gscReport = await this.generateAiReport(`Analyze this Google Search Console data for ${this.url} and provide a comprehensive report and SEO solutions. Data: ${JSON.stringify(gscData)}`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { gscData: JSON.stringify(gscData), gscReport }
      });
      this.emit('gsc', 'completed', 'GSC analysis complete.');

      // 4. Robots & Sitemap
      this.emit('robots', 'running', 'Fetching Robots.txt & Sitemap & generating AI report...');
      let robotsContent = '';
      try {
        const parsedUrl = new URL(this.url);
        const robotsUrl = `${parsedUrl.origin}/robots.txt`;
        const res = await axios.get(robotsUrl, { timeout: 5000 });
        robotsContent = res.data;
      } catch (e) {
        robotsContent = "Could not fetch robots.txt";
      }
      const robotsReport = await this.generateAiReport(`Analyze this robots.txt and sitemap context for ${this.url} and provide solutions. Robots content: \n${robotsContent}`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { robotsData: JSON.stringify({ robots: robotsContent }), robotsReport }
      });
      this.emit('robots', 'completed', 'Robots & Sitemap analysis complete.');

      // 5. Keywords
      this.emit('keywords', 'running', 'Analyzing keyword data & generating AI report...');
      let keywordsData: any = MOCK_GSC.keywords.keywords.slice(0, 5);
      try {
        const site = await prisma.site.findUnique({ where: { id: this.siteId } });
        const gscUrl = site?.gscPropertyId || this.url;
        const gscKeywordsRes = await getGscKeywords(gscUrl, this.userId, this.siteId);
        if (gscKeywordsRes?.keywords?.length > 0) {
          keywordsData = gscKeywordsRes.keywords.slice(0, 10);
        }
      } catch (e) {
        console.warn('GSC keywords fetch failed, using mock data', e);
      }
      const keywordReport = await this.generateAiReport(`Analyze these ranking keywords for ${this.url} and provide content ideas and solutions to improve rankings. Keywords: ${JSON.stringify(keywordsData)}`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { keywordData: JSON.stringify(keywordsData), keywordReport }
      });
      this.emit('keywords', 'completed', 'Keyword analysis complete.');

      // 6. Lighthouse
      this.emit('lighthouse', 'running', 'Running Lighthouse audit & generating AI solutions...');
      let lhData: any = generateMockPageSpeed(this.url, 'mobile');
      try {
        if (process.env.PAGESPEED_API_KEY && process.env.PAGESPEED_API_KEY !== 'MOCK_KEY') {
           lhData = await runFullAnalysis(this.url);
        }
      } catch (e) {
        console.warn('Lighthouse fetch failed, using mock data', e);
      }
      const lighthouseReport = await this.generateAiReport(`Analyze this Lighthouse performance data for ${this.url} and provide specific technical solutions for each metric. Data: ${JSON.stringify(lhData)}`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { lighthouseData: JSON.stringify(lhData), lighthouseReport }
      });
      this.emit('lighthouse', 'completed', 'Lighthouse analysis complete.');

      // 7. Overall Summary
      this.emit('summary', 'running', 'Generating comprehensive final summary...');
      const overallSummary = await this.generateAiReport(`You are an expert SEO consultant. Create a final, comprehensive executive summary for ${this.url} based on the fact that GA, GSC, Keywords, and Lighthouse have been analyzed. Highlight the top 3 most critical action items.`);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { overallSummary, status: 'Completed' }
      });
      this.emit('summary', 'completed', 'Scan finished successfully.');

    } catch (error) {
      console.error("Auto SEO Scan Error:", error);
      await prisma.autoSeoReport.update({
        where: { id: this.reportId },
        data: { status: 'Failed' }
      });
      this.emit('error', 'failed', 'An error occurred during the scan.');
    }
  }
}
