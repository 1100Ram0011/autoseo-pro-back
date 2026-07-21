import { Router } from 'express';
import { getApiKey, generateApiKey, revokeApiKey } from '../controllers/users.controller';

const router = Router();

router.get('/api-key', getApiKey);
router.post('/api-key/generate', generateApiKey);
router.delete('/api-key/revoke', revokeApiKey);

export default router;
