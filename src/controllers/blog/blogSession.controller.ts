import { Request, Response } from 'express';
import prisma from '../../config/prisma';

export const getSession = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    let session = await prisma.blogSession.findUnique({ where: { userId } });
    if (!session) {
      session = await prisma.blogSession.create({
        data: {
          userId,
          titles: JSON.stringify([]),
          drafts: JSON.stringify([]),
          activeJobs: JSON.stringify([]),
        }
      });
    }
    res.json({
      ...session,
      titles: session.titles ? JSON.parse(session.titles) : [],
      drafts: session.drafts ? JSON.parse(session.drafts) : [],
      activeJobs: session.activeJobs ? JSON.parse(session.activeJobs) : [],
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const saveTitles = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { titles, prepend = false } = req.body;

    let session = await prisma.blogSession.findUnique({ where: { userId } });
    let existingTitles = session && session.titles ? JSON.parse(session.titles) : [];
    
    if (prepend) {
      existingTitles = [...titles, ...existingTitles];
    } else {
      existingTitles = titles;
    }

    session = await prisma.blogSession.upsert({
      where: { userId },
      update: { titles: JSON.stringify(existingTitles) },
      create: { userId, titles: JSON.stringify(existingTitles), drafts: '[]', activeJobs: '[]' }
    });

    res.json({
      ...session,
      titles: session.titles ? JSON.parse(session.titles) : [],
      drafts: session.drafts ? JSON.parse(session.drafts) : [],
      activeJobs: session.activeJobs ? JSON.parse(session.activeJobs) : [],
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const saveDraft = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { title, content, tags, coverImage } = req.body;

    let session = await prisma.blogSession.findUnique({ where: { userId } });
    if (!session) return res.status(404).json({ message: 'Session not found' });

    let drafts = session.drafts ? JSON.parse(session.drafts) : [];
    const existingIdx = drafts.findIndex((d: any) => d.title === title);
    
    if (existingIdx >= 0) {
      drafts[existingIdx] = { title, content, tags, coverImage, createdAt: new Date() };
    } else {
      drafts.push({ title, content, tags, coverImage, createdAt: new Date() });
    }

    session = await prisma.blogSession.update({
      where: { userId },
      data: { drafts: JSON.stringify(drafts) }
    });

    res.json({
      ...session,
      titles: session.titles ? JSON.parse(session.titles) : [],
      drafts: session.drafts ? JSON.parse(session.drafts) : [],
      activeJobs: session.activeJobs ? JSON.parse(session.activeJobs) : [],
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};

export const setActiveJob = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    const { jobId, selectedTitle, remove } = req.body;

    let session = await prisma.blogSession.findUnique({ where: { userId } });
    if (!session) {
      session = await prisma.blogSession.create({
        data: { userId, titles: '[]', drafts: '[]', activeJobs: '[]' }
      });
    }

    let activeJobs = session.activeJobs ? JSON.parse(session.activeJobs) : [];

    if (remove) {
      activeJobs = activeJobs.filter((j: any) => j.jobId !== jobId);
    } else if (jobId) {
      activeJobs.push({ jobId, selectedTitle });
    } else {
      activeJobs = [];
    }

    session = await prisma.blogSession.update({
      where: { userId },
      data: { activeJobs: JSON.stringify(activeJobs) }
    });

    res.json({
      ...session,
      titles: session.titles ? JSON.parse(session.titles) : [],
      drafts: session.drafts ? JSON.parse(session.drafts) : [],
      activeJobs: session.activeJobs ? JSON.parse(session.activeJobs) : [],
    });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
};
