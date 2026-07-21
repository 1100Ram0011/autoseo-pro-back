import { Router } from 'express';
import express from 'express';
import { createCheckout, handleWebhook } from '../controllers/billing.controller';

const router = Router();

router.post('/checkout', createCheckout);
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

export default router;
