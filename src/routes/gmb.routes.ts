import { Router } from 'express';
import { syncProfile, getReviews, generateAiReply, publishReply } from '../controllers/gmb.controller';

const router = Router({ mergeParams: true });

// Mounted at /api/sites/:id/gmb
router.post('/sync', syncProfile);
router.get('/reviews', getReviews);
router.post('/reviews/:reviewId/ai-reply', generateAiReply);
router.post('/reviews/:reviewId/publish', publishReply);

export default router;
