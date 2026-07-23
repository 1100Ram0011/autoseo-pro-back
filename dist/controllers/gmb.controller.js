"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishReply = exports.generateAiReply = exports.getReviews = exports.syncProfile = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const syncProfile = async (req, res) => {
    try {
        const siteId = req.params.id;
        // MVP: Check if profile exists, if not, create a mock one.
        let profile = await prisma_1.default.gMBProfile.findFirst({
            where: { siteId }
        });
        if (!profile) {
            // Create mock profile
            profile = await prisma_1.default.gMBProfile.create({
                data: {
                    siteId,
                    businessName: "AutoSEO Pro Local Business",
                    rating: 4.8,
                    totalReviews: 24,
                    address: "123 Main St, New York, NY 10001",
                    phone: "+1 (555) 123-4567",
                    totalSearches: 1542,
                    mapViews: 890
                }
            });
            // Create mock reviews
            const mockReviews = [
                {
                    reviewerName: "John Doe",
                    rating: 5,
                    comment: "Excellent service! Highly recommended.",
                },
                {
                    reviewerName: "Jane Smith",
                    rating: 4,
                    comment: "Great experience overall, but wait time was a bit long.",
                },
                {
                    reviewerName: "Angry Customer",
                    rating: 1,
                    comment: "Terrible experience. The staff was rude.",
                }
            ];
            for (const rev of mockReviews) {
                await prisma_1.default.gMBReview.create({
                    data: {
                        gmbProfileId: profile.id,
                        reviewerName: rev.reviewerName,
                        rating: rev.rating,
                        comment: rev.comment
                    }
                });
            }
        }
        const fullProfile = await prisma_1.default.gMBProfile.findUnique({
            where: { id: profile.id },
            include: { reviews: true }
        });
        res.json(fullProfile);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to sync GMB profile' });
    }
};
exports.syncProfile = syncProfile;
const getReviews = async (req, res) => {
    try {
        const siteId = req.params.id;
        const profile = await prisma_1.default.gMBProfile.findFirst({
            where: { siteId },
            include: {
                reviews: {
                    orderBy: { createdAt: 'desc' }
                }
            }
        });
        if (!profile) {
            return res.json([]);
        }
        res.json(profile.reviews);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch reviews' });
    }
};
exports.getReviews = getReviews;
const generateAiReply = async (req, res) => {
    try {
        const reviewId = req.params.reviewId;
        const review = await prisma_1.default.gMBReview.findUnique({
            where: { id: reviewId }
        });
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }
        // MVP: Simulate AI generating a reply
        let generatedReply = "";
        if (review.rating >= 4) {
            generatedReply = `Hi ${review.reviewerName}, thank you so much for the ${review.rating}-star review! We are thrilled to hear about your positive experience. We hope to see you again soon!`;
        }
        else if (review.rating === 3) {
            generatedReply = `Hi ${review.reviewerName}, thank you for your feedback. We are always looking for ways to improve and would love to hear how we can earn a 5-star rating from you next time.`;
        }
        else {
            generatedReply = `Hi ${review.reviewerName}, we sincerely apologize that your experience did not meet expectations. We take this seriously and would like to make things right. Please contact us directly at our support line.`;
        }
        // In a real implementation, we would call OpenAI/Anthropic here
        const updated = await prisma_1.default.gMBReview.update({
            where: { id: reviewId },
            data: { reply: generatedReply }
        });
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate AI reply' });
    }
};
exports.generateAiReply = generateAiReply;
const publishReply = async (req, res) => {
    try {
        const reviewId = req.params.reviewId;
        const { replyText } = req.body;
        if (!replyText) {
            return res.status(400).json({ error: 'Reply text is required' });
        }
        const updated = await prisma_1.default.gMBReview.update({
            where: { id: reviewId },
            data: {
                reply: replyText,
                isReplied: true
            }
        });
        res.json(updated);
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to publish reply' });
    }
};
exports.publishReply = publishReply;
//# sourceMappingURL=gmb.controller.js.map