import cron from 'node-cron';
import prisma from '../config/prisma';
import { getGscQuery } from '../services/gsc';

export const runRankTracker = async () => {
  console.log('📈 Starting Daily Rank Tracker...');
  
  try {
    // 1. Get all tracked keywords with their associated sites
    const keywords = await prisma.keyword.findMany({
      include: {
        site: true
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date().toISOString().split('T')[0]!;
    const startDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!; // Last 3 days to get stable data

    for (const kw of keywords) {
      if (!kw.site.userId) continue;

      try {
        // 2. Query GSC for the exact keyword
        const gscData = await getGscQuery(kw.site.url, kw.site.userId, {
          startDate,
          endDate,
          dimensions: ['query'],
          dimensionFilterGroups: [
            {
              filters: [
                { dimension: 'query', expression: kw.keyword, operator: 'equals' }
              ]
            }
          ]
        });

        const rows = gscData?.rows || [];
        
        let newPosition = kw.position;
        let newVolume = kw.volume;

        if (rows.length > 0) {
          newPosition = Math.round(rows[0]?.position || 0);
          newVolume = rows[0]?.impressions || 0;

          // Update the main keyword record
          await prisma.keyword.update({
            where: { id: kw.id },
            data: {
              position: newPosition,
              volume: newVolume,
            }
          });
        }

        // 3. Save to History Table
        await prisma.keywordRankingHistory.upsert({
          where: {
            keywordId_date: {
              keywordId: kw.id,
              date: today,
            }
          },
          update: {
            position: newPosition,
            volume: newVolume,
          },
          create: {
            keywordId: kw.id,
            date: today,
            position: newPosition,
            volume: newVolume,
          }
        });
        
        // Sleep to avoid hitting GSC API limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        console.error(`Failed to check rank for keyword ${kw.keyword}:`, err.message);
      }
    }
    
    console.log('✅ Daily Rank Tracker completed.');
  } catch (error) {
    console.error('❌ Failed to run Rank Tracker:', error);
  }
};

// Start cron job to run every night at 2:00 AM
export const initRankTrackerCron = () => {
  cron.schedule('0 2 * * *', () => {
    runRankTracker();
  });
  console.log('🕰️ Rank Tracker Cron Job scheduled for 2:00 AM daily.');
};
