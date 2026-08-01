import { Router } from 'express';
import { getReports, createReport, scheduleReport } from '../controllers/reports.controller';

const router = Router({ mergeParams: true });

router.get('/', getReports);
router.post('/', createReport);
router.post('/schedule', scheduleReport);

export default router;
