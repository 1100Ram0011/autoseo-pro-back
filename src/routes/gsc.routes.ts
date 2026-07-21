import { Router } from 'express';
import { 
  getOverview, getKeywords, getPages, getCoverage, 
  getCountries, getDevices, getQuery, getSitemaps, 
  inspectUrlEndpoint, getInsights, getSitesList, getFullSeoGsc 
} from '../controllers/gsc.controller';

const router = Router();

router.get('/gsc/sites', getSitesList);
router.get('/sites/:id/gsc/overview', getOverview);
router.get('/sites/:id/gsc/keywords', getKeywords);
router.get('/sites/:id/gsc/pages', getPages);
router.get('/sites/:id/gsc/coverage', getCoverage);
router.get('/sites/:id/gsc/countries', getCountries);
router.get('/sites/:id/gsc/devices', getDevices);
router.post('/sites/:id/gsc/query', getQuery);
router.get('/sites/:id/gsc/sitemaps', getSitemaps);
router.post('/sites/:id/gsc/inspect', inspectUrlEndpoint);
router.get('/sites/:id/gsc/insights', getInsights);
router.get('/seo/gsc/:siteId', getFullSeoGsc);

export default router;
