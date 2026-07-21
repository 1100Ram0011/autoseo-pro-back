import { Request, Response } from 'express';
import { AutonomousLocalBusinessCloser } from '../services/auditGenerator';
import { AiTrendJacker } from '../services/trendJacker';
import { SecureHardwarePurgeEngine } from '../services/securePurge';

export const runAgentW1 = async (req: Request, res: Response) => {
  const { location = 'Mumbai', industry = 'Cafe' } = req.body;

  try {
    const agentW1 = new AutonomousLocalBusinessCloser();
    agentW1.executePipeline(location, industry).catch(console.error);


    res.json({
      message: 'Agent W1 Pipeline Started successfully.',
      status: 'Processing in background',
      target: { location, industry }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start Agent W1' });
  }
};

export const runAgentW2 = async (req: Request, res: Response) => {
  const { siteId } = req.body;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  try {
    const agentW2 = new AiTrendJacker();
    agentW2.executePipeline(siteId).catch(console.error);

    res.json({
      message: 'Agent W2 Pipeline Started successfully.',
      status: 'Scanning trends and generating multimodal content...'
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start Agent W2' });
  }
};

export const runAgentW3 = async (req: Request, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const agentW3 = new SecureHardwarePurgeEngine();
    const result = await agentW3.executePurge(userId);

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to execute Agent W3 Purge' });
  }
};
