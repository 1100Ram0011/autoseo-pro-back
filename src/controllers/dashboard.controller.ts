import { Request, Response } from 'express';
import prisma from '../config/prisma';
import { getGscOverview, getGscKeywords } from '../services/gsc';
import { getGa4Overview } from '../services/ga4';

export const getDashboardData = async (req: Request, res: Response) => {
  const siteId = req.params.id as string;

  try {
    const site = await prisma.site.findUnique({ 
      where: { id: siteId },
      include: { pages: true } 
    });

    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Parallel fetch from GSC and GA4
    const [gscOverview, gscKeywords, ga4Overview] = await Promise.all([
      getGscOverview((site as any).gscPropertyId || site.url, site.userId),
      getGscKeywords((site as any).gscPropertyId || site.url, site.userId, site.id),
      getGa4Overview((site as any).ga4PropertyId || site.url, site.userId)
    ]);

    // Calculate SEO Health Score from Lighthouse data
    let totalScore = 0;
    let auditedPages = 0;
    let issues: any[] = [];

    site.pages.forEach(page => {
      if (page.lighthouse_data) {
        try {
          const lh = JSON.parse(page.lighthouse_data);
          const seoScore = lh.categories?.seo?.score || 0;
          totalScore += seoScore;
          auditedPages++;
          
          // Generate issues based on Lighthouse audits (mocking a few if low score)
          if (lh.audits) {
             if (lh.audits['document-title'] && lh.audits['document-title'].score === 0) {
                 issues.push({ color: '#EF4444', text: `Page missing title: ${page.url}`, url: page.url });
             }
             if (lh.audits['meta-description'] && lh.audits['meta-description'].score === 0) {
                 issues.push({ color: '#F59E0B', text: `Page missing meta description: ${page.url}`, url: page.url });
             }
             if (lh.audits['image-alt'] && lh.audits['image-alt'].score === 0) {
                 issues.push({ color: '#F59E0B', text: `Images missing alt text on ${page.url}`, url: page.url });
             }
          }
        } catch (e) {}
      }
    });

    let averageSeoScore = auditedPages > 0 ? Math.round((totalScore / auditedPages) * 100) : 0;
    
    // Add mock issues if no audits have run yet to populate UI
    if (auditedPages === 0) {
       issues = [
         { color: '#EF4444', text: 'Run an audit to discover SEO issues' },
       ];
    } else if (issues.length === 0) {
       issues = [
         { color: '#10B981', text: 'No critical SEO issues found!' },
       ];
    }

    // Deduplicate or limit issues
    issues = issues.slice(0, 4);

    // We can fetch user apiKey to see if WP might be connected, and googleRefreshToken for Google connection
    const user = await prisma.user.findUnique({ where: { id: site.userId }});
    const hasGoogleToken = !!user?.googleRefreshToken;

    // If site has specific property IDs OR user has connected their Google account generally
    const isGscConnected = !!((site as any).gscPropertyId || hasGoogleToken);
    const isGa4Connected = !!((site as any).ga4PropertyId || hasGoogleToken);

    const isApiGenerated = !!(user as any)?.apiKey;

    res.json({
      metrics: {
        seoHealthScore: averageSeoScore,
        visitorsThisWeek: ga4Overview?.metrics?.activeUsers || 0,
        visitorsChange: ga4Overview?.metrics?.activeUsersChange || 0,
        pagesIndexed: gscOverview?.metrics?.indexed || 0,
        pagesNotIndexed: gscOverview?.metrics?.notIndexed || 0,
        keywordsTracked: gscKeywords?.keywords?.length || 0,
        keywordsTop10: gscKeywords?.keywords?.filter((k: any) => k.position <= 10).length || 0,
      },
      healthReport: {
        issues
      },
      roadmap: {
        isGscConnected,
        isGa4Connected,
        isApiGenerated
      },
      trafficTrend: ga4Overview?.trend || [],
      keywordTrend: gscOverview?.trend || [] // reusing GSC impressions trend as fallback
    });

  } catch (error) {
    console.error('Failed to fetch dashboard data:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
};
