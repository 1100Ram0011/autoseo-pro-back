import { Router } from 'express';
import { getSmartAlerts, getAlerts, markAsRead, simulateUptimeCheck } from '../controllers/alerts.controller';

const router = Router({ mergeParams: true });

// Existing generic route
router.get('/smart', getSmartAlerts);

// New Routes mounted at /api/sites/:id/alerts
router.get('/', getAlerts);
router.post('/mark-read', markAsRead);
router.post('/simulate-uptime', simulateUptimeCheck);

export default router;
