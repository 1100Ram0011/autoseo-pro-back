import cron from 'node-cron';
import prisma from '../config/prisma';
import { runAnomalyDetection } from '../services/anomalyDetector';

export const initNightlyMonitor = () => {
  // Run every night at 12:00 AM
  cron.schedule('0 0 * * *', async () => {
    console.log('[Cron] Starting Nightly AI Anomaly Monitor...');
    
    try {
      const sites = await prisma.site.findMany();
      
      for (const site of sites) {
        console.log(`[Cron] Analyzing site: ${site.url}`);
        await runAnomalyDetection(site.id);
      }
      
      console.log('[Cron] Nightly Monitor completed successfully.');
    } catch (error) {
      console.error('[Cron] Error running Nightly Monitor:', error);
    }
  });
  
  console.log('🕰️ AI Anomaly Monitor Cron Job scheduled for 12:00 AM daily.');
};
