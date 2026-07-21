import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { executeAiAction } from '../services/autoFixer';
import { runAnomalyDetection } from '../services/anomalyDetector';

export const getAnomalies = async (req: Request, res: Response) => {
  const siteId = req.params.siteId as string;
  try {
    const anomalies = await (prisma as any).aiAnomaly.findMany({
      where: { siteId, status: { not: 'RESOLVED' } },
      include: { actions: true },
      orderBy: { createdAt: 'desc' }
    });
    res.json(anomalies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch anomalies' });
  }
};

export const executeAction = async (req: Request, res: Response) => {
  const { actionId } = req.body;
  try {
    const result = await executeAiAction(actionId);
    if (!result) return res.status(404).json({ error: 'Action not found' });
    res.json({ success: true, message: 'Action executed successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to execute action' });
  }
};

// Expose a manual trigger for testing
export const triggerScan = async (req: Request, res: Response) => {
  const siteId = req.params.siteId as string;
  try {
    // Run the anomaly detection on-demand
    await runAnomalyDetection(siteId);
    res.json({ success: true, message: 'Scan complete. Check anomalies.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Scan failed' });
  }
};

// Force TS re-evaluation
