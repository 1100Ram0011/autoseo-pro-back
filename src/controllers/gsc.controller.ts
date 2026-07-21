import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { google } from 'googleapis';
import { getGscOverview, getGscKeywords, getGscPages, getGscCoverage, getGscCountries, getGscDevices, getGscQuery, getGscSitemaps, inspectUrl, getGscSites, analyzeInsights } from '../services/gsc';

export const getOverview = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscOverview(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC overview' });
  }
};

export const getKeywords = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscKeywords(site.gscPropertyId || site.url, site.userId, site.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC keywords' });
  }
};

export const getPages = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscPages(site.gscPropertyId || site.url, site.userId, site.id);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC pages' });
  }
};

export const getCoverage = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscCoverage(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC coverage' });
  }
};

export const getCountries = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscCountries(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC countries' });
  }
};

export const getDevices = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscDevices(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC devices' });
  }
};

export const getQuery = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { startDate, endDate, dimensions, rowLimit, dimensionFilterGroups } = req.body;
    const data = await getGscQuery(site.gscPropertyId || site.url, site.userId, { startDate, endDate, dimensions, rowLimit, dimensionFilterGroups });
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to execute GSC dynamic query' });
  }
};

export const getSitemaps = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await getGscSitemaps(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC sitemaps' });
  }
};

export const inspectUrlEndpoint = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const data = await inspectUrl(site.gscPropertyId || site.url, url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to inspect URL' });
  }
};

export const getInsights = async (req: Request, res: Response) => {
  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.id as string } });
    if (!site) return res.status(404).json({ error: 'Site not found' });
    const data = await analyzeInsights(site.gscPropertyId || site.url, site.userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to analyze GSC insights' });
  }
};

export const getSitesList = async (req: Request, res: Response) => {
  const userId = req.query.userId as string || '1';
  try {
    const data = await getGscSites(userId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch GSC sites' });
  }
};

export const getFullSeoGsc = async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'No authorization token' });

  const accessToken = authHeader.split(' ')[1] || null;

  try {
    const site: any = await prisma.site.findUnique({ where: { id: req.params.siteId as string } });
    if (!site) return res.status(404).send('Site not found');

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: accessToken });

    const sc = google.searchconsole({ version: 'v1', auth: oauth2Client });

    const today = new Date();
    const ago28 = new Date(today.getTime() - 28 * 24 * 60 * 60 * 1000);
    const ago90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
    const startDate28 = ago28.toISOString().split('T')[0];
    const endDate   = today.toISOString().split('T')[0];
    const startDate90 = ago90.toISOString().split('T')[0];

    const base = { siteUrl: site.gscPropertyId || site.url, requestBody: { startDate: startDate28, endDate, rowLimit: 25 } };

    // Run all 5 queries in parallel
    const [queries, pages, countries, devices, dates] = await Promise.all([
      (sc.searchanalytics.query as any)({ ...base, requestBody: { ...base.requestBody, dimensions: ['query'] as any } }),
      (sc.searchanalytics.query as any)({ ...base, requestBody: { ...base.requestBody, dimensions: ['page'] as any } }),
      (sc.searchanalytics.query as any)({ ...base, requestBody: { ...base.requestBody, dimensions: ['country'] as any } }),
      (sc.searchanalytics.query as any)({ ...base, requestBody: { ...base.requestBody, dimensions: ['device'] as any } }),
      (sc.searchanalytics.query as any)({ siteUrl: site.gscPropertyId || site.url, requestBody: { startDate: startDate90, endDate, dimensions: ['date'] as any, rowLimit: 90 } }),
    ]);

    // Summary totals from queries
    const allRows = queries.data.rows || [];
    const totalClicks = allRows.reduce((s: number, r: any) => s + (r.clicks || 0), 0);
    const totalImpressions = allRows.reduce((s: number, r: any) => s + (r.impressions || 0), 0);
    const avgCtr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(1) : '0.0';
    const avgPos = allRows.length > 0 
      ? (allRows.reduce((s: number, r: any) => s + (r.position || 0), 0) / allRows.length).toFixed(1) 
      : '0.0';

    res.json({
      summary: {
        clicks: totalClicks,
        impressions: totalImpressions,
        ctr: avgCtr + '%',
        position: '#' + avgPos,
        dateRange: startDate28 + ' to ' + endDate,
      },
      queries:   (queries.data.rows   || []).map((r: any) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%', position: r.position.toFixed(1) })),
      pages:     (pages.data.rows     || []).map((r: any) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%', position: r.position.toFixed(1) })),
      countries: (countries.data.rows || []).map((r: any) => ({ country: r.keys[0].toUpperCase(), clicks: r.clicks, impressions: r.impressions, ctr: (r.ctr * 100).toFixed(1) + '%' })),
      devices:   (devices.data.rows   || []).map((r: any) => ({ device: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
      dates:     (dates.data.rows     || []).map((r: any) => ({ date: r.keys[0], clicks: r.clicks, impressions: r.impressions })),
    });
  } catch (error: any) {
    console.error('GSC API Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch GSC data', detail: error.message });
  }
};
