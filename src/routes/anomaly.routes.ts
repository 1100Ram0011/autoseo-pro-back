import { Router } from 'express';
import { getAnomalies, executeAction, triggerScan } from '../controllers/anomaly.controller';

const router = Router();

router.get('/:siteId', getAnomalies);
router.post('/execute', executeAction);
router.post('/:siteId/scan', triggerScan);

export default router;
