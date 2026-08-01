import { Request, Response } from 'express';
import { generateTitleSuggestions } from '../../services/blogGeneration.service';
import { blogQueue } from '../../jobs/blogQueue';
import prisma from '../../config/prisma';

export const getTitleSuggestions = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    
    // Make sure user owns the site
    const userId = (req as any).user.userId;
    const site = await prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) return res.status(404).json({ message: 'Site not found or unauthorized' });

    const titles = await generateTitleSuggestions(siteId);
    res.json({ success: true, titles });
  } catch (err: any) {
    console.error("ERROR generating titles:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const generateBlogContent = async (req: Request, res: Response) => {
  try {
    const { siteId, selectedTitle, blogPageUrl } = req.body;
    const userId = (req as any).user.userId;

    const site = await prisma.site.findFirst({ where: { id: siteId, userId } });
    if (!site) return res.status(404).json({ success: false, message: 'Site not found or unauthorized' });

    // Ensure session exists
    let session = await prisma.blogSession.findUnique({ where: { userId } });
    if (!session) {
      session = await prisma.blogSession.create({
        data: { userId, titles: '[]', drafts: '[]', activeJobs: '[]' }
      });
    }

    const uniqueJobId = `blog-${userId}-${Date.now()}`;

    // Add to active jobs immediately
    let activeJobs = session.activeJobs ? JSON.parse(session.activeJobs) : [];
    activeJobs.push({ jobId: uniqueJobId, selectedTitle });
    
    await prisma.blogSession.update({
      where: { userId },
      data: { activeJobs: JSON.stringify(activeJobs) }
    });

    const job = await blogQueue.add(
      'generate-blog',
      {
        siteId,
        selectedTitle,
        userId,
        blogPageUrl
      },
      { jobId: uniqueJobId }
    );

    res.json({
      success: true,
      jobId: job.id,
      message: 'Blog generation queued successfully.'
    });
  } catch (err: any) {
    console.error("ERROR queuing blog generation:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
