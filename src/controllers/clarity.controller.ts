import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getUxIssues = async (req: Request, res: Response) => {
  const siteId = req.params.siteId as string;
  const days = parseInt(req.query.days as string) || 7;
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const metrics = await prisma.clarityMetric.findMany({
      where: {
        siteId,
        date: { gte: cutoffDate }
      }
    });

    // Aggregate by URL
    const urlMap: Record<string, { url: string, rageClicks: number, deadClicks: number, sessions: number }> = {};
    
    for (const m of metrics) {
      const url = m.url || '/';
      if (!urlMap[url]) urlMap[url] = { url, rageClicks: 0, deadClicks: 0, sessions: 0 };
      urlMap[url].rageClicks += m.rageClicks;
      urlMap[url].deadClicks += m.deadClicks;
      urlMap[url].sessions += m.sessions;
    }

    // Convert to array and sort by worst UX (rage + dead)
    const issues = Object.values(urlMap)
      .filter(i => (i.rageClicks + i.deadClicks) > 0)
      .sort((a, b) => (b.rageClicks + b.deadClicks) - (a.rageClicks + a.deadClicks))
      .slice(0, 10);

    res.json(issues);
  } catch (error) {
    console.error('Clarity Controller Error:', error);
    res.status(500).json({ error: 'Failed to fetch UX issues' });
  }
};

export const getHistoricalMetrics = async (req: Request, res: Response) => {
  const siteId = req.params.siteId as string;
  const days = parseInt(req.query.days as string) || 30;

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const metrics = await prisma.clarityMetric.groupBy({
      by: ['date'],
      where: {
        siteId,
        date: { gte: cutoffDate }
      },
      _sum: {
        sessions: true,
        rageClicks: true,
        deadClicks: true,
      },
      orderBy: { date: 'asc' }
    });

    res.json(metrics.map(m => ({
      date: m.date,
      sessions: m._sum.sessions || 0,
      rageClicks: m._sum.rageClicks || 0,
      deadClicks: m._sum.deadClicks || 0
    })));
  } catch (error) {
    console.error('Clarity Historical Metrics Error:', error);
    res.status(500).json({ error: 'Failed to fetch historical metrics' });
  }
};

export const triggerManualSync = async (req: Request, res: Response) => {
  // In a real app, do not block the request. Just trigger the function.
  import('../services/claritySync').then(module => {
    module.runClaritySync();
  });
  res.json({ message: 'Clarity manual sync started in background.' });
};
