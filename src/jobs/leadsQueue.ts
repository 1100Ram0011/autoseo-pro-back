import { Queue, Worker, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import prisma from '../config/prisma';
import { fetchLeadsWithGemini } from '../services/geminiLeadEngine';
import { setLeadProgress } from '../services/scraperProgress';
import { emitToUser } from '../socket';

export const LEADS_QUEUE_NAME = 'google-api-lead-generation-queue';

export const leadsQueue = new Queue(LEADS_QUEUE_NAME, { connection: redis, skipVersionCheck: true });
interface LeadJobData {
  targetMarket: string;
  geographicFocus: string;
  numberOfLeads: number;
  userId: string;
}

/** Emit to socket AND persist to Redis for polling fallback */
async function emitProgress(userId: string, event: string, data: Record<string, any> = {}) {
  emitToUser(userId, event, data);
  await setLeadProgress({ userId, event, data });
}

export const leadsWorker = new Worker<LeadJobData>(
  LEADS_QUEUE_NAME,
  async (job) => {
    const { targetMarket, geographicFocus, numberOfLeads, userId } = job.data;
    const jobId = job.id;
    console.log(`[BullMQ Leads] Processing Job ${jobId} for user ${userId}`);

    try {
      await emitProgress(userId, 'lead:started', {
        jobId,
        targetMarket,
        geographicFocus,
        numberOfLeads,
        percent: 5,
        label: 'Starting lead generation…',
      });

      await emitProgress(userId, 'lead:progress', {
        percent: 15,
        label: 'Checking existing leads…',
      });

      const existingLeads = await prisma.mapLead.findMany({
        where: { userId },
        select: { name: true, phone: true, placeId: true },
      });

      const existingPlaceIds = new Set<string>();
      const existingNames = new Set<string>();
      const existingPhones = new Set<string>();

      existingLeads.forEach((lead) => {
        if (lead.placeId) existingPlaceIds.add(lead.placeId);
        if (lead.name) existingNames.add(lead.name.toLowerCase().trim());
        if (lead.phone && lead.phone !== 'N/A') existingPhones.add(lead.phone.replace(/\D/g, ''));
      });

      const finalDocs: any[] = [];
      let attempt = 0;
      const maxAttempts = 15;
      let emptyAttempts = 0;

      while (finalDocs.length < numberOfLeads && attempt < maxAttempts) {
        attempt++;
        const needed = numberOfLeads - finalDocs.length;

        await emitProgress(userId, 'lead:progress', {
          percent: Math.min(90, 25 + attempt * 5),
          label:
            attempt === 1
              ? 'Generating Leads…'
              : `Fetching ${needed} more leads (attempt ${attempt})…`,
        });

        const buffer = Math.min(needed + 20, Math.ceil(needed * 1.2));
        const leads = await fetchLeadsWithGemini(
          targetMarket,
          geographicFocus,
          Math.ceil(buffer),
          async (pct: number, label: string) => {
            await emitProgress(userId, 'lead:progress', { percent: pct, label });
          }
        );

        if (leads.length === 0) {
          emptyAttempts++;
          if (emptyAttempts >= 2) break;
        } else {
          emptyAttempts = 0;
        }

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
            additionalPhones: JSON.stringify(l.additionalPhones || []),
            emails: JSON.stringify(l.emails || []),
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
            status: 'online',
          });
        }
      }

      await emitProgress(userId, 'lead:saving', {
        percent: 88,
        label: `Found ${finalDocs.length} leads. Saving…`,
      });

      if (finalDocs.length > 0) {
        await prisma.mapLead.createMany({ data: finalDocs });
      }

      // Compute stats
      const totalInDb = await prisma.mapLead.count({ where: { userId } });
      const allLeads = await prisma.mapLead.findMany({
        where: { userId },
        select: { rating: true, emails: true },
      });
      const avgRating = allLeads.length
        ? (allLeads.reduce((s, l) => s + (l.rating || 0), 0) / allLeads.length).toFixed(1)
        : '0.0';
      const leadsWithEmails = allLeads.filter(
        (l) => l.emails && l.emails !== '[]' && l.emails !== ''
      ).length;

      await emitProgress(userId, 'lead:completed', {
        percent: 100,
        inserted: finalDocs.length,
        totalInDb,
        avg_rating: avgRating,
        leads_with_emails: leadsWithEmails,
        label: `${finalDocs.length} leads generated`,
      });

      console.log(`[BullMQ Leads] Job ${jobId} completed — inserted ${finalDocs.length}`);
      return { inserted: finalDocs.length };
    } catch (error: any) {
      console.error(`[BullMQ Leads] Job ${jobId} failed:`, error.message);

      await emitProgress(userId, 'lead:failed', {
        percent: 0,
        label: 'Lead generation failed',
        error: error.message,
      });

      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2,
    metrics: { maxDataPoints: 0 }
  }
);

leadsWorker.on('completed', (job) => {
  console.log(`[Leads Worker] Job ${job.id} has completed!`);
});

leadsWorker.on('failed', (job, err) => {
  console.error(`[Leads Worker] Job ${job?.id} has failed with ${err.message}`);
});
