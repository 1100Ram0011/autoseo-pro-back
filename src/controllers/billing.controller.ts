import { Request, Response } from 'express';
import prisma from '../config/prisma';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2024-06-20' as any
});

export const createCheckout = async (req: Request, res: Response) => {
  try {
    const { priceId } = req.body;
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

    // In a real app, you'd look up the customer in Stripe or create one
    // Here we're just simulating for the demo
    if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_mock') {
      // Simulate success if no Stripe key is present
      return res.json({ url: `${frontendUrl}/dashboard/billing?success=true` });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${frontendUrl}/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/dashboard/billing?canceled=true`,
      client_reference_id: userId,
    });

    res.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe Checkout Error:', error);
    res.status(500).json({ error: error.message });
  }
};

export const handleWebhook = async (req: Request, res: Response) => {
  const event = req.body;

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id;
    const customerId = session.customer;

    if (userId) {
      // Determine plan based on the subscription or price
      // In a real app, retrieve the price ID from session to know if it's PRO or AGENCY
      // const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      // const priceId = lineItems.data[0].price.id;
      const planId = 'PRO'; // Mocking PRO plan assignment for now

      await prisma.user.update({
        where: { id: userId },
        data: { 
          planId,
          stripeCustomerId: customerId,
          // Reset usage metrics on new subscription
          aiUsageCount: 0,
        }
      });
      console.log(`User ${userId} upgraded to PRO`);
    }
  }

  res.json({ received: true });
};
