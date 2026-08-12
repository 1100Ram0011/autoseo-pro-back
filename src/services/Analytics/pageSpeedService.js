




  import axios from "axios";

async function runPageSpeed(url, strategy) {
  const apiKey = process.env.PAGESPEED_API_KEY;

  const apiUrl =
    `https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}` +
    `&key=${apiKey}` +
    `&strategy=${strategy}` +
    `&category=performance` +
    `&category=seo` +
    `&category=accessibility` +
    `&category=best-practices`;

  const response = await axios.get(apiUrl);
  const lighthouse = response.data.lighthouseResult;
  const categories = lighthouse.categories;
  const audits = lighthouse.audits;

  const scores = {
    performance:   Math.round(categories.performance.score * 100),
    seo:           Math.round(categories.seo.score * 100),
    accessibility: Math.round(categories.accessibility.score * 100),
    bestPractices: Math.round(categories["best-practices"].score * 100),
  };

  const coreWebVitals = {
    LCP:        audits["largest-contentful-paint"]?.displayValue,
    CLS:        audits["cumulative-layout-shift"]?.displayValue,
    INP:        audits["interaction-to-next-paint"]?.displayValue,
    TBT:        audits["total-blocking-time"]?.displayValue,
    SpeedIndex: audits["speed-index"]?.displayValue,
    FCP:        audits["first-contentful-paint"]?.displayValue,
    TTFB:       audits["server-response-time"]?.displayValue,
  };

  function extractAudit(key) {
    const audit = audits[key];
    if (!audit || audit.score === null) return null;

    const score = audit.score;
    let status = "pass";
    if (score === 0)       status = "fail";
    else if (score < 0.9)  status = "warn";

    const items = [];
    if (audit.details?.items) {
      audit.details.items.slice(0, 10).forEach(item => {
        const row = {};
        if (item.url)              row.url      = item.url;
        if (item.node?.snippet)    row.snippet  = item.node.snippet.slice(0, 120);
        if (item.node?.nodeLabel)  row.label    = item.node.nodeLabel.slice(0, 80);
        if (item.totalBytes)       row.size     = formatBytes(item.totalBytes);
        if (item.wastedBytes)      row.savings  = formatBytes(item.wastedBytes);
        if (item.wastedMs)         row.time     = `${Math.round(item.wastedMs)}ms`;
        if (item.duration)         row.duration = `${Math.round(item.duration)}ms`;
        if (item.transferSize)     row.transfer = formatBytes(item.transferSize);
        if (item.source?.url)      row.url      = item.source.url;
        if (item.description)      row.description = item.description.slice(0, 100);
        if (item.selector)         row.selector = item.selector.slice(0, 80);
        if (Object.keys(row).length > 0) items.push(row);
      });
    }

    return {
      id:           key,
      title:        audit.title,
      description:  audit.description?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").slice(0, 200),
      score,
      status,
      displayValue: audit.displayValue || null,
      numericValue: audit.numericValue || null,
      items,
      itemCount:    audit.details?.items?.length || 0,
    };
  }

  const performanceAudits = [
    "render-blocking-resources", "uses-optimized-images", "uses-webp-images",
    "uses-responsive-images", "offscreen-images", "unminified-css",
    "unminified-javascript", "unused-css-rules", "unused-javascript",
    "uses-text-compression", "uses-rel-preconnect", "server-response-time",
    "redirects", "uses-rel-preload", "efficient-animated-content",
    "duplicated-javascript", "legacy-javascript", "total-blocking-time",
    "max-potential-fid", "cumulative-layout-shift", "largest-contentful-paint",
    "interactive", "speed-index", "first-contentful-paint", "dom-size",
    "critical-request-chains", "network-rtt", "network-server-latency",
    "main-thread-tasks", "bootup-time", "uses-long-cache-ttl",
    "total-byte-weight", "font-display", "third-party-summary",
    "third-party-facades", "lcp-lazy-loaded", "layout-shift-elements",
    "long-tasks", "no-document-write", "resource-summary",
  ].map(key => extractAudit(key)).filter(Boolean);

  const seoAudits = [
    "viewport", "document-title", "meta-description", "http-status-code",
    "link-text", "crawlable-anchors", "is-crawlable", "robots-txt",
    "image-alt", "hreflang", "canonical", "structured-data", "font-size", "tap-targets",
  ].map(key => extractAudit(key)).filter(Boolean);

  const accessibilityAudits = [
    "color-contrast", "image-alt", "label", "link-name", "button-name",
    "aria-allowed-attr", "aria-required-attr", "aria-valid-attr",
    "aria-valid-attr-value", "document-title", "duplicate-id-active",
    "frame-title", "heading-order", "html-has-lang", "html-lang-valid",
    "input-image-alt", "list", "listitem", "meta-viewport", "tabindex",
    "td-headers-attr", "th-has-data-cells", "valid-lang", "video-caption",
    "focusable-controls", "interactive-element-affordance", "managed-focus",
    "focus-traps", "custom-controls-labels", "custom-controls-roles",
    "visual-order-follows-dom", "offscreen-content-hidden", "use-landmarks",
  ].map(key => extractAudit(key)).filter(Boolean);

  const bestPracticesAudits = [
    "is-on-https", "no-vulnerable-libraries", "csp-xss", "errors-in-console",
    "image-aspect-ratio", "image-size-responsive", "deprecations", "js-libraries",
    "no-document-write", "geolocation-on-start", "notification-on-start",
    "password-inputs-can-be-pasted-into", "uses-passive-event-listeners",
    "meta-charset", "doctype", "charset",
  ].map(key => extractAudit(key)).filter(Boolean);

  return {
    ...scores,
    coreWebVitals,
    audits: {
      performance:   performanceAudits,
      seo:           seoAudits,
      accessibility: accessibilityAudits,
      bestPractices: bestPracticesAudits,
    },
  };
}

function formatBytes(bytes) {
  if (!bytes) return null;
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function getPageSpeed(url) {
  const [mobile, desktop] = await Promise.all([
    runPageSpeed(url, "mobile"),
    runPageSpeed(url, "desktop"),
  ]);
  return { mobile, desktop };
}
