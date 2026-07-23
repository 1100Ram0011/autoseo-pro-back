"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.leadsWorker = exports.leadsQueueEvents = exports.leadsQueue = exports.LEADS_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const prisma_1 = __importDefault(require("../config/prisma"));
const geminiLeadEngine_1 = require("../services/geminiLeadEngine");
exports.LEADS_QUEUE_NAME = 'google-api-lead-generation-queue';
exports.leadsQueue = new bullmq_1.Queue(exports.LEADS_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.leadsQueueEvents = new bullmq_1.QueueEvents(exports.LEADS_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.leadsWorker = new bullmq_1.Worker(exports.LEADS_QUEUE_NAME, async (job) => {
    const { targetMarket, geographicFocus, numberOfLeads, userId } = job.data;
    console.log(`[BullMQ Leads] Processing Job ${job.id} for user ${userId}`);
    try {
        job.updateProgress({ percent: 10, label: "Starting lead generation..." });
        // Check existing leads in Prisma
        job.updateProgress({ percent: 20, label: "Checking existing leads..." });
        const existingLeads = await prisma_1.default.mapLead.findMany({
            where: { userId },
            select: { name: true, phone: true, placeId: true }
        });
        const existingPlaceIds = new Set();
        const existingNames = new Set();
        const existingPhones = new Set();
        existingLeads.forEach((lead) => {
            if (lead.placeId)
                existingPlaceIds.add(lead.placeId);
            if (lead.name)
                existingNames.add(lead.name.toLowerCase().trim());
            if (lead.phone && lead.phone !== 'N/A')
                existingPhones.add(lead.phone.replace(/\D/g, ''));
        });
        job.updateProgress({ percent: 30, label: "Fetching leads with AI..." });
        const finalDocs = [];
        let attempt = 0;
        const maxAttempts = 15;
        while (finalDocs.length < numberOfLeads && attempt < maxAttempts) {
            attempt++;
            const needed = numberOfLeads - finalDocs.length;
            job.updateProgress({
                percent: Math.min(90, 30 + attempt * 5),
                label: `Fetching ${needed} more leads (attempt ${attempt})...`
            });
            const buffer = Math.min(needed + 20, needed * 1.2);
            const leads = await (0, geminiLeadEngine_1.fetchLeadsWithGemini)(targetMarket, geographicFocus, Math.ceil(buffer));
            for (const l of leads) {
                if (finalDocs.length >= numberOfLeads)
                    break;
                if (!l.placeId)
                    continue;
                const nameKey = l.name.toLowerCase().trim();
                const phoneKey = l.phone && l.phone !== 'N/A' ? l.phone.replace(/\D/g, '') : null;
                if (existingPlaceIds.has(l.placeId))
                    continue;
                if (existingNames.has(nameKey))
                    continue;
                if (phoneKey && existingPhones.has(phoneKey))
                    continue;
                existingPlaceIds.add(l.placeId);
                existingNames.add(nameKey);
                if (phoneKey)
                    existingPhones.add(phoneKey);
                finalDocs.push({
                    userId,
                    name: l.name,
                    phone: l.phone,
                    additionalPhones: JSON.stringify(l.additionalPhones),
                    emails: JSON.stringify(l.emails),
                    address: l.address,
                    website: l.website,
                    linkedin: l.linkedin,
                    category: l.business_type,
                    business_type: l.business_type,
                    city: l.city,
                    location_name: l.location_name,
                    rating: l.rating,
                    reviews: l.reviews,
                    match_score: l.match_score,
                    placeId: l.placeId,
                    search_query: l.search_query,
                    status: "online"
                });
            }
        }
        job.updateProgress({ percent: 90, label: `Found ${finalDocs.length} leads. Saving...` });
        if (finalDocs.length > 0) {
            await prisma_1.default.mapLead.createMany({
                data: finalDocs
            });
        }
        // Deduct AI credits for the user
        await prisma_1.default.user.update({
            where: { id: userId },
            data: { aiUsageCount: { increment: finalDocs.length } }
        });
        job.updateProgress({ percent: 100, label: `Completed! Saved ${finalDocs.length} leads.` });
        console.log(`[BullMQ Leads] Job ${job.id} completed successfully`);
        return { inserted: finalDocs.length };
    }
    catch (error) {
        console.error(`[BullMQ Leads] Job ${job.id} failed:`, error.message);
        throw error;
    }
}, {
    connection: redis_1.redis,
    concurrency: 2,
});
exports.leadsWorker.on('completed', (job) => {
    console.log(`[Leads Worker] Job ${job.id} has completed!`);
});
exports.leadsWorker.on('failed', (job, err) => {
    console.error(`[Leads Worker] Job ${job?.id} has failed with ${err.message}`);
});
//# sourceMappingURL=leadsQueue.js.map