import { Router } from 'express';
import { googleAuth, googleAuthCallback, checkGoogleAuthStatus, getGoogleProperties, getGscProperties } from '../controllers/auth.controller';

const router = Router();

router.get('/google', googleAuth);
router.get('/google/callback', googleAuthCallback);
router.get('/google/status', checkGoogleAuthStatus);
router.get('/google/properties', getGoogleProperties);
router.get('/google/gsc-properties', getGscProperties);

export default router;
