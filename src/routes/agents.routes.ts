import { Router } from 'express';
import { runAgentW1, runAgentW2, runAgentW3 } from '../controllers/agents.controller';

const router = Router();

router.post('/w1', runAgentW1);
router.post('/w2', runAgentW2);
router.post('/w3', runAgentW3);

export default router;
