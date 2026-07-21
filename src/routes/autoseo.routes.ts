import { Router } from 'express';
import { startScan, streamProgress, getReport } from '../controllers/autoseo.controller';

const router = Router();

router.post('/autoseo/scan', startScan);
router.get('/autoseo/stream/:reportId', streamProgress);
router.get('/autoseo/report/:reportId', getReport);

export default router;
