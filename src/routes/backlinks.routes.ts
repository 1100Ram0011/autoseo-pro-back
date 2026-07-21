import { Router } from 'express';
import { scanBacklinks, getBacklinks, markDisavow, generateDisavow } from '../controllers/backlinks.controller';

const router = Router({ mergeParams: true });

// Mounted at /api/sites/:id/backlinks
router.post('/scan', scanBacklinks);
router.get('/', getBacklinks);
router.patch('/:linkId/disavow', markDisavow);
router.get('/export-disavow', generateDisavow);

export default router;
