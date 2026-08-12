


// formatAnalytics.js
export function formatAnalytics(data) {

  // ── 1. newReturning = source of truth ────────────────────────────────
  const newReturning = { new: 0, returning: 0 };
  (data?.newReturning?.rows || []).forEach(row => {
    const type  = (row.dimensionValues?.[0]?.value || "").toLowerCase().trim();
    const count = Number(row.metricValues?.[0]?.value || 0);
    if (type === "new" || type.startsWith("new")) newReturning.new += count;
    else newReturning.returning += count;
  });
  const canonicalTotal = newReturning.new + newReturning.returning;

  // ── 2. Core metrics from report ──────────────────────────────────────
  const reportRows = data?.report?.rows || [];
  let sessions = 0, engagedSessions = 0;
  let bounceRate = 0, avgSessionDuration = 0, pagesPerSession = 0;

  reportRows.forEach(row => {
    sessions        += Number(row.metricValues?.[1]?.value || 0);
    engagedSessions += Number(row.metricValues?.[5]?.value || 0); // engagedSessions
  });
  if (reportRows.length > 0) {
    bounceRate         = parseFloat(reportRows[0]?.metricValues?.[2]?.value || 0) * 100;
    avgSessionDuration = parseFloat(reportRows[0]?.metricValues?.[3]?.value || 0);
    pagesPerSession    = parseFloat(reportRows[0]?.metricValues?.[4]?.value || 0);
  }

  // ── 3. Devices ───────────────────────────────────────────────────────
  const devices = {};
  (data?.devices?.rows || []).forEach(row => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    devices[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  // ── 4. Countries ─────────────────────────────────────────────────────
  const countries = {};
  (data?.countries?.rows || []).forEach(row => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") countries[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  // ── 4a. Geo Hierarchy ────────────────────────────────────────────────
  const geoTree = {}, cities = {}, regions = {};
  (data?.geoHierarchy?.rows || []).forEach(row => {
    const country = row.dimensionValues?.[0]?.value;
    const region  = row.dimensionValues?.[1]?.value;
    const city    = row.dimensionValues?.[2]?.value;
    const u       = Number(row.metricValues?.[0]?.value || 0);
    const skip    = v => !v || v === "(not set)" || v.trim() === "";
    if (skip(country)) return;
    if (!geoTree[country]) geoTree[country] = { users: 0, regions: {} };
    geoTree[country].users += u;
    if (!skip(region)) {
      if (!geoTree[country].regions[region])
        geoTree[country].regions[region] = { users: 0, cities: {} };
      geoTree[country].regions[region].users += u;
      if (!skip(city)) {
        geoTree[country].regions[region].cities[city] =
          (geoTree[country].regions[region].cities[city] || 0) + u;
        cities[city] = (cities[city] || 0) + u;
      }
      regions[region] = (regions[region] || 0) + u;
    }
  });

  // ── 5. Traffic sources ───────────────────────────────────────────────
  const trafficSources = {};
  (data?.sources?.rows || []).forEach(row => {
    const s = row.dimensionValues?.[0]?.value || "Direct";
    if (s !== "(not set)") trafficSources[s] = Number(row.metricValues?.[0]?.value || 0);
  });

  // ── 6. Top pages ─────────────────────────────────────────────────────
  const topPages = (data?.pages?.rows || []).map(row => ({
    page:  row.dimensionValues?.[0]?.value || "/",
    views: Number(row.metricValues?.[0]?.value || 0),
  }));

  // ── 7. Realtime ──────────────────────────────────────────────────────
  const rtRows = data?.realtime?.rows || [];
  const realtimeUsers = rtRows.reduce((s, r) => s + Number(r.metricValues?.[0]?.value || 0), 0);
  const realtimeDetails = rtRows.map(row => ({
    page:    row.dimensionValues?.[0]?.value || "(not set)",
    country: row.dimensionValues?.[1]?.value || "Unknown",
    city:    row.dimensionValues?.[2]?.value || "Unknown",
    device:  row.dimensionValues?.[3]?.value || "Unknown",
    medium:  "direct",
    users:   Number(row.metricValues?.[0]?.value || 0),
  })).filter(r => r.page !== "(not set)" && r.users > 0);

  const realtimePages = {}, realtimeCountries = {}, realtimeDevices = {};
  realtimeDetails.forEach(r => {
    realtimePages[r.page]       = (realtimePages[r.page]       || 0) + r.users;
    if (r.country !== "(not set)") realtimeCountries[r.country] = (realtimeCountries[r.country] || 0) + r.users;
    if (r.device  !== "(not set)") realtimeDevices[r.device]    = (realtimeDevices[r.device]    || 0) + r.users;
  });

  // ── 8. Trend — includes newUsers + returningUsers per day ─────────────
  const newRatio       = canonicalTotal > 0 ? newReturning.new       / canonicalTotal : 0;
  const returningRatio = canonicalTotal > 0 ? newReturning.returning / canonicalTotal : 0;

  const trend = (data?.trend?.rows || []).map(row => {
    const raw = row.dimensionValues?.[0]?.value || "";
    const d = raw.length === 8
      ? new Date(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`)
      : new Date();
    const dayUsers    = Number(row.metricValues?.[0]?.value || 0);
    const daySessions = Number(row.metricValues?.[1]?.value || 0);
    return {
      date:           d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      users:          dayUsers,
      sessions:       daySessions,
      // Estimated per-day new/returning based on overall ratio
      newUsers:       Math.round(dayUsers * newRatio),
      returningUsers: Math.round(dayUsers * returningRatio),
    };
  });

  // ── 9. Browsers ──────────────────────────────────────────────────────
  const browsers = {};
  (data?.browsers?.rows || []).forEach(row => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") browsers[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  // ── 10. OS ───────────────────────────────────────────────────────────
  const operatingSystems = {};
  (data?.operatingSystems?.rows || []).forEach(row => {
    const k = row.dimensionValues?.[0]?.value || "Unknown";
    if (k !== "(not set)") operatingSystems[k] = Number(row.metricValues?.[0]?.value || 0);
  });

  // ── 11. Landing pages ────────────────────────────────────────────────
  const landingPages = (data?.landingPages?.rows || []).map(row => ({
    page:       row.dimensionValues?.[0]?.value || "/",
    sessions:   Number(row.metricValues?.[0]?.value || 0),
    bounceRate: parseFloat(row.metricValues?.[1]?.value || 0) * 100,
  }));

  // ── 12. Exit pages ───────────────────────────────────────────────────
  const exitPages = (data?.exitPages?.rows || []).map(row => ({
    page:     row.dimensionValues?.[0]?.value || "/",
    exits:    Number(row.metricValues?.[0]?.value || 0),
    exitRate: parseFloat(row.metricValues?.[1]?.value || 0) * 100,
  }));

  // ── 13. Conversions ──────────────────────────────────────────────────
  const conversions = (data?.conversions?.rows || [])
    .map(row => ({
      event: row.dimensionValues?.[0]?.value || "unknown",
      count: Number(row.metricValues?.[0]?.value || 0),
    }))
    .filter(c => c.count > 0);

  return {
    users:              canonicalTotal,   // new + returning = canonical total
    sessions,
    bounceRate,
    avgSessionDuration,
    pagesPerSession,
    engagedUsers:       engagedSessions,  // ← real value from GA4
    realtimeUsers,
    realtimeDetails,
    realtimePages,
    realtimeCountries,
    realtimeDevices,
    realtimeSources:    {},
    countries,
    devices,
    trafficSources,
    topPages,
    trend,              // includes newUsers + returningUsers per day
    newReturning,
    browsers,
    operatingSystems,
    landingPages,
    exitPages,
    conversions,
    geoTree,
    cities,
    regions,
  };
} 