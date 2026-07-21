import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { generateKeywordIdeas } from '../services/googleAds';

export const getSiteKeywords = async (req: Request, res: Response) => {
  try {
    const keywords = await prisma.keyword.findMany({
      where: { siteId: req.params.id as string },
      orderBy: { createdAt: 'desc' }
    });
    res.json(keywords);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch keywords' });
  }
};

export const createSiteKeyword = async (req: Request, res: Response) => {
  try {
    const { keyword, volume, position } = req.body;
    const newKw = await prisma.keyword.create({
      data: {
        siteId: req.params.id as string,
        keyword,
        volume: volume ? parseInt(volume) : null,
        position: position ? parseInt(position) : null
      }
    });
    res.json(newKw);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save keyword' });
  }
};

export const deleteKeyword = async (req: Request, res: Response) => {
  try {
    await prisma.keyword.delete({
      where: { id: req.params.keywordId as string }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete keyword' });
  }
};

export const getKeywordIdeas = async (req: Request, res: Response) => {
  try {
    const seed = req.query.seed as string;
    if (!seed) return res.status(400).json({ error: 'seed query parameter is required' });
    
    // Using the generateKeywordIdeas service from Google Ads API
    const data = await generateKeywordIdeas(seed);
    res.json(data);
  } catch (error) {
    console.error('Keyword Ideas Error:', error);
    res.status(500).json({ error: 'Failed to generate keyword ideas' });
  }
};
