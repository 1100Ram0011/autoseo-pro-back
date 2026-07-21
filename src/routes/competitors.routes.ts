import { Router } from 'express';
import { getCompetitors, addCompetitor, deleteCompetitor } from '../controllers/competitors.controller';

const router = Router({ mergeParams: true });

// Mounted at /api/sites/:id/competitors
router.get('/', getCompetitors);
router.post('/', addCompetitor);
router.delete('/:competitorId', deleteCompetitor);

export default router;
