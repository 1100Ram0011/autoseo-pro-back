// @ts-nocheck
import { google } from "googleapis";
import prisma from '../config/prisma';

export const getGa4AccountsAndProperties = async (auth: any) => {
  const admin = google.analyticsadmin({ version: 'v1beta', auth });
  try {
    const res = await admin.accountSummaries.list({});
    return res.data.accountSummaries || [];
  } catch (err) {
    console.error('Failed to fetch GA4 properties:', err);
    return [];
  }
};

const DATE_RANGES: Record<string, { startDate: string; endDate: string }> = {
  today: { startDate: "today", endDate: "today" },
  yesterday: { startDate: "yesterday", endDate: "yesterday" },
  weekly: { startDate: "7daysAgo", endDate: "today" },
  monthly: { startDate: "30daysAgo", endDate: "today" },
};

export const getAnalyticsData = async (
  propertyId: string,
  client: any,
  range: string = "weekly",
  customStart: string | null = null,
  customEnd: string | null = null
) => {
  const analyticsData = google.analyticsdata({ version: "v1beta", auth: client });

  const dateRange =
    range === "custom" && customStart && customEnd
      ? { startDate: customStart, endDate: customEnd }
      : DATE_RANGES[range] || DATE_RANGES.weekly;

  // Fix: propertyId might already be "properties/1234" from the admin API
  const propertyName = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`;

  const [
    report,
    devices,
    countries,
    sources,
    pages,
    realtime,
    trend,
    newReturning,
    browsers,
    operatingSystems,
    landingPages,
    exitPages,
    conversions,
  ] = await Promise.all([
    // 1. Core metrics — engagedSessions at index 5
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
          { name: "bounceRate" },
          { name: "averageSessionDuration" },
          { name: "screenPageViewsPerSession" },
          { name: "engagedSessions" },
        ],
      },
    }),

    // 2. Devices
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "totalUsers" }],
      },
    }),

    // 3. Countries
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "totalUsers" }],
        limit: 50,
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      },
    }),

    // 4. Traffic sources
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
      },
    }),

    // 5. Top pages
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        limit: 25,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      },
    }),

    // 6. Realtime
    analyticsData.properties.runRealtimeReport({
      property: propertyName,
      requestBody: {
        dimensions: [
          { name: "unifiedScreenName" },
          { name: "country" },
          { name: "city" },
          { name: "deviceCategory" },
        ],
        metrics: [{ name: "activeUsers" }],
        limit: 100,
      },
    }),

    // 7. Trend
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 366,
      },
    }),

    // 8. New vs Returning
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "totalUsers" }],
      },
    }),

    // 9. Browsers
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "browser" }],
        metrics: [{ name: "totalUsers" }],
        limit: 20,
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      },
    }),

    // 10. OS
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "operatingSystem" }],
        metrics: [{ name: "totalUsers" }],
        limit: 20,
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      },
    }),

    // 11. Landing pages
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "landingPagePlusQueryString" }],
        metrics: [{ name: "sessions" }, { name: "bounceRate" }],
        limit: 25,
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      },
    }),

    // 12. Exit pages
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "bounceRate" }],
        limit: 25,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      },
    }),

    // 13. Conversions
    analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "conversions" }],
        limit: 20,
        orderBys: [{ metric: { metricName: "conversions" }, desc: true }],
      },
    }),
  ]);

  let geoHierarchyData = { rows: [] };
  try {
    const geoRes = await analyticsData.properties.runReport({
      property: propertyName,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }, { name: "region" }, { name: "city" }],
        metrics: [{ name: "totalUsers" }],
        limit: 5000,
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      },
    });
    geoHierarchyData = geoRes.data as any;
  } catch (err: any) {
    console.warn("Geo hierarchy query failed:", err.message);
  }

  return {
    report: report.data,
    devices: devices.data,
    countries: countries.data,
    sources: sources.data,
    pages: pages.data,
    realtime: realtime.data,
    trend: trend.data,
    newReturning: newReturning.data,
    browsers: browsers.data,
    operatingSystems: operatingSystems.data,
    landingPages: landingPages.data,
    exitPages: exitPages.data,
    conversions: conversions.data,
    geoHierarchy: geoHierarchyData,
  };
};

export function formatAnalytics(data: any) {
  const newReturning = { new: 0, returning: 0 };
  (data?.newReturning?.rows || []).forEach((row: any) => {
    const type = (row.dimensionValues?.[0]?.value || "").toLowerCase().trim();
    const count = Number(row.metricValues?.[0]?.value || 0);
    if (type === "new" || type.startsWith("new")) newReturning.new += count;
    else newReturning.returning += count;
  });
  const canonicalTotal = newReturning.new + newReturning.returning;

  const reportRows = data?.report?.rows || [];
  let sessions = 0,
    engagedSessions = 0;
  let bounceRate = 0,
    avgSessionDuration = 0,
    pagesPerSession = 0;

  reportRows.forEach((row: any) => {
    sessions += Number(row.metricValues?.[1]?.value || 0);
    engagedSessions += Number(row.metricValues?.[5]?.value || 0);
  });
  if (reportRows.length > 0) {
    bounceRate = parseFloat(reportRows[0]?.metricValues?.[2]?.value || 0) * 100;
    avgSessionDuration = parseFloat(reportRows[0]?.metricValues?.[3]?.value || 0);
    pagesPerSession = parseFloat(reportRows[0]?.metricValues?.[4]?.value || 0);
  }

  const devices: any = {};
  (data?.devices?.rows || []).forEach((row: any) => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    devices[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  const countries: any = {};
  (data?.countries?.rows || []).forEach((row: any) => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") countries[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  const geoTree: any = {},
    cities: any = {},
    regions: any = {};
  (data?.geoHierarchy?.rows || []).forEach((row: any) => {
    const country = row.dimensionValues?.[0]?.value;
    const region = row.dimensionValues?.[1]?.value;
    const city = row.dimensionValues?.[2]?.value;
    const u = Number(row.metricValues?.[0]?.value || 0);
    const skip = (v: string) => !v || v === "(not set)" || v.trim() === "";
    if (skip(country)) return;
    if (!geoTree[country]) geoTree[country] = { users: 0, regions: {} };
    geoTree[country].users += u;
    if (!skip(region)) {
      if (!geoTree[country].regions[region]) geoTree[country].regions[region] = { users: 0, cities: {} };
      geoTree[country].regions[region].users += u;
      if (!skip(city)) {
        geoTree[country].regions[region].cities[city] =
          (geoTree[country].regions[region].cities[city] || 0) + u;
        cities[city] = (cities[city] || 0) + u;
      }
      regions[region] = (regions[region] || 0) + u;
    }
  });

  const trafficSources: any = {};
  (data?.sources?.rows || []).forEach((row: any) => {
    const s = row.dimensionValues?.[0]?.value || "Direct";
    if (s !== "(not set)") trafficSources[s] = Number(row.metricValues?.[0]?.value || 0);
  });

  const topPages = (data?.pages?.rows || []).map((row: any) => ({
    page: row.dimensionValues?.[0]?.value || "/",
    views: Number(row.metricValues?.[0]?.value || 0),
  }));

  // Landing pages — where sessions started
  const landingPages = (data?.landingPages?.rows || []).map((row: any) => ({
    page: row.dimensionValues?.[0]?.value || "/",
    sessions: Number(row.metricValues?.[0]?.value || 0),
    bounceRate: parseFloat(row.metricValues?.[1]?.value || 0) * 100,
  }));

  // Exit pages — reusing pagePath+bounceRate report
  const exitPages = (data?.exitPages?.rows || []).map((row: any) => ({
    page: row.dimensionValues?.[0]?.value || "/",
    views: Number(row.metricValues?.[0]?.value || 0),
    bounceRate: parseFloat(row.metricValues?.[1]?.value || 0) * 100,
  }));

  const rtRows = data?.realtime?.rows || [];
  const realtimeUsers = rtRows.reduce(
    (s: number, r: any) => s + Number(r.metricValues?.[0]?.value || 0),
    0
  );

  // Full realtime breakdown (previously only the total was surfaced)
  const rtByPage: any = {};
  const rtByCountry: any = {};
  const rtByCity: any = {};
  const rtByDevice: any = {};
  rtRows.forEach((row: any) => {
    const screen = row.dimensionValues?.[0]?.value || "Unknown";
    const country = row.dimensionValues?.[1]?.value || "Unknown";
    const city = row.dimensionValues?.[2]?.value || "Unknown";
    const device = row.dimensionValues?.[3]?.value || "Unknown";
    const users = Number(row.metricValues?.[0]?.value || 0);

    rtByPage[screen] = (rtByPage[screen] || 0) + users;
    if (country !== "(not set)") rtByCountry[country] = (rtByCountry[country] || 0) + users;
    if (city !== "(not set)") rtByCity[city] = (rtByCity[city] || 0) + users;
    rtByDevice[device] = (rtByDevice[device] || 0) + users;
  });
  const sortDesc = (obj: any) =>
    Object.entries(obj)
      .map(([name, users]) => ({ name, users: users as number }))
      .sort((a, b) => b.users - a.users);

  const realtimeDetail = {
    byPage: sortDesc(rtByPage),
    byCountry: sortDesc(rtByCountry),
    byCity: sortDesc(rtByCity),
    byDevice: sortDesc(rtByDevice),
  };

  const newRatio = canonicalTotal > 0 ? newReturning.new / canonicalTotal : 0;
  const returningRatio = canonicalTotal > 0 ? newReturning.returning / canonicalTotal : 0;

  const trend = (data?.trend?.rows || []).map((row: any) => {
    const raw = row.dimensionValues?.[0]?.value || "";
    const d = raw.length === 8 ? new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`) : new Date();
    const dayUsers = Number(row.metricValues?.[0]?.value || 0);
    const daySessions = Number(row.metricValues?.[1]?.value || 0);
    return {
      date: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      users: dayUsers,
      sessions: daySessions,
      newUsers: Math.round(dayUsers * newRatio),
      returningUsers: Math.round(dayUsers * returningRatio),
    };
  });

  const browsers: any = {};
  (data?.browsers?.rows || []).forEach((row: any) => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") browsers[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  const operatingSystems: any = {};
  (data?.operatingSystems?.rows || []).forEach((row: any) => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") operatingSystems[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  const conversions = (data?.conversions?.rows || [])
    .map((row: any) => ({
      event: row.dimensionValues?.[0]?.value || "unknown",
      count: Number(row.metricValues?.[0]?.value || 0),
    }))
    .filter((c: any) => c.count > 0);

  return {
    users: canonicalTotal,
    sessions,
    bounceRate,
    avgSessionDuration,
    pagesPerSession,
    engagedUsers: engagedSessions,
    realtimeUsers,
    realtimeDetail,
    countries,
    devices,
    trafficSources,
    topPages,
    landingPages,
    exitPages,
    trend,
    newReturning,
    browsers,
    operatingSystems,
    conversions,
    geoTree,
    cities,
    regions,
  };
}

export const getGa4Overview = async (propertyId: string, userId: string) => {
  // Use the shared prisma instance (imported at top of file)
  
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleRefreshToken: true }
  });

  if (!user || !user.googleRefreshToken) {
    return { metrics: { activeUsers: 0, activeUsersChange: 0 }, trend: [] };
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });

  try {
    const data = await getAnalyticsData(propertyId, oauth2Client, 'monthly');
    return {
      metrics: {
        activeUsers: data.users || 0,
        activeUsersChange: 0 // Mock change
      },
      trend: data.trend || []
    };
  } catch (error) {
    console.error('Error in getGa4Overview:', error);
    return { metrics: { activeUsers: 0, activeUsersChange: 0 }, trend: [] };
  }
};