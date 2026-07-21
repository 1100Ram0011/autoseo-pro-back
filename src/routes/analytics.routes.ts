import { Router } from 'express';
import { getGa4Overview, getGa4Pages, getAnalytics, trackVisitor } from '../controllers/analytics.controller';

const router = Router();

router.get('/sites/:id/ga4/overview', getGa4Overview);
router.get('/sites/:id/ga4/pages', getGa4Pages);
router.get('/analytics/:siteId', getAnalytics);
router.post('/track', trackVisitor);

export default router;
