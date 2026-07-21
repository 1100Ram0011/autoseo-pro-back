import { Router } from 'express';
import { connectBusiness, getBusinessProfile, generateDailyPost, publishPost, getReviews, generateReviewReply } from '../controllers/business.controller';

const router = Router();

router.post('/connect', connectBusiness);
router.get('/profile', getBusinessProfile);
router.post('/generate-post', generateDailyPost);
router.post('/publish', publishPost);
router.get('/reviews', getReviews);
router.post('/generate-reply', generateReviewReply);

export default router;
