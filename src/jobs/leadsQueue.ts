import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import prisma from '../config/prisma';
import { fetchLeadsWithGemini } from '../services/geminiLeadEngine';

export const LEADS_QUEUE_NAME = 'google-api-lead-generation-queue';

export const leadsQueue = new Queue(LEADS_QUEUE_NAME, {
  connection: redis
});

export const leadsQueueEvents = new QueueEvents(LEADS_QUEUE_NAME, {
  connection: redis
});

interface LeadJobData {
  targetMarket: string;
  geographicFocus: string;
  numberOfLeads: number;
  userId: string;
}

export const leadsWorker = new Worker<LeadJobData>(
  LEADS_QUEUE_NAME,
  async (job) => {
    const { targetMarket, geographicFocus, numberOfLeads, userId } = job.data;
    console.log(`[BullMQ Leads] Processing Job ${job.id} for user ${userId}`);
    
    try {
      job.updateProgress({ percent: 10, label: "Starting lead generation..." });

      // Check existing leads in Prisma
      job.updateProgress({ percent: 20, label: "Checking existing leads..." });
      
      const existingLeads = await prisma.mapLead.findMany({
        where: { userId },
        select: { name: true, phone: true, placeId: true }
      });

      const existingPlaceIds = new Set<string>();
      const existingNames = new Set<string>();
      const existingPhones = new Set<string>();

      existingLeads.forEach((lead) => {
        if (lead.placeId) existingPlaceIds.add(lead.placeId);
        if (lead.name) existingNames.add(lead.name.toLowerCase().trim());
        if (lead.phone && lead.phone !== 'N/A') existingPhones.add(lead.phone.replace(/\D/g, ''));
      });

      job.updateProgress({ percent: 30, label: "Fetching leads with AI..." });

      const finalDocs: any[] = [];
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
        const leads = await fetchLeadsWithGemini(targetMarket, geographicFocus, Math.ceil(buffer));

        for (const l of leads) {
          if (finalDocs.length >= numberOfLeads) break;
          if (!l.placeId) continue;

          const nameKey = l.name.toLowerCase().trim();
          const phoneKey = l.phone && l.phone !== 'N/A' ? l.phone.replace(/\D/g, '') : null;

          if (existingPlaceIds.has(l.placeId)) continue;
          if (existingNames.has(nameKey)) continue;
          if (phoneKey && existingPhones.has(phoneKey)) continue;

          existingPlaceIds.add(l.placeId);
          existingNames.add(nameKey);
          if (phoneKey) existingPhones.add(phoneKey);

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
        await prisma.mapLead.createMany({
          data: finalDocs
        });
      }

      // Deduct AI credits for the user
      await prisma.user.update({
        where: { id: userId },
        data: { aiUsageCount: { increment: finalDocs.length } }
      });

      job.updateProgress({ percent: 100, label: `Completed! Saved ${finalDocs.length} leads.` });
      
      console.log(`[BullMQ Leads] Job ${job.id} completed successfully`);
      return { inserted: finalDocs.length };
      
    } catch (error: any) {
      console.error(`[BullMQ Leads] Job ${job.id} failed:`, error.message);
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2,
  }
);

leadsWorker.on('completed', (job) => {
  console.log(`[Leads Worker] Job ${job.id} has completed!`);
});

leadsWorker.on('failed', (job, err) => {
  console.error(`[Leads Worker] Job ${job?.id} has failed with ${err.message}`);
});
