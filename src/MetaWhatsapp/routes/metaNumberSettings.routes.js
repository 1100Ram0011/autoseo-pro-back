import express from 'express';
import { getNumberSettings, updateNumberSettings, getMetaPhoneSettings } from '../controllers/metaNumberSettings.controller.js';
import { isAuthenticated } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.use(isAuthenticated);

router.get('/:phoneNumberId', getNumberSettings);
router.put('/:phoneNumberId', updateNumberSettings);
router.get('/:phoneNumberId/meta-sync', getMetaPhoneSettings); // Pull directly from Meta

export default router;
