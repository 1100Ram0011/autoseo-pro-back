import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { AutoSeoEngine, autoSeoEmitter } from '../services/autoSeoEngine';

export const startScan = async (req: Request, res: Response) => {
  const { url, siteId } = req.body;

  if (!url || !siteId) {
    return res.status(400).json({ error: 'URL and Site ID are required' });
  }

  try {
    // Check if site exists
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Create a new report entry
    const report = await prisma.autoSeoReport.create({
      data: {
        siteId,
        url,
        status: 'Pending'
      }
    });

    // Start engine in background
    const engine = new AutoSeoEngine(report.id, siteId, site.userId, url);
    engine.runScan(); // async without awaiting to not block response

    res.json({ reportId: report.id, message: 'Scan started successfully' });
  } catch (error) {
    console.error("Start Scan Error:", error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
};

export const streamProgress = (req: Request, res: Response) => {
  const { reportId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const eventName = `update-${reportId}`;
  
  // Send initial connected message
  sendEvent({ step: 'connection', status: 'connected', message: 'Connected to scan stream...' });

  const listener = (data: any) => {
    sendEvent(data);
    if (data.status === 'completed' && data.step === 'summary') {
      res.end(); // Close stream on success
    }
    if (data.status === 'failed') {
      res.end();
    }
  };

  autoSeoEmitter.on(eventName, listener);

  req.on('close', () => {
    autoSeoEmitter.off(eventName, listener);
  });
};

export const getReport = async (req: Request, res: Response) => {
  const { reportId } = req.params;

  try {
    const report = await prisma.autoSeoReport.findUnique({
      where: { id: String(reportId) },
      include: { site: true }
    });

    if (!report) {
      return res.status(404).json({ error: 'Report not found' });
    }

    res.json(report);
  } catch (error) {
    console.error("Get Report Error:", error);
    res.status(500).json({ error: 'Failed to fetch report' });
  }
};
