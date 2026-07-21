import { Router } from 'express';
import { generateAiKeywords, generateAiBlog, generateAiSchema, generateAiAnalysis, generateAiChat } from '../controllers/ai.controller';
import { aiLimiter } from '../middlewares/rateLimit';

const router = Router();

router.post('/keywords', aiLimiter, generateAiKeywords);
router.post('/blog', aiLimiter, generateAiBlog);
router.post('/schema', aiLimiter, generateAiSchema);
router.post('/analyze-site', aiLimiter, generateAiAnalysis);
router.post('/chat', aiLimiter, generateAiChat);

export default router;
