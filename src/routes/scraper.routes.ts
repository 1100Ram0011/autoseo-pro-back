import { Router } from 'express';
import { startScrapeJob, checkJobStatus } from '../controllers/scraper.controller';

const router = Router();

router.post('/start', startScrapeJob);
router.get('/status/:jobId', checkJobStatus);

export default router;
