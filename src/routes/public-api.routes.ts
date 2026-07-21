import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../config/prisma';
import { runFullAnalysis } from '../services/pagespeed';
import { AutoSeoEngine } from '../services/autoSeoEngine';

const router = Router();

// Middleware to check API key
const verifyApiKey = async (req: Request, res: Response, next: any) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing x-api-key header' });
  }

  const user = await prisma.user.findUnique({ where: { apiKey } });
  if (!user || user.planId === 'free') {
    return res.status(403).json({ error: 'Invalid API key or insufficient plan (Requires PRO or AGENCY)' });
  }

  // @ts-ignore
  req.user = user;
  next();
};

// Rate limiter specifically for the public API
const publicApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15 mins for API usage
  message: { error: 'API rate limit exceeded. Please try again later.' }
});

router.use(publicApiLimiter);
router.use(verifyApiKey);

// 1. Audit URL Endpoint
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Valid URL parameter is required' });
    }

    // Run a real-time Lighthouse audit
    const lhData = await runFullAnalysis(url);
    res.json({ success: true, data: lhData });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to audit URL', details: error.message });
  }
});

// 2. Generate Report Endpoint
router.post('/generate-report', async (req: Request, res: Response) => {
  try {
    const { siteId } = req.body;
    // @ts-ignore
    const userId = req.user.id;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });

    // Enqueue or run engine
    const engine = new AutoSeoEngine('api-trigger', siteId, userId, 'https://example.com');
    const report = await engine.runScan();
    
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

export default router;
