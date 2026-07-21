import { Request, Response } from 'express';
import { firecrawlQueue } from '../jobs/firecrawlQueue';

export const startScrapeJob = async (req: Request, res: Response): Promise<void> => {
  try {
    const { websiteUrl, userId } = req.body;

    if (!websiteUrl) {
      res.status(400).json({ error: 'websiteUrl is required' });
      return;
    }
    
    const uid = userId || 'anonymous';

    const job = await firecrawlQueue.add('scrape-job', {
      websiteUrl,
      userId: uid
    });

    res.status(200).json({ message: 'Scraping job added to queue', jobId: job.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const checkJobStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const jobId = req.params.jobId as string;

    const job = await firecrawlQueue.getJob(jobId);

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    const state = await job.getState();
    const progress = job.progress;
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.status(200).json({
      id: job.id,
      state,
      progress,
      result,
      failedReason,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
