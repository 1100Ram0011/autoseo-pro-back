import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { google } from 'googleapis';

export const getGa4Overview = async (req: Request, res: Response) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const user = await prisma.user.findUnique({ where: { id: site.userId } });
    if (!user || !user.googleRefreshToken) {
      return res.status(400).json({ error: 'Google Analytics not connected. Please connect first.' });
    }

    const tempClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    tempClient.setCredentials({ refresh_token: user.googleRefreshToken });

    const propertyId = (site as any).ga4PropertyId;
    if (!propertyId) return res.status(400).json({ error: 'No GA4 Property ID linked' });

    const { getAnalyticsData, formatAnalytics } = require('../services/ga4');

    // Default range is weekly
    const range = (req.query.range as string) || "weekly";

    const rawData = await getAnalyticsData(propertyId, tempClient, range);
    const formattedData = formatAnalytics(rawData);

    res.json(formattedData);
  } catch (error: any) {
    console.error("GA4 Overview Error:", error.message);
    res.status(500).json({ error: 'Failed to fetch GA4 overview' });
  }
};

export const getGa4Pages = async (req: Request, res: Response) => {
  try {
    const site = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const user = await prisma.user.findUnique({ where: { id: site.userId } });
    if (!user || !user.googleRefreshToken) {
      return res.status(400).json({ error: 'Google Analytics not connected. Please connect first.' });
    }

    const tempClient = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    tempClient.setCredentials({ refresh_token: user.googleRefreshToken });

    const propertyId = (site as any).ga4PropertyId;
    if (!propertyId) return res.status(400).json({ error: 'No GA4 Property ID linked' });

    const { getAnalyticsData, formatAnalytics } = require('../services/ga4');
    const rawData = await getAnalyticsData(propertyId, tempClient, 'monthly'); // Fetch monthly for more URLs
    const formattedData = formatAnalytics(rawData);

    // Sync URLs to database so they can be audited
    const topPages = formattedData.topPages || [];
    let addedCount = 0;
    for (const p of topPages) {
      // Remove query parameters to get clean URL
      // NOTE: formatAnalytics returns `page`, not `path` — this previously threw
      // "Cannot read properties of undefined" on every real request.
      const cleanPath = p.page.split('?')[0].split('#')[0];
      const fullUrl = new URL(cleanPath, site.url).href;

      const exists = await prisma.page.findFirst({ where: { siteId: site.id, url: fullUrl } });
      if (!exists) {
        await prisma.page.create({
          data: {
            siteId: site.id,
            url: fullUrl
          }
        });
        addedCount++;
      }
    }

    res.json({ message: 'Synced GA4 pages', addedCount, topPages });
  } catch (error: any) {
    console.error("GA4 Pages Error:", error.message);
    res.status(500).json({ error: 'Failed to fetch and sync GA4 pages' });
  }
};

export const getAnalytics = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;

    // Check if user is connected to Google
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    let isGoogleConnected = false;

    if (site) {
      const user = await prisma.user.findUnique({ where: { id: site.userId } });
      isGoogleConnected = !!user?.googleRefreshToken;
    }

    // Total pages crawled
    const pagesCount = await prisma.page.count({ where: { siteId } });

    // Total indexed (mocked logic or based on GSC)
    const indexedPages = await prisma.page.count({ where: { siteId, indexed: true } });

    // Total keywords (mocked to 0 if none)
    const keywordsCount = await prisma.keyword.count({ where: { siteId } });

    // Visitors in last 7 days
    const visitorsCount = await prisma.visitor.count({
      where: {
        siteId,
        createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    });

    res.json({
      pages: pagesCount,
      indexed: indexedPages > 0 ? indexedPages : Math.floor(pagesCount * 0.8), // mock 80% indexed if not tested
      keywords: keywordsCount,
      visitors: visitorsCount,
      isGoogleConnected
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

export const trackVisitor = async (req: Request, res: Response) => {
  const { siteId, path, referrer } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  try {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    await prisma.visitor.create({
      data: {
        siteId,
        ip: String(ip),
        city: 'New York', // Mocked for USA MVP
        country: 'USA',
        source: referrer || 'Direct',
      }
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Tracking Error:', error);
    res.status(500).json({ error: 'Failed to track visitor' });
  }
};