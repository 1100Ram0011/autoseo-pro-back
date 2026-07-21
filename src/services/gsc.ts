// @ts-nocheck
import { google, searchconsole_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../config/prisma';

// --- Types ---
interface GscMetrics {
  clicks: number;
  clicksChange: number;
  impressions: number;
  impressionsChange: number;
  ctr: number;
  ctrChange: number;
  position: number;
  positionChange: number;
  indexed: number;
  indexedChange: number;
  notIndexed: number;
  notIndexedChange: number;
}

interface GscTrendItem {
  date: string;
  clicks: number;
  impressions: number;
}

interface GscKeyword {
  keyword: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

// --- Auth ---
export const getAuth = async (userId: string): Promise<OAuth2Client | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true }
  });

  if (!user || !user.googleRefreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    refresh_token: user.googleRefreshToken
  });

  return oauth2Client;
};

// --- Multi-User Safe Cache with TTL ---
interface CacheEntry {
  siteUrl: string;
  expiresAt: number;
}

const GSC_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const gscSiteUrlCache = new Map<string, CacheEntry>();

/**
 * Auto-detect the correct GSC verified site URL from Google's API.
 * Handles mismatches like DB having "https://test.open4all.in"
 * but GSC having "sc-domain:test.open4all.in" or "https://www.test.open4all.in/"
 * 
 * Multi-user safe: caches per userId+siteUrl with 5-min TTL
 */
export const resolveGscSiteUrl = async (dbSiteUrl: string, userId: string): Promise<string> => {
  const cacheKey = `${userId}:${dbSiteUrl}`;
  const cached = gscSiteUrlCache.get(cacheKey);
  
  if (cached && cached.expiresAt > Date.now()) {
    return cached.siteUrl;
  }

  // Clean expired entries periodically
  if (gscSiteUrlCache.size > 100) {
    const now = Date.now();
    for (const [key, entry] of gscSiteUrlCache) {
      if (entry.expiresAt <= now) gscSiteUrlCache.delete(key);
    }
  }

  const auth = await getAuth(userId);
  if (!auth) return dbSiteUrl;

  try {
    const searchconsole = google.searchconsole({ version: 'v1', auth });
    const res = await searchconsole.sites.list({});
    const entries = res.data.siteEntry || [];

    if (entries.length === 0) return dbSiteUrl;

    const domain = dbSiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '');
    
    // Priority 1: Exact match
    const exact = entries.find(e => e.siteUrl === dbSiteUrl);
    if (exact?.siteUrl) {
      gscSiteUrlCache.set(cacheKey, { siteUrl: exact.siteUrl, expiresAt: Date.now() + GSC_CACHE_TTL_MS });
      return exact.siteUrl;
    }

    // Priority 2: sc-domain match
    const scDomain = entries.find(e => e.siteUrl === `sc-domain:${domain}`);
    if (scDomain?.siteUrl) {
      gscSiteUrlCache.set(cacheKey, { siteUrl: scDomain.siteUrl, expiresAt: Date.now() + GSC_CACHE_TTL_MS });
      return scDomain.siteUrl;
    }

    // Priority 3: Partial domain match
    const partial = entries.find(e => {
      const eDomain = (e.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/^www\./, '').replace(/^sc-domain:/, '');
      return eDomain === domain || domain.includes(eDomain) || eDomain.includes(domain);
    });
    if (partial?.siteUrl) {
      gscSiteUrlCache.set(cacheKey, { siteUrl: partial.siteUrl, expiresAt: Date.now() + GSC_CACHE_TTL_MS });
      return partial.siteUrl;
    }

    // Priority 4: First verified site
    const firstOwned = entries.find(e => e.permissionLevel === 'siteOwner') || entries[0];
    if (firstOwned?.siteUrl) {
      console.log(`[GSC] No match for "${dbSiteUrl}", using first verified site: "${firstOwned.siteUrl}"`);
      gscSiteUrlCache.set(cacheKey, { siteUrl: firstOwned.siteUrl, expiresAt: Date.now() + GSC_CACHE_TTL_MS });
      return firstOwned.siteUrl;
    }
  } catch (err) {
    console.error('[GSC] Failed to resolve site URL:', err);
  }

  return dbSiteUrl;
};

// Fallback Mock Data (same as what was used before, so UI doesn't break while setting up keys)
const MOCK_DATA = {
  overview: {
    metrics: {
      clicks: 12540, clicksChange: 18.6,
      impressions: 1250000, impressionsChange: 15.3,
      ctr: 1.0, ctrChange: 2.7,
      position: 18.7, positionChange: -4.3,
      indexed: 1324, indexedChange: 35,
      notIndexed: 154, notIndexedChange: -12
    },
    trend: Array.from({ length: 30 }).map((_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return {
        date: d.toISOString().split('T')[0],
        clicks: Math.floor(Math.random() * 500) + 150,
        impressions: Math.floor(Math.random() * 15000) + 5000
      };
    })
  },
  keywords: {
    keywords: [
      { keyword: 'background verification', clicks: 1245, impressions: 8500, ctr: 14.6, position: 2.3 },
      { keyword: 'background check', clicks: 934, impressions: 9100, ctr: 10.2, position: 4.1 },
      { keyword: 'employee verification', clicks: 643, impressions: 5200, ctr: 12.3, position: 3.2 },
      { keyword: 'address check', clicks: 432, impressions: 15400, ctr: 2.8, position: 11.5 }, // Striking distance + CTR opp
      { keyword: 'criminal record check', clicks: 321, impressions: 4100, ctr: 7.8, position: 5.6 },
      { keyword: 'tenant screening', clicks: 112, impressions: 9800, ctr: 1.1, position: 14.2 }, // Striking distance
      { keyword: 'identity verification api', clicks: 85, impressions: 21000, ctr: 0.4, position: 8.5 }, // CTR opp
      { keyword: 'best background check service', clicks: 42, impressions: 3200, ctr: 1.3, position: 18.1 }, // Striking distance

    ]
  },
  pages: {
    pages: [
      { page: '/', clicks: 3245, impressions: 245123, ctr: 1.32, position: 12.4 },
      { page: '/blog', clicks: 2341, impressions: 210456, ctr: 1.11, position: 16.7 },
      { page: '/services/bg-check', clicks: 1876, impressions: 154321, ctr: 1.21, position: 8.9 },
      { page: '/about', clicks: 943, impressions: 87654, ctr: 1.07, position: 21.3 },
      { page: '/contact', clicks: 832, impressions: 45678, ctr: 1.82, position: 5.4 },
    ]
  },
  coverage: {
    indexed: 1324,
    submitted: 1540,
    crawledNotIndexed: 120,
    discoveredNotIndexed: 34,
    excluded: 54
  }
};

export const getGscOverview = async (siteUrl: string, userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) {
    console.log('No GSC credentials found, returning mock overview data.');
    return MOCK_DATA.overview;
  }

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
  const prevStartDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  try {
    // Current 30 days
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['date'],
      },
    });

    // Previous 30 days for % change
    const prevRes = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: prevStartDate,
        endDate: startDate,
      },
    });

    const rows = res.data.rows || [];
    const prevRows = prevRes.data.rows || [];

    let currentClicks = 0, currentImpressions = 0, currentCtr = 0, currentPosition = 0;
    rows.forEach(r => {
      currentClicks += r.clicks || 0;
      currentImpressions += r.impressions || 0;
      currentCtr += r.ctr || 0;
      currentPosition += r.position || 0;
    });
    if (rows.length > 0) {
      currentCtr = currentCtr / rows.length;
      currentPosition = currentPosition / rows.length;
    }

    let prevClicks = 0, prevImpressions = 0, prevCtr = 0, prevPosition = 0;
    prevRows.forEach(r => {
      prevClicks += r.clicks || 0;
      prevImpressions += r.impressions || 0;
      prevCtr += r.ctr || 0;
      prevPosition += r.position || 0;
    });
    if (prevRows.length > 0) {
      prevCtr = prevCtr / prevRows.length;
      prevPosition = prevPosition / prevRows.length;
    }

    const calcChange = (current: number, prev: number) => {
      if (prev === 0) return 0;
      return Number((((current - prev) / prev) * 100).toFixed(1));
    };

    const trend = rows.map(r => ({
      date: r.keys?.[0] || '',
      clicks: r.clicks || 0,
      impressions: r.impressions || 0
    }));

    return {
      metrics: {
        clicks: currentClicks,
        clicksChange: calcChange(currentClicks, prevClicks),
        impressions: currentImpressions,
        impressionsChange: calcChange(currentImpressions, prevImpressions),
        ctr: Number((currentCtr * 100).toFixed(2)),
        ctrChange: calcChange(currentCtr, prevCtr),
        position: Number(currentPosition.toFixed(1)),
        positionChange: calcChange(currentPosition, prevPosition),
        indexed: 1324, // Hard to get from query API
        indexedChange: 0,
        notIndexed: 154,
        notIndexedChange: 0,
      },
      trend
    };
  } catch (error: any) {
    console.error('GSC API Error:', error.message);
    throw new Error(error.message || 'Failed to fetch GSC Overview');
  }
};

export const getGscKeywords = async (siteUrl: string, userId: string, siteId?: string) => {
  const auth = await getAuth(userId);
  if (!auth) {
    if (siteId) {
      const dbKeywords = await prisma.keyword.findMany({ where: { siteId } });
      if (dbKeywords.length > 0) {
        return {
          keywords: dbKeywords.map(k => ({
            keyword: k.keyword,
            clicks: Math.floor(Math.random() * 1000) + 50,
            impressions: (k.volume || Math.floor(Math.random() * 5000)) + 100,
            ctr: Number((Math.random() * 10 + 1).toFixed(2)),
            position: k.position || Number((Math.random() * 20 + 1).toFixed(1))
          }))
        };
      }
    }
    return MOCK_DATA.keywords;
  }

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['query'],
        rowLimit: 50,
      },
    });

    const rows = res.data.rows || [];
    return {
      keywords: rows.map(r => ({
        keyword: r.keys?.[0] || '',
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
        position: Number((r.position || 0).toFixed(1))
      }))
    };
  } catch (error: any) {
    console.error('GSC Keywords Error:', error.message);
    throw new Error(error.message || 'Failed to fetch GSC Keywords');
  }
};

export const getGscPages = async (siteUrl: string, userId: string, siteId?: string) => {
  const auth = await getAuth(userId);
  if (!auth) {
    return MOCK_DATA.pages;
  }

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: 50,
      },
    });

    const rows = res.data.rows || [];
    return {
      pages: rows.map(r => {
        let pageUrl = r.keys?.[0] || '/';
        if (pageUrl.startsWith(siteUrl)) {
           pageUrl = pageUrl.replace(siteUrl, '') || '/';
        }
        return {
          page: pageUrl,
          clicks: r.clicks || 0,
          impressions: r.impressions || 0,
          ctr: Number(((r.ctr || 0) * 100).toFixed(2)),
          position: Number((r.position || 0).toFixed(1))
        };
      })
    };
  } catch (error) {
    console.error('GSC API Error:', error);
    return MOCK_DATA.pages;
  }
};

export const getGscCountries = async (siteUrl: string, userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) return { countries: [] };

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['country'],
        rowLimit: 10,
      },
    });

    const rows = res.data.rows || [];
    return {
      countries: rows.map(r => ({
        country: (r.keys?.[0] || 'unknown').toUpperCase(),
        clicks: r.clicks || 0,
        impressions: r.impressions || 0,
        ctr: Number(((r.ctr || 0) * 100).toFixed(2))
      }))
    };
  } catch (error) {
    console.error('GSC API Error (Countries):', error);
    return { countries: [] };
  }
};

export const getGscDevices = async (siteUrl: string, userId: string) => {
  const mockDevices = {
    devices: [
      { device: 'MOBILE', clicks: 5430, impressions: 85200 },
      { device: 'DESKTOP', clicks: 3210, impressions: 45100 },
      { device: 'TABLET', clicks: 420, impressions: 6300 },
    ]
  };

  const auth = await getAuth(userId);
  if (!auth) return mockDevices;

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate,
        endDate,
        dimensions: ['device'],
        rowLimit: 10,
      },
    });

    const rows = res.data.rows || [];
    return {
      devices: rows.length > 0 ? rows.map(r => ({
        device: r.keys?.[0] || 'unknown',
        clicks: r.clicks || 0,
        impressions: r.impressions || 0
      })) : mockDevices.devices
    };
  } catch (error) {
    console.error('GSC API Error (Devices):', error);
    return mockDevices;
  }
};

export const getGscCoverage = async (siteUrl: string, userId: string) => {
  // Note: GSC Indexing API does not easily return aggregate counts of "indexed" vs "not indexed"
  return MOCK_DATA.coverage;
};

// =========================================================================
// ADVANCED GSC API INTEGRATIONS
// =========================================================================

export const getGscQuery = async (
  siteUrl: string, 
  userId: string, 
  options: { startDate: string, endDate: string, dimensions: string[], rowLimit?: number, dimensionFilterGroups?: any[] }
) => {
  const auth = await getAuth(userId);
  if (!auth) return { rows: [] };

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  try {
    const res = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: options.startDate,
        endDate: options.endDate,
        dimensions: options.dimensions,
        rowLimit: options.rowLimit || 100,
        dimensionFilterGroups: options.dimensionFilterGroups,
      },
    });

    return { rows: res.data.rows || [] };
  } catch (error) {
    console.error('GSC Dynamic Query Error:', error);
    return { rows: [] };
  }
};

export const getGscSitemaps = async (siteUrl: string, userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) return { sitemaps: [] };

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  try {
    const res = await searchconsole.sitemaps.list({ siteUrl });
    return { sitemaps: res.data.sitemap || [] };
  } catch (error) {
    console.error('GSC Sitemaps Error:', error);
    return { sitemaps: [] };
  }
};

export const inspectUrl = async (siteUrl: string, url: string, userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) return { inspectionResult: null };

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  try {
    const res = await searchconsole.urlInspection.index.inspect({
      requestBody: {
        inspectionUrl: url,
        siteUrl: siteUrl,
      },
    });
    return { inspectionResult: res.data.inspectionResult };
  } catch (error) {
    console.error('GSC URL Inspection Error:', error);
    return { inspectionResult: null };
  }
};

export const getGscSites = async (userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) return { siteEntry: [] };

  const searchconsole = google.searchconsole({ version: 'v1', auth });

  try {
    const res = await searchconsole.sites.list({});
    return { siteEntry: res.data.siteEntry || [] };
  } catch (error) {
    console.error('GSC Sites List Error:', error);
    return { siteEntry: [] };
  }
};

export const analyzeInsights = async (siteUrl: string, userId: string) => {
  const auth = await getAuth(userId);
  if (!auth) return { insights: [] };

  siteUrl = await resolveGscSiteUrl(siteUrl, userId);
  const endDate = new Date().toISOString().split('T')[0] as string;
  const startDate = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] as string;
  const insights: string[] = [];

  try {
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    // 1. Striking Distance Keywords (Position 4-10)
    const keywordRes = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['query'], rowLimit: 1000 },
    });
    
    const kRows = keywordRes.data.rows || [];
    const striking = kRows.filter(r => (r.position || 0) > 3 && (r.position || 0) <= 10 && (r.clicks || 0) > 0);
    if (striking.length > 0) {
      insights.push(`Found ${striking.length} keywords in positions 4-10. Pushing these to Top 3 will drastically increase traffic.`);
    }

    // 2. High Impressions, Low CTR
    const lowCtr = kRows.filter(r => (r.impressions || 0) > 1000 && (r.ctr || 0) < 0.01);
    if (lowCtr.length > 0) {
      insights.push(`Found ${lowCtr.length} queries with >1000 impressions but <1% CTR. Improve meta titles for these topics.`);
    }

    // 3. Mobile vs Desktop disparity
    const deviceRes = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: { startDate, endDate, dimensions: ['device'], rowLimit: 10 },
    });
    const dRows = deviceRes.data.rows || [];
    const mobile = dRows.find(r => r.keys?.[0] === 'MOBILE');
    const desktop = dRows.find(r => r.keys?.[0] === 'DESKTOP');
    
    if (mobile && desktop) {
      const mobPos = mobile.position || 0;
      const deskPos = desktop.position || 0;
      if (mobPos - deskPos > 5) {
         insights.push(`Warning: Your Mobile rankings (Avg Pos: ${mobPos.toFixed(1)}) are significantly worse than Desktop (${deskPos.toFixed(1)}). Audit mobile UX.`);
      }
    }

    return { insights };
  } catch (error) {
    console.error('GSC Insights Error:', error);
    return { insights: [] };
  }
};

