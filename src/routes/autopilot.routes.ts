import { Router } from 'express';
import { runAutoPilotStream } from '../controllers/autopilot.controller';

const router = Router();

router.get('/stream', runAutoPilotStream);

export default router;
