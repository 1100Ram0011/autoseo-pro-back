import prisma from '../config/prisma';
import { getGa4Overview } from './ga4';
import { getGscKeywords } from './gsc';
import { analyzeOmnichannelState } from './autoFixer';

export const runAnomalyDetection = async (siteId: string) => {
  try {
    const site = await prisma.site.findUnique({ 
      where: { id: siteId },
      include: { pages: true, clarityMetrics: true }
    });
    
    if (!site) return;

    console.log(`[AnomalyDetector] Fetching omnichannel data for ${site.url}...`);

    // 1. Fetch GA4 (Traffic, Engagement)
    const ga4Data = await getGa4Overview((site as any).ga4PropertyId || site.url, site.userId);
    
    // 2. Fetch GSC (Keywords, CTR)
    const gscKeywords = await getGscKeywords((site as any).gscPropertyId || site.url, site.userId, site.id);

    // 3. Fetch Lighthouse (PageSpeed, Core Web Vitals)
    // We'll extract the latest PSI data from the site's pages
    const pagesWithSpeedData = site.pages.filter(p => p.psi_data || p.lighthouse_data).map(p => {
      let speedScore = 0;
      let seoScore = 0;
      try {
        if (p.lighthouse_data) {
           const lh = JSON.parse(p.lighthouse_data);
           seoScore = lh.categories?.seo?.score || 0;
        }
        if (p.psi_data) {
           const psi = JSON.parse(p.psi_data);
           speedScore = psi.lighthouseResult?.categories?.performance?.score || 0;
        }
      } catch (e) {}
      return { url: p.url, speedScore, seoScore };
    });

    // 4. Fetch Clarity (Visitor Behavior)
    const clarityData = site.clarityMetrics?.slice(-5) || []; // Last 5 days of data

    // 5. Fetch Sitemaps/Technical (Basic status)
    const technical = {
      sitemapUrl: site.sitemap_url,
      lastCrawled: site.last_crawled,
      indexedPages: site.pages.filter(p => p.indexed).length,
      totalKnownPages: site.pages.length
    };

    // Construct Master State
    const masterState = {
      domain: site.url,
      analytics: ga4Data,
      searchConsole: gscKeywords?.keywords?.slice(0, 10), // Top 10 keywords
      lighthouse: pagesWithSpeedData,
      visitorBehavior: clarityData,
      technicalSEO: technical
    };

    console.log(`[AnomalyDetector] Master state compiled. Sending to AI...`);

    // 6. Pass to Gemini AI for Cross-Platform Correlation
    await analyzeOmnichannelState(site.id, masterState);

    console.log(`[AnomalyDetector] Completed run for site ${site.url}`);
  } catch (error) {
    console.error('[AnomalyDetector] Error:', error);
  }
};
