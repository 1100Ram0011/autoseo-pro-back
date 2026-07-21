import { Router } from 'express';
import { getSites, getSitePages, updateSiteSettings, addSite, autoDetectGscProperty, autoDetectGa4Property } from '../controllers/sites.controller';
import { getDashboardData } from '../controllers/dashboard.controller';
import { syncToWordPress } from '../controllers/wp.controller';

const router = Router();

router.get('/', getSites);
router.post('/', addSite);
router.get('/:id/pages', getSitePages);
router.get('/:id/dashboard', getDashboardData);
router.put('/:id/settings', updateSiteSettings);
router.post('/:id/auto-detect-gsc', autoDetectGscProperty);
router.post('/:id/auto-detect-ga4', autoDetectGa4Property);
router.post('/:id/wp-sync', syncToWordPress);

export default router;
