"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhook = exports.createCheckout = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const stripe_1 = __importDefault(require("stripe"));
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
    apiVersion: '2024-06-20'
});
const createCheckout = async (req, res) => {
    const { userId, priceId } = req.body;
    if (!userId)
        return res.status(400).json({ error: 'User ID is required' });
    try {
        if (!process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY === 'sk_test_mock') {
            // Mock flow if no real stripe key
            return res.json({ url: 'http://localhost:3000/dashboard/billing?success=true' });
        }
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price: priceId || process.env.STRIPE_PRICE_PRO, // Should match Pro or Agency price ID
                    quantity: 1,
                },
            ],
            mode: 'subscription',
            success_url: `http://localhost:3000/dashboard/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `http://localhost:3000/dashboard/billing?canceled=true`,
            client_reference_id: userId,
        });
        res.json({ url: session.url });
    }
    catch (error) {
        console.error('Stripe Checkout Error:', error);
        res.status(500).json({ error: error.message });
    }
};
exports.createCheckout = createCheckout;
const handleWebhook = async (req, res) => {
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
            await prisma_1.default.user.update({
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
exports.handleWebhook = handleWebhook;
//# sourceMappingURL=billing.controller.js.map