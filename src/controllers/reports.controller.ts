import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Get all reports for a specific site
export const getReports = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    
    // Ensure the site belongs to the user
    // Note: Assuming req.user is set by your auth middleware
    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        userId: (req as any).user?.id,
      }
    });

    if (!site) {
      return res.status(404).json({ message: 'Site not found' });
    }

    const reportId = req.query.reportId as string;
    const reports = await prisma.clientReport.findMany({
      where: { siteId },
      orderBy: { createdAt: 'desc' }
    });

    res.json(reports);
  } catch (error: any) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ message: 'Failed to fetch reports' });
  }
};

// Create a new report record
export const createReport = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    const { name, type, size, status } = req.body;

    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        userId: (req as any).user?.id,
      }
    });

    if (!site) {
      return res.status(404).json({ message: 'Site not found' });
    }

    const report = await prisma.clientReport.create({
      data: {
        siteId,
        name,
        type,
        size,
        status: status || 'Generated'
      }
    });

    res.status(201).json(report);
  } catch (error: any) {
    console.error('Error creating report:', error);
    res.status(500).json({ message: 'Failed to create report record' });
  }
};

// Create a new report schedule
export const scheduleReport = async (req: Request, res: Response) => {
  try {
    const siteId = req.params.siteId as string;
    const { name, frequency, emails } = req.body;

    const site = await prisma.site.findFirst({
      where: {
        id: siteId,
        userId: (req as any).user?.id,
      }
    });

    if (!site) {
      return res.status(404).json({ message: 'Site not found' });
    }

    const scheduleId = req.query.scheduleId as string;
    const schedule = await prisma.reportSchedule.create({
      data: {
        siteId,
        name,
        frequency,
        emails,
        status: 'Active'
      }
    });

    res.status(201).json(schedule);
  } catch (error: any) {
    console.error('Error scheduling report:', error);
    res.status(500).json({ message: 'Failed to create report schedule' });
  }
};
