import { Router } from 'express';
import { 
  submitIndexing, submitIndexingBatch, getIndexingMetadata, verifyIndexing,
  runCrawl, getSitemap, getRobotsTxt, getLlmsTxt,
  analyzePageSpeed, getPageSpeedHistory, checkKnowledgeGraph, checkSafeBrowsing
} from '../controllers/seo.controller';
import { crawlLimiter } from '../middlewares/rateLimit';
import { getSmartAlerts } from '../controllers/alerts.controller';

const router = Router();

router.post('/seo/indexing', submitIndexing);
router.post('/seo/indexing/batch', submitIndexingBatch);
router.get('/seo/indexing/metadata', getIndexingMetadata);
router.post('/seo/indexing/verify', verifyIndexing);

router.post('/crawl', crawlLimiter, runCrawl);

router.get('/generate/sitemap/:siteId', getSitemap);
router.get('/generate/robots/:siteId', getRobotsTxt);
router.get('/generate/llms/:siteId', getLlmsTxt);

router.post('/seo/pagespeed/analyze', analyzePageSpeed);
router.get('/seo/pagespeed/history/:pageId', getPageSpeedHistory);

router.get('/seo/kg-check', checkKnowledgeGraph);
router.get('/seo/safe-browsing', checkSafeBrowsing);
router.get('/seo/smart-alerts', getSmartAlerts);

export default router;
