import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import prisma from '../config/prisma';

const CF_APP_ID = process.env.CASHFREE_APP_ID || "TEST_APP_ID";
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY || "TEST_SECRET_KEY";
const isProd = process.env.CASHFREE_ENV === 'PRODUCTION' || (process.env.CASHFREE_APP_ID && process.env.CASHFREE_APP_ID.startsWith('live_'));
const CF_BASE_URL = isProd ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";

export const initializeScanPay = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { planId, email } = req.body;
    
    // We expect the user to be authenticated, but we also fall back to email
    // req.user might be set if we use auth middleware
    const userId = (req as any).user?.id || req.body.userId;

    const PLAN_PRICES: Record<string, number> = {
      Pack: 10,
      ProMonthly: 199, // Changed back to 199 INR as per your old app. Feel free to adjust!
    };

    const amount = PLAN_PRICES[planId];
    if (!amount) {
      res.status(400).json({ error: 'Invalid planId. Valid options: Pack, ProMonthly' });
      return;
    }

    const orderId = 'ORD_' + Date.now() + Math.floor(Math.random() * 1000);

    let returnUrl = (process.env.FRONTEND_URL || "http://localhost:3000") + "/dashboard/billing?success=true&order_id={order_id}";
    if (isProd && returnUrl.startsWith("http://")) {
      returnUrl = returnUrl.replace("http://", "https://");
    }

    const payload = {
      order_amount: amount,
      order_currency: "INR",
      order_id: orderId,
      customer_details: {
        customer_id: userId ? `CUST_${userId}` : "CUST_" + Date.now(),
        customer_phone: "9999999999", // Can be dynamic if we collect phone
        customer_email: email || "anonymous-client@autoseopro.com"
      },
      order_meta: {
        return_url: returnUrl
      }
    };

    const response = await axios.post(`${CF_BASE_URL}/orders`, payload, {
      headers: {
        'x-client-id': CF_APP_ID,
        'x-client-secret': CF_SECRET_KEY,
        'x-api-version': '2023-08-01',
        'Content-Type': 'application/json'
      }
    });

    const payment_session_id = response.data.payment_session_id;

    // Save transaction securely in DB
    const user = await prisma.user.findFirst({ where: { email } });
    
    await prisma.transaction.create({
      data: {
        transactionId: orderId,
        email: email,
        userId: userId || (user ? user.id : null),
        amount: amount,
        planId: planId,
        paymentSessionId: payment_session_id,
        status: 'PENDING'
      }
    });

    res.status(200).json({
      success: true,
      payment_session_id,
      order_id: orderId,
      amount: amount
    });

  } catch (error: any) {
    console.error("❌ Cashfree Order Creation Error:", error?.response?.data || error.message);
    next(error);
  }
};

export const verifyPaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      res.status(400).json({ error: 'Missing parameter: orderId' });
      return;
    }

    // Fetch from DB securely
    const transaction = await prisma.transaction.findUnique({ where: { transactionId: orderId } });
    if (!transaction) {
      res.status(404).json({ error: 'Transaction not found' });
      return;
    }
    
    // Prevent double crediting
    if (transaction.status === 'SUCCESS') {
      res.status(200).json({
        success: true,
        status: 'SUCCESS',
        isUnlimited: transaction.planId === 'ProMonthly',
        message: 'Payment already verified.'
      });
      return;
    }

    const response = await axios.get(`${CF_BASE_URL}/orders/${orderId}/payments`, {
      headers: {
        'x-client-id': CF_APP_ID,
        'x-client-secret': CF_SECRET_KEY,
        'x-api-version': '2023-08-01'
      }
    });

    const payments = response.data;
    const isSuccess = payments.some((p: any) => p.payment_status === "SUCCESS");

    if (!isSuccess) {
      res.status(200).json({
        success: true,
        status: 'PENDING',
        isUnlimited: false,
        message: 'Payment not successful yet.'
      });
      return;
    }

    // Mark success in DB
    const updatedTransaction = await prisma.transaction.update({
      where: { id: transaction.id },
      data: { status: 'SUCCESS' }
    });

    // Update user based on secure DB record
    if (updatedTransaction.userId || updatedTransaction.email) {
      const user = updatedTransaction.userId 
        ? await prisma.user.findUnique({ where: { id: updatedTransaction.userId } })
        : await prisma.user.findUnique({ where: { email: updatedTransaction.email as string } });
        
      if (user) {
        if (updatedTransaction.planId === 'ProMonthly') {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              planId: 'ProMonthly',
              isUnlimited: true,
              planExpiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            }
          });
        } else if (updatedTransaction.planId === 'Pack') {
          await prisma.user.update({
            where: { id: user.id },
            data: {
              planId: 'Pack',
              credits: (user.credits || 0) + 50,
              isUnlimited: false,
              planExpiry: null
            }
          });
        }
      }
    }

    res.status(200).json({
      success: true,
      status: 'SUCCESS',
      isUnlimited: transaction.planId === 'ProMonthly',
      message: 'Payment confirmed. Access granted.'
    });

  } catch (error: any) {
    console.error("❌ Cashfree Verify Error:", error?.response?.data || error.message);
    next(error);
  }
};

export const getPaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const email = (req as any).user?.email || req.query.email as string;

    if (!userId && !email) {
      res.status(400).json({ error: 'Authentication required to check status' });
      return;
    }

    const user = userId 
      ? await prisma.user.findUnique({ where: { id: userId } })
      : await prisma.user.findUnique({ where: { email: email } });

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isProActive = user.planId === 'ProMonthly' && 
                        user.planExpiry && 
                        new Date(user.planExpiry).getTime() > Date.now();

    res.status(200).json({
      success: true,
      planId: isProActive ? user.planId : 'free',
      isUnlimited: isProActive ? user.isUnlimited : false,
      isActive: !!isProActive,
      planExpiry: user.planExpiry
    });
  } catch (error: any) {
    console.error("❌ Get Payment Status Error:", error.message);
    next(error);
  }
};
