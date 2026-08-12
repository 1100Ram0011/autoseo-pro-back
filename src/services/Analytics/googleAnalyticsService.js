
import { google } from "googleapis";
import { createAnalyticsClient } from "../../config/googleAuth.js";


const DATE_RANGES = {
  today:     { startDate: "today",     endDate: "today" },
  yesterday: { startDate: "yesterday", endDate: "yesterday" },
  weekly:    { startDate: "7daysAgo",  endDate: "today" },
  monthly:   { startDate: "30daysAgo", endDate: "today" },
};

export const getAnalyticsData = async (propertyId, token, range = "weekly") => {

  const oauth2Client = createAnalyticsClient(token);
  const analyticsData = google.analyticsdata({ version: "v1beta", auth: oauth2Client });

  const dateRange = DATE_RANGES[range] || DATE_RANGES.weekly;

  // Trend chart  — daily breakdown
  const trendDays = range === "today" || range === "yesterday" ? 1
    : range === "weekly" ? 7 : 30;

  const [report, devices, countries, sources, pages, realtime, trend] = await Promise.all([

    // Total users + sessions
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }]
      }
    }),

    // Devices
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }]
      }
    }),

    // Countries
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }]
      }
    }),

    // Sources
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }]
      }
    }),

    // Top Pages
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        limit: 10
      }
    }),

    // Realtime
    analyticsData.properties.runRealtimeReport({
      property: `properties/${propertyId}`,
      requestBody: { metrics: [{ name: "activeUsers" }] }
    }),

    // Daily trend
    analyticsData.properties.runReport({
      property: `properties/${propertyId}`,
      requestBody: {
        dateRanges: [dateRange],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" } }]
      }
    }),

  ]);

  return {
    report: report.data,
    devices: devices.data,
    countries: countries.data,
    sources: sources.data,
    pages: pages.data,
    realtime: realtime.data,
    trend: trend.data,
  };
};