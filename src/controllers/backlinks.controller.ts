import { Request, Response } from 'express';
import prisma from '../config/prisma';

export const scanBacklinks = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.id as string;

    // MVP: Check if backlinks exist, if not, create mock ones.
    const existing = await (prisma as any).backlink.findMany({ where: { siteId } });

    if (existing.length === 0) {
      const mockBacklinks = [
        {
          domain: 'good-seo-blog.com',
          url: 'https://good-seo-blog.com/top-10-tools',
          targetUrl: '/features',
          toxicityScore: 12,
        },
        {
          domain: 'news-portal-trust.org',
          url: 'https://news-portal-trust.org/industry-update',
          targetUrl: '/',
          toxicityScore: 5,
        },
        {
          domain: 'buy-cheap-links-now.net',
          url: 'http://buy-cheap-links-now.net/spam/123',
          targetUrl: '/',
          toxicityScore: 92, // Toxic
        },
        {
          domain: 'shady-casino-reviews.biz',
          url: 'https://shady-casino-reviews.biz/hidden-link',
          targetUrl: '/pricing',
          toxicityScore: 85, // Toxic
        },
        {
          domain: 'tech-reviewer.io',
          url: 'https://tech-reviewer.io/auto-seo-pro-review',
          targetUrl: '/',
          toxicityScore: 18,
        }
      ];

      for (const bl of mockBacklinks) {
        await (prisma as any).backlink.create({
          data: {
            siteId,
            domain: bl.domain,
            url: bl.url,
            targetUrl: bl.targetUrl,
            toxicityScore: bl.toxicityScore
          }
        });
      }
    }

    const backlinks = await (prisma as any).backlink.findMany({
      where: { siteId },
      orderBy: { toxicityScore: 'desc' }
    });

    res.json(backlinks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to scan backlinks' });
  }
};

export const getBacklinks = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.id as string;
    
    const backlinks = await (prisma as any).backlink.findMany({
      where: { siteId },
      orderBy: { toxicityScore: 'desc' }
    });

    res.json(backlinks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch backlinks' });
  }
};

export const markDisavow = async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;
    const { isDisavowed } = req.body;

    const updated = await (prisma as any).backlink.update({
      where: { id: linkId as string },
      data: { isDisavowed }
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update disavow status' });
  }
};

export const generateDisavow = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.id as string;

    const disavowedLinks = await (prisma as any).backlink.findMany({
      where: { siteId, isDisavowed: true }
    });

    if (disavowedLinks.length === 0) {
      return res.status(400).json({ error: 'No links marked for disavowal.' });
    }

    // Google Disavow File Format expects:
    // domain:spamdomain.com
    // OR
    // http://spam.com/exact-page.html

    let fileContent = "# AutoSEO Pro Generated Disavow File\n";
    fileContent += `# Generated on: ${new Date().toISOString()}\n\n`;

    disavowedLinks.forEach((link: any) => {
      // Disavow at domain level is safer and recommended by Google for spam networks
      fileContent += `domain:${link.domain}\n`;
    });

    res.setHeader('Content-disposition', 'attachment; filename=disavow.txt');
    res.setHeader('Content-type', 'text/plain');
    res.send(fileContent);

  } catch (error) {
    res.status(500).json({ error: 'Failed to generate disavow file' });
  }
};
