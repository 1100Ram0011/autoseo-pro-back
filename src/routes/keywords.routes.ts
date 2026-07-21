import { Router } from 'express';
import { getSiteKeywords, createSiteKeyword, deleteKeyword, getKeywordIdeas } from '../controllers/keywords.controller';

const router = Router();

router.get('/sites/:id/keywords', getSiteKeywords);
router.post('/sites/:id/keywords', createSiteKeyword);
router.delete('/keywords/:keywordId', deleteKeyword);
router.get('/sites/:id/keyword-ideas', getKeywordIdeas);

export default router;
