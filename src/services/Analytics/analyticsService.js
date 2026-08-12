

// analyticsService.js — engagedSessions added at metric index 5
import { google } from "googleapis";

const DATE_RANGES = {
  today:     { startDate: "today",     endDate: "today"     },
  yesterday: { startDate: "yesterday", endDate: "yesterday" },
  weekly:    { startDate: "7daysAgo",  endDate: "today"     },
  monthly:   { startDate: "30daysAgo", endDate: "today"     },
};

export const getAnalyticsData = async (
  propertyId, client, range = "weekly", customStart = null, customEnd = null
) => {
  const analyticsData = google.analyticsdata({ version: "v1beta", auth: client });

  const dateRange =
    range === "custom" && customStart && customEnd
      ? { startDate: customStart, endDate: customEnd }
      : (DATE_RANGES[range] || DATE_RANGES.weekly);

  const [
    report, devices, countries, sources, pages,
    realtime, trend, newReturning, browsers,
    operatingSystems, landingPages, exitPages, conversions,
  ] = await Promise.all([

    // 1. Core metrics — engagedSessions at index 5
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        metrics: [
          { name: "totalUsers" },              // index 0
          { name: "sessions" },                // index 1
          { name: "bounceRate" },              // index 2
          { name: "averageSessionDuration" },  // index 3
          { name: "screenPageViewsPerSession" },// index 4
          { name: "engagedSessions" },         // index 5 ← Engaged Users
        ],
      },
    }),

    // 2. Devices
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "totalUsers" }],
      },
    }),

    // 3. Countries
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
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
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
      },
    }),

    // 5. Top pages
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
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
      property: `properties/${propertyId}`,
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

    // 7. Trend — totalUsers + limit 366
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [
          { name: "totalUsers" },
          { name: "sessions" },
        ],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 366,
      },
    }),

    // 8. New vs Returning
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "totalUsers" }],
      },
    }),

    // 9. Browsers
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
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
      property: `properties/${propertyId}`,
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
      property: `properties/${propertyId}`,
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
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }, { name: "bounceRate" }],
        limit: 25,
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      },
    }),
    // Promise.all mein yeh add karo
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "conversions" }],
        limit: 20,
        orderBys: [{ metric: { metricName: "conversions" }, desc: true }],
      },
    }),

    // 13. Conversions
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "conversions" }],
        limit: 20,
        orderBys: [{ metric: { metricName: "conversions" }, desc: true }],
      },
    }),
  ]);
  

  // Geo hierarchy
  let geoHierarchyData = { rows: [] };
  try {
    const geoRes = await analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }, { name: "region" }, { name: "city" }],
        metrics: [{ name: "totalUsers" }],
        limit: 5000,
        orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      },
    });
    geoHierarchyData = geoRes.data;
  } catch (err) {
    console.warn("Geo hierarchy query failed:", err.message);
  }

  return {
    report: report.data, devices: devices.data, countries: countries.data,
    sources: sources.data, pages: pages.data, realtime: realtime.data,
    trend: trend.data, newReturning: newReturning.data, browsers: browsers.data,
    operatingSystems: operatingSystems.data, landingPages: landingPages.data,
    exitPages: exitPages.data, conversions: conversions.data,
    geoHierarchy: geoHierarchyData,
  };
};