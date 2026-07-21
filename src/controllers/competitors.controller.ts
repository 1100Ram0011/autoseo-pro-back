import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const getCompetitors = async (req: Request, res: Response) => {
  try {
    const competitors = await prisma.competitor.findMany({
      where: { siteId: req.params.id as string },
      include: {
        keywords: true
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(competitors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch competitors' });
  }
};

export const addCompetitor = async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Competitor URL is required' });
    }

    const newCompetitor = await prisma.competitor.create({
      data: {
        siteId: req.params.id as string,
        url
      }
    });

    // Mocking the analysis part for MVP
    // In reality, this would trigger an async job to Ahrefs/DataForSEO API
    await mockCompetitorAnalysis(newCompetitor.id);

    const updatedCompetitor = await prisma.competitor.findUnique({
      where: { id: newCompetitor.id },
      include: { keywords: true }
    });

    res.json(updatedCompetitor);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add competitor' });
  }
};

export const deleteCompetitor = async (req: Request, res: Response) => {
  try {
    await prisma.competitor.delete({
      where: { id: req.params.competitorId as string }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete competitor' });
  }
};

// Helper function to mock API response
const mockCompetitorAnalysis = async (competitorId: string) => {
  const mockKeywords = [
    { keyword: 'seo services', position: 3, volume: 15000, traffic: 4000 },
    { keyword: 'local seo', position: 8, volume: 8000, traffic: 1200 },
    { keyword: 'best seo tools', position: 1, volume: 22000, traffic: 8500 },
    { keyword: 'how to do seo', position: 12, volume: 5000, traffic: 300 }
  ];

  for (const kw of mockKeywords) {
    await prisma.competitorKeyword.create({
      data: {
        competitorId,
        keyword: kw.keyword,
        position: kw.position,
        volume: kw.volume,
        traffic: kw.traffic
      }
    });
  }

  const aiStrategy = `## How to Beat This Competitor
1. **Target Low-Difficulty Keywords**: They are ignoring long-tail variations like "affordable seo services for small business".
2. **Improve Page Speed**: Their Core Web Vitals are failing. A faster site will outrank them.
3. **Content Gap**: You are missing "local seo" which brings them 1,200 monthly visits.
`;

  const contentGap = JSON.stringify([
    { keyword: 'local seo', theirPosition: 8, searchVolume: 8000 },
    { keyword: 'best seo tools', theirPosition: 1, searchVolume: 22000 }
  ]);

  await prisma.competitor.update({
    where: { id: competitorId },
    data: { aiStrategy, contentGap }
  });
};
