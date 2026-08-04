import { Router } from 'express';
import { initializeScanPay, verifyPaymentStatus, getPaymentStatus } from '../controllers/payment.controller';
import { authMiddleware } from '../middlewares/auth.middleware';

const router = Router();

// Endpoint to initiate a payment
// Using authMiddleware to ensure only logged in users can pay
router.post('/initiate', authMiddleware, initializeScanPay);

// Endpoint to verify payment status
router.post('/verify', authMiddleware, verifyPaymentStatus);

// Endpoint to fetch current user's subscription status
router.get('/status', authMiddleware, getPaymentStatus);

export default router;
