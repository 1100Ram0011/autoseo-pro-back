import { Router } from 'express';
import { getUxIssues, getHistoricalMetrics, triggerManualSync } from '../controllers/clarity.controller';

const router = Router();

router.get('/sites/:siteId/clarity/issues', getUxIssues);
router.get('/sites/:siteId/clarity/metrics', getHistoricalMetrics);
router.post('/clarity/sync', triggerManualSync);

export default router;
