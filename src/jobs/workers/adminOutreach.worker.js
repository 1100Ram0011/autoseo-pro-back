import { createRequire } from "module";
import { Worker } from "bullmq";
import axios from "axios";
import crypto from "crypto";
import dns from "dns";
import tls from "tls";
import * as cheerio from "cheerio";
import redisClient from "../../config/redis.js";

const require = createRequire(import.meta.url);
let sslCheck;
try {
  sslCheck = require("ssl-check");
} catch {
  sslCheck = null;
}
import AdminOutreachProfile from "../../models/AdminOutreachProfile.js";
import {
  generateAnalysisSummary,
  runClaudeAnalysis,
} from "../../services/claude.service.js";
import ApiCredential from "../../models/ApiCredential.js";
import { decrypt } from "../../utils/crypto.js";
import logger from "../../config/logger.js";
import Handlebars from "handlebars";
import EmailTemplate from "../../models/Campaign/EmailCampaign/templateSchema.js";
import FirecrawllogModel from "../../models/Firecrawllog.model.js";
import { sendOutlookMailForNewUser } from "../../config/mailer.js";
import { sendThirdPartyApiErrorEmail } from "../../utils/emailServices.js";
import userModel from "../../models/userModel.js";
import {
  generatePdfBuffer,
  uploadPdfToS3,
} from "../../services/pdf.service.js";
import BusinessSummaryProfile from "../../models/BusinessSummaryProfile.js";
import config from "../../config/config.js";
import { runImageContentGeneration } from "../../services/runVideoImageContentGeneration.js";
import { createMediaDocument } from "../../controllers/SocialMedia/MediaStoreController.js";
import campaignSchema from "../../models/Campaign/EmailCampaign/campaignSchema.js";
import CampaignRecipientLog from "../../models/Campaign/EmailCampaign/campaignRecipientLogSchema.js";
import { bulkEmailQueue } from "../index.js";
import { extractWebsiteContacts } from "../../controllers/Auth/businessController.js";

/* ─────────────────────────────────────────────
   REDIS CONNECTIONS (dedicated — never share with queues)
───────────────────────────────────────────── */
const publisher = redisClient.duplicate();
const workerConnection = redisClient.duplicate();

publisher.on("error", (err) => {
  logger.error("[AdminOutreachWorker] Publisher Redis error", {
    error: err.message,
  });
});
workerConnection.on("error", (err) => {
  logger.error("[AdminOutreachWorker] WorkerConnection Redis error", {
    error: err.message,
  });
});

/* ─── Production-grade constants ─── */
const MAX_IMAGES = 10;
const MAX_DOWNLOAD_SIZE = 10 * 1024 * 1024; // 10 MB
const DOWNLOAD_TIMEOUT_MS = 30_000; // 30s
const FIRECRAWL_TIMEOUT_MS = 120_000; // 2 min
const EMAIL_BATCH_SIZE = 10;
const EMAIL_BATCH_PAUSE_MS = 100;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

async function emitToAdmin(adminId, event, data) {
  const payload = JSON.stringify({
    userId: adminId.toString(),
    event,
    data,
  });
  await publisher.publish("socket:user", payload);
}

async function saveFirecrawlLog({
  userId,
  websiteUrl,
  websiteHash,
  firecrawlUrl,
  response,
  status,
  errorMessage = null,
}) {
  try {
    const savedFirecrawlData = await FirecrawllogModel.create({
      userId,
      websiteUrl,
      websiteHash,
      firecrawlUrl,
      response,
      status,
      errorMessage,
    });
    return savedFirecrawlData;
  } catch (err) {
    logger.error("[AdminOutreachWorker] Failed to save Firecrawl log", {
      error: err.message,
    });
  }
}

/* ─────────────────────────────────────────────
   WEBSITE VALIDATION (mirrors firecrawl.worker checks)
───────────────────────────────────────────── */
const normalizeUrl = (url) => {
  if (!url || typeof url !== "string") return "";
  let u = url.trim();

  // If user entered "waaree.com" add https://
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;

  try {
    const parsed = new URL(u);

    // Normalize host to lowercase
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove trailing slash for consistency (except root "/")
    if (parsed.pathname !== "/") {
      // keep path, but remove trailing slashes
      parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    } else {
      // if root, force empty path (so it becomes https://domain.com)
      parsed.pathname = "";
    }

    // Remove hash
    parsed.hash = "";

    // Optional: remove default ports
    if (
      (parsed.protocol === "https:" && parsed.port === "443") ||
      (parsed.protocol === "http:" && parsed.port === "80")
    ) {
      parsed.port = "";
    }

    return parsed.toString().replace(/\/$/, ""); // ensure no ending slash
  } catch {
    // if invalid URL, return raw trimmed to let validators handle it
    return url.trim();
  }
};

export function mapAxiosError(err) {
  if (!err) return "Unknown error";
  switch (err.code) {
    case "ERR_TLS_CERT_ALTNAME_INVALID":
      return "SSL hostname mismatch";
    case "DEPTH_ZERO_SELF_SIGNED_CERT":
      return "Self-signed SSL certificate";
    case "UNABLE_TO_VERIFY_LEAF_SIGNATURE":
      return "Invalid SSL certificate chain";
    case "CERT_HAS_EXPIRED":
      return "SSL certificate expired";
    case "ECONNREFUSED":
      return "Connection refused";
    case "ENOTFOUND":
      return "Domain not found";
    case "EAI_AGAIN":
      return "DNS lookup failed";
    case "ECONNRESET":
      return "Connection reset";
    case "ETIMEDOUT":
    case "ECONNABORTED":
      return "Connection timed out";
    default:
      if (err.response?.status) {
        return `HTTP ${err.response.status}`;
      }
      return err.message || "Unknown error";
  }
}

export async function checkSSL(hostname) {
  if (sslCheck) {
    try {
      const ssl = await sslCheck(hostname);
      if (ssl && typeof ssl.valid === "boolean") {
        return { valid: ssl.valid, details: ssl };
      }
    } catch {
      // fallback to native TLS socket check
    }
  }

  return new Promise((resolve) => {
    try {
      const socket = tls.connect(
        443,
        hostname,
        { servername: hostname, timeout: 5000 },
        () => {
          const valid = socket.authorized;
          socket.end();
          resolve({ valid: Boolean(valid) });
        },
      );
      socket.on("error", () => {
        socket.destroy();
        resolve({ valid: false });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ valid: false });
      });
    } catch {
      resolve({ valid: false });
    }
  });
}

export async function fetchWithFallback(inputUrl) {
  let hostname;
  try {
    hostname = new URL(
      inputUrl.startsWith("http") ? inputUrl : `https://${inputUrl}`,
    ).hostname;
  } catch {
    return {
      success: false,
      reason: "Invalid URL format",
      attempts: [],
    };
  }

  const urls = [`https://${hostname}`];
  if (!hostname.startsWith("www.")) {
    urls.push(`https://www.${hostname}`);
  }
  urls.push(`http://${hostname}`);

  const attempts = [];

  for (const url of urls) {
    try {
      const start = Date.now();
      const response = await axios.get(url, {
        timeout: 10000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; BoradeAI-Bot/1.0; +https://boradeai.com)",
        },
      });

      const responseTime = Date.now() - start;
      const isCfChallenge =
        (response.status === 403 || response.status === 503) &&
        (response.headers?.server?.includes("cloudflare") ||
          (typeof response.data === "string" &&
            (response.data.includes("Just a moment") ||
              response.data.includes("cf-challenge") ||
              response.data.includes("turnstile") ||
              response.data.includes("security verification"))));

      attempts.push({
        url,
        success: true,
        status: response.status,
        responseTime,
        botProtected: isCfChallenge,
      });

      if ((response.status >= 200 && response.status < 400) || isCfChallenge) {
        return {
          success: true,
          workingUrl: url,
          status: response.status,
          responseTime,
          response,
          attempts,
          botProtected: isCfChallenge,
        };
      }
    } catch (err) {
      attempts.push({
        url,
        success: false,
        error: mapAxiosError(err),
      });
    }
  }

  return {
    success: false,
    reason: "No working URL found",
    attempts,
  };
}

// export async function validateWebsite(websiteUrl) {
//   const result = {
//     exists: false,
//     httpStatus: null,
//     responseTime: null,
//     errors: [],
//   };

//   // 1. Basic URL format check
//   try {
//     const parsed = new URL(websiteUrl);
//     if (!["http:", "https:"].includes(parsed.protocol)) {
//       result.errors.push("Invalid URL protocol — must be http or https");
//       return result;
//     }
//   } catch {
//     result.errors.push("Invalid URL format");
//     return result;
//   }

//   // 2. HTTP HEAD / GET reachability check
//   const start = Date.now();
//   try {
//     const resp = await axios.head(websiteUrl, {
//       timeout: 15000,
//       maxRedirects: 5,
//       validateStatus: () => true, // accept any status
//       headers: {
//         "User-Agent":
//           "Mozilla/5.0 (compatible; BoradeAI-Bot/1.0; +https://boradeai.com)",
//       },
//     });
//     result.responseTime = Date.now() - start;
//     result.httpStatus = resp.status;

//     if (resp.status >= 200 && resp.status < 400) {
//       result.exists = true;
//     } else if (resp.status === 403 || resp.status === 405) {
//       // HEAD blocked — retry with GET
//       try {
//         const getResp = await axios.get(websiteUrl, {
//           timeout: 15000,
//           maxRedirects: 5,
//           validateStatus: () => true,
//           headers: {
//             "User-Agent":
//               "Mozilla/5.0 (compatible; BoradeAI-Bot/1.0; +https://boradeai.com)",
//           },
//         });
//         result.httpStatus = getResp.status;
//         result.exists = getResp.status >= 200 && getResp.status < 400;
//       } catch {
//         result.errors.push("Website returned 403/405 and GET also failed");
//       }
//     } else {
//       result.errors.push(`Website returned HTTP ${resp.status}`);
//     }
//   } catch (err) {
//     result.responseTime = Date.now() - start;
//     if (err.code === "ENOTFOUND") {
//       result.errors.push("DNS lookup failed — domain does not exist");
//     } else if (err.code === "ECONNREFUSED") {
//       result.errors.push("Connection refused — server is down");
//     } else if (err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
//       result.errors.push("Connection timed out — server is unreachable");
//     } else if (err.code === "ERR_TLS_CERT_ALTNAME_INVALID") {
//       result.errors.push("SSL certificate error");
//     } else {
//       result.errors.push(`Connection error: ${err.message}`);
//     }
//   }

//   return result;
// }

export async function validateWebsite(websiteUrl) {
  console.log("\n=======================================================");
  console.log("🚀 Starting Website Validation");
  console.log("=======================================================");
  console.log("Input Website:", websiteUrl);

  const report = {
    website: websiteUrl,
    workingUrl: "",
    exists: false,
    live: false,
    sslValid: false,
    botProtected: false,
    httpStatus: null,
    responseTime: 0,
    redirects: [],
    robotsTxt: false,
    htmlLoaded: false,
    title: "",
    contentType: "",
    server: "",
    poweredBy: "",
    scrapeReady: false,
    issues: [],
    errors: [],
    finalStatus: "",
    attempts: [],
  };

  let normalizedUrl = "";

  try {
    // =====================================================
    // STEP 1 - Normalize URL
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 1 - URL NORMALIZATION");
    console.log("-----------------------------");

    try {
      normalizedUrl = websiteUrl.startsWith("http")
        ? websiteUrl
        : `https://${websiteUrl}`;

      const parsed = new URL(normalizedUrl);

      report.workingUrl = normalizedUrl;

      console.log("✅ Normalized URL:", normalizedUrl);
      console.log("Hostname:", parsed.hostname);
      console.log("Protocol:", parsed.protocol);
      console.log("Origin:", parsed.origin);
    } catch (err) {
      console.error("❌ Invalid URL");

      console.error(err);

      report.issues.push("Invalid URL format");
      report.errors = report.issues;
      report.finalStatus = "Invalid URL format";

      return report;
    }

    const hostname = new URL(normalizedUrl).hostname;

    // =====================================================
    // STEP 2 - DNS LOOKUP
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 2 - DNS LOOKUP");
    console.log("-----------------------------");

    const dnsStart = Date.now();

    try {
      const dnsResult = await dns.promises.lookup(hostname);

      report.exists = true;

      console.log("✅ DNS Success");
      console.log("Address:", dnsResult.address);
      console.log("Family:", dnsResult.family);
      console.log("DNS Time:", Date.now() - dnsStart, "ms");
    } catch (err) {
      console.error("❌ DNS FAILED");

      console.error(err);

      report.issues.push("DNS lookup failed — domain does not exist");
      report.errors = report.issues;
      report.finalStatus =
        "Website domain does not exist or DNS lookup failed";

      return report;
    }

    // =====================================================
    // STEP 3 - SSL VALIDATION
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 3 - SSL CHECK");
    console.log("-----------------------------");

    const sslStart = Date.now();

    try {
      const ssl = await checkSSL(hostname);

      report.sslValid = Boolean(ssl.valid);

      console.log("SSL Response:");
      console.log(ssl);

      console.log("SSL Time:", Date.now() - sslStart, "ms");

      if (report.sslValid) {
        console.log("✅ SSL Certificate Valid");
      } else {
        console.warn("⚠ Invalid SSL");

        report.issues.push("Invalid SSL certificate");
      }
    } catch (err) {
      console.error("❌ SSL CHECK FAILED");

      console.error(err);

      report.issues.push("SSL check failed");
    }

    // =====================================================
    // STEP 4 - FETCH WEBSITE
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 4 - FETCH WEBSITE");
    console.log("-----------------------------");

    const fetchStart = Date.now();

    let fallbackRes = null;
    let mainResponse = null;

    try {
      console.log("Calling fetchWithFallback()...");

      fallbackRes = await fetchWithFallback(normalizedUrl);

      console.log(
        "fetchWithFallback Time:",
        Date.now() - fetchStart,
        "ms"
      );

      console.log("fetchWithFallback Result:");
      console.dir(fallbackRes, {
        depth: null,
      });

      report.attempts = fallbackRes.attempts || [];

      if (fallbackRes.success && fallbackRes.response) {
        console.log("✅ fetchWithFallback SUCCESS");

        mainResponse = fallbackRes.response;

        report.workingUrl =
          fallbackRes.workingUrl || normalizedUrl;

        report.httpStatus =
          fallbackRes.status ||
          mainResponse.status;

        report.responseTime =
          fallbackRes.responseTime ||
          (Date.now() - fetchStart);
      } else {
        console.warn("⚠ fetchWithFallback FAILED");
        console.warn("Switching to Axios...");
        const axiosStart = Date.now();

        try {
          console.log("Axios Request URL:", normalizedUrl);

          mainResponse = await axios.get(normalizedUrl, {
            timeout: 30000,
            maxRedirects: 5,
            validateStatus: () => true,
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
              Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              "Accept-Encoding": "gzip, deflate, br",
              Connection: "keep-alive",
              "Upgrade-Insecure-Requests": "1",
            },
          });

          report.responseTime = Date.now() - axiosStart;
          report.httpStatus = mainResponse.status;

          console.log("✅ Axios Success");
          console.log("Status:", mainResponse.status);
          console.log("Time:", report.responseTime, "ms");
        } catch (err) {
          report.responseTime = Date.now() - axiosStart;

          console.error("❌ Axios Failed");
          console.error("Error Code:", err.code);
          console.error("Error Name:", err.name);
          console.error("Message:", err.message);
          console.error("URL:", err.config?.url);
          console.error("Response:", err.response?.status);

          if (err.response) {
            console.log("Response Headers:");
            console.dir(err.response.headers, {
              depth: null,
            });
          }

          const mappedErr = mapAxiosError(err);
          report.issues.push(mappedErr);
        }
      }
    } catch (err) {
      console.error("fetchWithFallback threw exception");
      console.error(err);

      report.issues.push(mapAxiosError(err));
    }

    // =====================================================
    // STEP 5 - ANALYZE RESPONSE
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 5 - RESPONSE ANALYSIS");
    console.log("-----------------------------");

    if (mainResponse) {
      console.log("HTTP Status:", mainResponse.status);

      console.log("Headers:");
      console.dir(mainResponse.headers, {
        depth: null,
      });

      report.server =
        mainResponse.headers?.server || "";

      report.poweredBy =
        mainResponse.headers?.["x-powered-by"] || "";

      report.contentType =
        mainResponse.headers?.["content-type"] || "";

      console.log("Server:", report.server);
      console.log("Powered By:", report.poweredBy);
      console.log("Content-Type:", report.contentType);

      const body =
        typeof mainResponse.data === "string"
          ? mainResponse.data
          : "";

      const isCloudflare =
        body.includes("cf-challenge") ||
        body.includes("Just a moment") ||
        body.includes("turnstile");

      const isAkamai =
        body.includes("akamai") ||
        body.includes("Reference #") ||
        body.includes("Access Denied");

      const isBotProtected =
        fallbackRes?.botProtected ||
        isCloudflare ||
        isAkamai ||
        (mainResponse.status === 403 ||
          mainResponse.status === 503);

      report.botProtected = isBotProtected;

      console.log("Bot Protection:", isBotProtected);

      if (isCloudflare)
        console.log("Cloudflare detected");

      if (isAkamai)
        console.log("Akamai detected");

      if (mainResponse.status >= 200 &&
        mainResponse.status < 500) {
        report.live = true;

        console.log("✅ Website considered LIVE");
      } else {
        console.warn("Website returned HTTP", mainResponse.status);

        report.issues.push(
          `Website returned HTTP ${mainResponse.status}`
        );
      }

      report.htmlLoaded =
        report.contentType.includes("text/html")

      console.log("HTML Loaded:", report.htmlLoaded);

      if (
        mainResponse.request?.res?.responseUrl
      ) {
        report.redirects.push(
          mainResponse.request.res.responseUrl
        );

        console.log(
          "Final URL:",
          mainResponse.request.res.responseUrl
        );
      }

      console.log("Redirect Count:", report.redirects.length);

      if (typeof mainResponse.data === "string") {
        try {
          console.log("Parsing HTML...");

          const $ = cheerio.load(mainResponse.data);

          report.title = $("title")
            .text()
            .replace(/\s+/g, " ")
            .trim();

          console.log("Page Title:", report.title);

          const canonical =
            $('link[rel="canonical"]').attr("href");

          console.log("Canonical:", canonical);

          report.canonical =
            canonical || report.workingUrl;
        } catch (err) {
          console.error("HTML Parse Failed");
          console.error(err);
        }
      }
    } else {
      console.warn("No HTTP response received.");
    }

    // =====================================================
    // STEP 6 - ROBOTS.TXT
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 6 - ROBOTS.TXT");
    console.log("-----------------------------");

    const robotsStart = Date.now();

    try {
      const robotsUrl =
        `${new URL(report.workingUrl || normalizedUrl).origin}/robots.txt`;

      console.log("Robots URL:", robotsUrl);

      const robotsResp = await axios.get(robotsUrl, {
        timeout: 15000,
        validateStatus: () => true,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        },
      });

      console.log("Robots Status:", robotsResp.status);
      console.log(
        "Robots Time:",
        Date.now() - robotsStart,
        "ms"
      );

      console.log("Robots Headers:");
      console.dir(robotsResp.headers, {
        depth: null,
      });

      if (robotsResp.status === 200) {
        report.robotsTxt = true;

        console.log("✅ robots.txt found");

        if (typeof robotsResp.data === "string") {
          console.log(
            "Robots Size:",
            Buffer.byteLength(robotsResp.data),
            "bytes"
          );

          console.log(
            "Robots Preview:\n",
            robotsResp.data.substring(0, 500)
          );
        }
      } else {
        console.warn("robots.txt not found");
      }
    } catch (err) {
      console.error("robots.txt request failed");

      console.error("Error Code:", err.code);
      console.error("Error Name:", err.name);
      console.error("Message:", err.message);

      report.robotsTxt = false;
    }

    // =====================================================
    // STEP 7 - FINAL VALIDATION
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 7 - FINAL VALIDATION");
    console.log("-----------------------------");

    report.scrapeReady =
      report.exists &&
      report.live;

    if (!report.exists)
      report.issues.push(
        "Domain could not be resolved"
      );

    if (!report.live)
      report.issues.push(
        "Website not live"
      );

    if (!report.sslValid)
      report.issues.push(
        "Invalid SSL certificate"
      );

    if (report.responseTime > 10000)
      report.issues.push(
        `Slow response (${report.responseTime} ms)`
      );

    if (report.botProtected)
      report.issues.push(
        "Bot protection detected"
      );

    if (!report.htmlLoaded)
      report.issues.push(
        "HTML document not loaded"
      );

    report.issues = [...new Set(report.issues)];

    report.errors = [...report.issues];

    console.log("Scrape Ready:", report.scrapeReady);
    console.log("Issue Count:", report.issues.length);

    if (report.issues.length) {
      console.log("\nDetected Issues:");

      report.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    } else {
      console.log("No issues detected.");
    }

    // =====================================================
    // STEP 8 - HEALTH SCORE
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 8 - HEALTH SCORE");
    console.log("-----------------------------");

    let score = 100;

    if (!report.exists)
      score -= 100;

    if (!report.live)
      score -= 40;

    if (!report.sslValid)
      score -= 15;

    if (report.botProtected)
      score -= 20;

    if (!report.htmlLoaded)
      score -= 15;

    if (report.responseTime > 10000)
      score -= 10;

    if (!report.robotsTxt)
      score -= 5;

    score = Math.max(score, 0);

    report.healthScore = score;

    console.log("Health Score:", score);

    if (score >= 90)
      console.log("Excellent");

    else if (score >= 75)
      console.log("Good");

    else if (score >= 60)
      console.log("Fair");

    else if (score >= 40)
      console.log("Poor");

    else
      console.log("Critical");
    // =====================================================
    // STEP 9 - FINAL STATUS
    // =====================================================

    console.log("\n-----------------------------");
    console.log("STEP 9 - FINAL STATUS");
    console.log("-----------------------------");

    if (report.scrapeReady) {
      if (report.botProtected) {
        report.finalStatus =
          "Website is live and HTTPS-secured but protected by anti-bot services. Browser-based scraping (Playwright/Puppeteer) is recommended.";

        console.log("⚠ Website is scrapeable with browser automation.");
      } else {
        report.finalStatus =
          "Website is live, accessible, HTTPS-secured and suitable for business analysis.";

        console.log("✅ Website is fully scrape ready.");
      }
    } else {
      if (!report.exists) {
        report.finalStatus =
          "Domain does not exist or DNS lookup failed.";
      } else if (!report.live) {
        report.finalStatus =
          "Website could not be reached.";
      } else {
        report.finalStatus =
          "Website has issues that may prevent reliable scraping.";
      }

      console.warn(report.finalStatus);
    }

    // =====================================================
    // STEP 10 - SUMMARY
    // =====================================================

    console.log("\n=======================================================");
    console.log("VALIDATION SUMMARY");
    console.log("=======================================================");

    console.table({
      Website: report.website,
      WorkingURL: report.workingUrl,
      Exists: report.exists,
      Live: report.live,
      SSL: report.sslValid,
      BotProtection: report.botProtected,
      Status: report.httpStatus,
      ResponseTime: report.responseTime + " ms",
      Robots: report.robotsTxt,
      HTML: report.htmlLoaded,
      HealthScore: report.healthScore,
      ScrapeReady: report.scrapeReady,
    });

    if (report.redirects.length) {
      console.log("\nRedirect Chain:");

      report.redirects.forEach((url, index) => {
        console.log(`${index + 1}. ${url}`);
      });
    }

    if (report.title) {
      console.log("\nTitle:");
      console.log(report.title);
    }

    if (report.canonical) {
      console.log("\nCanonical:");
      console.log(report.canonical);
    }

    if (report.server) {
      console.log("\nServer:");
      console.log(report.server);
    }

    if (report.poweredBy) {
      console.log("\nPowered By:");
      console.log(report.poweredBy);
    }

    if (report.contentType) {
      console.log("\nContent Type:");
      console.log(report.contentType);
    }

    if (report.attempts?.length) {
      console.log("\nFallback Attempts:");

      console.table(
        report.attempts.map((a) => ({
          URL: a.url,
          Success: a.success,
          Status: a.status || "-",
          Error: a.error || "-",
          Time: a.responseTime || "-",
        }))
      );
    }

    console.log("\nIssues:");

    if (!report.issues.length) {
      console.log("None");
    } else {
      report.issues.forEach((issue, index) => {
        console.log(`${index + 1}. ${issue}`);
      });
    }

    console.log("\nFinal Status:");
    console.log(report.finalStatus);

    console.log("\nComplete Report:");
    console.dir(report, {
      depth: null,
      colors: true,
    });
  } catch (err) {
    // =====================================================
    // GLOBAL ERROR HANDLER
    // =====================================================

    console.log("\n=======================================================");
    console.error("UNEXPECTED VALIDATION ERROR");
    console.log("=======================================================");

    console.error("Name:", err?.name);
    console.error("Code:", err?.code);
    console.error("Message:", err?.message);

    if (err?.config) {
      console.log("\nAxios Config:");
      console.dir(
        {
          url: err.config.url,
          method: err.config.method,
          timeout: err.config.timeout,
          headers: err.config.headers,
        },
        { depth: null }
      );
    }

    if (err?.response) {
      console.log("\nResponse:");

      console.log("Status:", err.response.status);

      console.log("Headers:");
      console.dir(err.response.headers, {
        depth: null,
      });

      if (typeof err.response.data === "string") {
        console.log("\nResponse Body Preview:");
        console.log(err.response.data.substring(0, 1000));
      } else {
        console.dir(err.response.data, {
          depth: null,
        });
      }
    }

    if (err?.stack) {
      console.log("\nStack Trace:");
      console.error(err.stack);
    }

    const mappedErr = mapAxiosError(err);

    report.issues.push(mappedErr);

    report.issues = [...new Set(report.issues)];

    report.errors = [...report.issues];

    report.finalStatus = "Website validation failed unexpectedly.";
  } finally {
    // =====================================================
    // FINISH
    // =====================================================

    console.log("\n=======================================================");
    console.log("VALIDATION FINISHED");
    console.log("=======================================================");

    console.log("Website:", report.website);
    console.log("Final URL:", report.workingUrl);
    console.log("Final Status:", report.finalStatus);
    console.log("Health Score:", report.healthScore ?? "N/A");
    console.log("Issues:", report.issues.length);
    console.log("Duration:", report.responseTime, "ms");

    console.log("=======================================================\n");
  }

  return report;
}

/* ─────────────────────────────────────────────
   EMAIL EXTRACTION & VALIDATION
───────────────────────────────────────────── */

function extractEmailsFromAnalysis(analysis) {
  const emails = new Set();

  // From contact_info
  if (analysis?.contact_info?.email) {
    const e = analysis.contact_info.email;
    if (Array.isArray(e)) e.forEach((x) => emails.add(x.toLowerCase().trim()));
    else emails.add(e.toLowerCase().trim());
  }

  if (analysis?.contact_info?.emails) {
    analysis.contact_info.emails.forEach((x) =>
      emails.add(x.toLowerCase().trim()),
    );
  }

  // From any crawled emails in the raw data
  if (analysis?.crawled_emails) {
    analysis.crawled_emails.forEach((x) => emails.add(x.toLowerCase().trim()));
  }

  return [...emails].filter((e) => /^\S+@\S+\.\S+$/.test(e));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function filterBlacklistedEmails(emails) {
  // Filter out common "no-reply", "info@", etc. that are unlikely to convert
  const blacklistPatterns = [
    /^noreply@/i,
    /^no-reply@/i,
    /^donotreply@/i,
    /^mailer-daemon@/i,
    /^postmaster@/i,
  ];

  return emails.filter(
    (email) => !blacklistPatterns.some((pattern) => pattern.test(email)),
  );
}

/* ─────────────────────────────────────────────
   PDF DATA PREPARATION
───────────────────────────────────────────── */

function preparePdfData(analysis, websiteUrl) {
  const overview = analysis?.business_overview || {};
  const target = analysis?.target_market || {};
  const scoresObj = analysis?.seo_scores || {};
  const growthScorecard = analysis?.growth_scorecard || {};

  const scores = [
    {
      label: "On-Page SEO",
      percent: (scoresObj.on_page_seo || 0) * 10,
      value: scoresObj.on_page_seo || 0,
    },
    {
      label: "Content Quality",
      percent: (scoresObj.content_quality || 0) * 10,
      value: scoresObj.content_quality || 0,
    },
    {
      label: "Keyword Optimization",
      percent: (scoresObj.keyword_optimization || 0) * 10,
      value: scoresObj.keyword_optimization || 0,
    },
    {
      label: "Authority Score",
      percent: (scoresObj.authority_score || 0) * 10,
      value: scoresObj.authority_score || 0,
    },
    {
      label: "Overall Score",
      percent: (scoresObj.overall_seo_score || 0) * 10,
      value: scoresObj.overall_seo_score || 0,
    },
  ];

  const growthScores = [
    {
      label: "SEO Readiness",
      percent: (growthScorecard.seo_readiness || 0) * 10,
      value: growthScorecard.seo_readiness || 0,
    },
    {
      label: "Paid Ads Readiness",
      percent: (growthScorecard.paid_ads_readiness || 0) * 10,
      value: growthScorecard.paid_ads_readiness || 0,
    },
    {
      label: "Content Marketing",
      percent: (growthScorecard.content_marketing_readiness || 0) * 10,
      value: growthScorecard.content_marketing_readiness || 0,
    },
    {
      label: "Conversion Optimization",
      percent: (growthScorecard.conversion_optimization_readiness || 0) * 10,
      value: growthScorecard.conversion_optimization_readiness || 0,
    },
    {
      label: "Digital Maturity",
      percent: (growthScorecard.overall_digital_maturity_score || 0) * 10,
      value: growthScorecard.overall_digital_maturity_score || 0,
    },
  ];

  // Video content plan
  const videos = (analysis?.video_content?.videos || []).map((v) => ({
    videoNumber: v.video_number,
    objective: v.objective,
    hook: v.hook_first_3_seconds,
    script: v.script,
    cta: v.cta,
    duration: v.ideal_duration_seconds,
    musicMood: v.music_mood,
    hashtags: v.hashtags || [],
    scenes: (v.scene_breakdown || []).map((s) => ({
      scene: s.scene,
      visual: s.visual,
      onScreenText: s.on_screen_text || "",
    })),
  }));

  // Image content plan
  const images = (analysis?.image_content?.images || []).map((img) => ({
    imageNumber: img.image_number,
    objective: img.objective,
    imageType: img.image_type,
    visualDescription: img.visual_description,
    headline: img.headline_text,
    supporting: img.supporting_text,
    cta: img.cta_text,
    dimensions: img.recommended_dimensions,
    brandColors: img.branding_instructions?.brand_colors || [],
    fontStyle: img.branding_instructions?.font_style || "",
    logoUsage: img.branding_instructions?.logo_usage || "",
  }));

  // Persona angles
  const personas = (analysis?.persona_specific_marketing_angles || []).map(
    (p) => ({
      name: p.persona_name,
      role: p.job_role,
      painPoints: p.pain_points || [],
      convertingMessages: p.what_message_converts || [],
    }),
  );

  // Lead magnets
  const leadMagnets = (analysis?.lead_magnet_ideas || []).map((lm) => ({
    title: lm.title,
    persona: lm.target_persona,
    channel: lm.distribution_channel,
  }));

  // SEO Clusters
  const seoClusters = (analysis?.seo_content_clusters || []).map((c) => ({
    clusterName: c.cluster_name,
    pillarPage: c.pillar_page,
    topics: c.supporting_blog_topics || [],
  }));

  // Keywords
  const keywords = analysis?.seo_performance?.keyword_analysis || {};

  return {
    year: new Date().getFullYear(),
    generatedDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    websiteUrl,
    brandName: overview.brand_name || "Unknown Brand",
    legalName: overview.legal_name,
    businessType: overview.business_type || "N/A",
    businessModel: overview.business_model || "N/A",
    valueProposition: overview.core_value_proposition || "N/A",
    industries: overview.industries || [],
    geographicFocus: overview.geographic_focus || [],
    pricingSignals: overview.pricing_signals || [],
    targetMarket: target,
    scores,
    growthScores,
    overallSeoScore: scoresObj.overall_seo_score || 0,
    overallDigitalMaturity: growthScorecard.overall_digital_maturity_score || 0,
    competitors: analysis?.competitor_analysis?.direct_competitors || [],
    indirectCompetitors:
      analysis?.competitor_analysis?.indirect_competitors || [],
    competitivePositioning:
      analysis?.competitor_analysis?.competitive_positioning_summary || "",
    digitalGaps: analysis?.digital_marketing_needs?.current_gaps || [],
    growthOpportunities:
      analysis?.digital_marketing_needs?.growth_opportunities || [],
    contentPillars: analysis?.content_strategy?.content_pillars || [],
    contentGoals: analysis?.content_strategy?.content_goals || [],
    emotionalTriggers: analysis?.content_strategy?.emotional_triggers || [],
    platformFocus: analysis?.content_strategy?.platform_focus || [],
    recommendedChannels:
      analysis?.digital_marketing_needs?.recommended_channels || [],
    tofu: analysis?.conversion_funnel_insights?.tofu_hooks || [],
    mofu: analysis?.conversion_funnel_insights?.mofu_trust_builders || [],
    bofu: analysis?.conversion_funnel_insights?.bofu_cta_optimizations || [],
    contactInfo: analysis?.contact_info || null,

    // Video & Image content plans
    videos,
    hasVideos: videos.length > 0,
    videoFormat: analysis?.video_content?.format || "",
    videoPlatforms: analysis?.video_content?.platforms || [],
    images,
    hasImages: images.length > 0,
    imagePlatforms: analysis?.image_content?.platforms || [],

    // Personas & Lead Magnets
    personas,
    hasPersonas: personas.length > 0,
    leadMagnets,
    hasLeadMagnets: leadMagnets.length > 0,

    // SEO Keywords & Clusters
    primaryKeywords: keywords.primary_keywords || [],
    secondaryKeywords: keywords.secondary_keywords || [],
    missingKeywords: keywords.missing_high_intent_keywords || [],
    seoClusters,
    hasSeoClusters: seoClusters.length > 0,

    // Branding
    branding: analysis?.branding_guidelines || null,
    brandColors: analysis?.branding_guidelines?.brand_colors || [],
    brandFonts: analysis?.branding_guidelines?.fonts || [],
    brandVisualStyle: analysis?.branding_guidelines?.visual_style || "",
    logoUrl: analysis?.branding_guidelines?.logo_url || "",

    // Execution
    postingFrequency:
      analysis?.execution_recommendations?.posting_frequency || "",
    bestPostingTimes:
      analysis?.execution_recommendations?.best_posting_times || [],
    organicVsPaid:
      analysis?.execution_recommendations?.organic_vs_paid_strategy || "",
    retargetingIdeas:
      analysis?.execution_recommendations?.retargeting_ideas || [],
    leadGenHooks:
      analysis?.execution_recommendations?.lead_generation_hooks || [],

    // Trust
    trustSignals:
      analysis?.seo_performance?.authority_and_trust?.trust_signals || [],
    complianceSignals:
      analysis?.trust_and_compliance_positioning?.compliance_signals || [],
    trustBadges:
      analysis?.trust_and_compliance_positioning?.trust_badges_to_highlight ||
      [],

    // Social
    socialLinks: analysis?.digital_marketing_needs?.social_links || {},

    // Competitive Differentiation
    differentiation: analysis?.competitive_differentiation_matrix || {},

    // ── Dynamic Brand Colors for PDF template ──
    colorPrimary:
      extractHexColor(analysis?.branding_guidelines?.brand_colors?.[1]) ||
      "#213F8F",
    colorSecondary:
      extractHexColor(analysis?.branding_guidelines?.brand_colors?.[0]) ||
      "#364153",
    colorAccent:
      extractHexColor(analysis?.branding_guidelines?.brand_colors?.[2]) ||
      "#3B5AA1",
    colorBg:
      extractHexColor(analysis?.branding_guidelines?.brand_colors?.[3]) ||
      "#F3F6FF",
  };
}

/** Extract a #RRGGBB hex color from a string or object with .hex */
function extractHexColor(v) {
  if (!v) return null;
  const str = typeof v === "object" ? v.hex || "" : String(v);
  const m = str.match(/#[0-9A-Fa-f]{6}/);
  return m ? m[0] : null;
}

/* ─────────────────────────────────────────────
   SEND OUTREACH EMAIL (with Handlebars template + real PDF attachment)
   Mirrors bulkEmail.worker.js attachment pattern
───────────────────────────────────────────── */

async function downloadFileAsBuffer(url) {
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    maxContentLength: MAX_DOWNLOAD_SIZE,
    timeout: DOWNLOAD_TIMEOUT_MS,
  });
  const buffer = Buffer.from(response.data);
  response.data = null; // Allow GC to reclaim the raw arraybuffer
  return buffer;
}

async function sendOutreachEmail(
  emails,
  pdfUrl,
  brandName,
  adminId,
  templateId,
  pdfData,
) {
  if (!emails || emails.length === 0)
    return { sent: false, error: "No emails" };

  let subject = `Website Intelligence Report for ${brandName}`;
  let htmlBody = `
    <p>Hi there,</p>
    <p>We've prepared a comprehensive website intelligence and digital marketing report for <strong>${brandName}</strong>.</p>
    <p>We've attached the full PDF report to this email for your convenience.</p>
    <p>This report highlights key SEO scores, competitor positioning, and actionable growth opportunities to enhance your digital presence.</p>
    <br/>
    <p>Best Regards,</p>
    <p><strong>BoradeAI Team</strong></p>
  `;

  // Build attachments array (same format as mailer.js expects)
  const attachments = [];

  // 1. Attach the generated PDF report
  if (pdfUrl) {
    try {
      const pdfBuffer = await downloadFileAsBuffer(pdfUrl);
      attachments.push({
        filename: `${brandName.replace(/[^a-zA-Z0-9]/g, "_")}_Report.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      });
    } catch (err) {
      logger.error(
        "[AdminOutreachWorker] Failed to download PDF for attachment:",
        {
          error: err.message,
          pdfUrl,
        },
      );
      // Continue without attachment — include link as fallback
      htmlBody = htmlBody.replace(
        "We've attached the full PDF report to this email for your convenience.",
        `You can view and download your detailed PDF report here: <br/><a href="${pdfUrl}" target="_blank">Download Analysis Report</a>`,
      );
    }
  }

  // 2. If a template was selected, compile it with Handlebars + include template attachments
  if (templateId) {
    const template = await EmailTemplate.findById(templateId);
    if (template && template.html) {
      try {
        const templateData = { ...pdfData, pdfUrl, brandName };
        const compiledHtml = Handlebars.compile(template.html);
        const compiledSubject = Handlebars.compile(template.subject || subject);
        htmlBody = compiledHtml(templateData);
        subject = compiledSubject(templateData);
      } catch (err) {
        logger.error("[AdminOutreachWorker] Handlebars compilation error:", {
          error: err.message,
        });
        // Fall back to default template above
      }

      // Include template-level attachments (same pattern as bulkEmail.worker.js)
      if (template.attachments?.length) {
        for (const att of template.attachments) {
          try {
            const fileBuffer = await downloadFileAsBuffer(att.url);
            attachments.push({
              filename: att.originalName,
              content: fileBuffer,
              contentType: att.contentType || "application/octet-stream",
            });
          } catch (err) {
            logger.error(
              `[AdminOutreachWorker] Failed to download template attachment ${att.originalName}:`,
              {
                error: err.message,
              },
            );
          }
        }
      }
    }
  }

  try {
    await sendOutlookMailForNewUser({
      to: emails,
      subject,
      htmlBody,
      attachments,
    });
    return { sent: true, subject };
  } catch (err) {
    return { sent: false, error: err.message };
  }
}

/* ─────────────────────────────────────────────
   UPDATE PROFILE HELPER (reduces boilerplate)
───────────────────────────────────────────── */

async function updateProfile(websiteHash, updates) {
  return AdminOutreachProfile.findOneAndUpdate({ websiteHash }, updates, {
    new: true,
  });
}

/* ==============================================================
   BULLMQ WORKER — admin-outreach-queue
   Full pipeline:
     1. Validate website existence
     2. Firecrawl scraping (with cache)
     3. Claude AI analysis
     4. PDF generation & S3 upload
     5. Collect & validate all contacts
     6. Compile Handlebars email template
     7. Send outreach emails
================================================================ */

const outreachWorker = new Worker(
  "admin-outreach-queue",
  async (job) => {
    let {
      adminUserId,
      websiteUrl,
      providedEmails,
      templateId,
      provider,
      campaignMail,
    } = job.data;

    console.log("🚀 Admin Outreach Job Started:", {
      jobId: job.id,
      adminUserId,
      websiteUrl,
      templateId,
    });

    const websiteHash = crypto
      .createHash("sha256")
      .update(websiteUrl)
      .digest("hex");

    try {
      /* ─────────────────────────────────────────────
         STEP 0.1 — Check BusinessSummaryProfile existence and isActive
      ───────────────────────────────────────────── */
      const coreUrl = websiteUrl
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/+$/, "");

      let websiteUrlQuery = websiteUrl;
      if (coreUrl) {
        const escapedCore = coreUrl.replace(/\./g, "\\.");
        websiteUrlQuery = new RegExp(
          `^(https?://)?(www\\.)?${escapedCore}/?$`,
          "i",
        );
      }

      const existingBSP = await BusinessSummaryProfile.findOne({
        websiteUrl: websiteUrlQuery,
        isActive: true,
      });

      const existingOutreach = await AdminOutreachProfile.findOne({
        websiteUrl: websiteUrlQuery,
        outreachStatus: { $in: ["COMPLETED", "EMAIL_SENT", "EMAILING"] },
      });

      if (existingBSP) {
        const skipMsg = `Website already exists in Analysis and is active. ${existingBSP?.websiteUrl}`;
        console.log(`⚠️ Skipping outreach job for ${websiteUrl}: ${skipMsg}`);

        await AdminOutreachProfile.findOneAndUpdate(
          { websiteHash, websiteUrl: existingBSP?.websiteUrl },
          {
            websiteUrl: existingBSP?.websiteUrl,
            websiteHash: existingBSP?.websiteHash,
            adminId: adminUserId,
            outreachStatus: "SKIPPED",
            processingStartedAt: new Date(),
            processingCompletedAt: new Date(),
            templateId: templateId || null,
            errorMessage: skipMsg,
            businessSummaryProfileId: existingBSP._id,
          },
          { upsert: true, new: true },
        );

        await emitToAdmin(adminUserId, "outreach:skipped", {
          websiteHash,
          websiteUrl,
          error: skipMsg,
        });

        return { skipped: true, reason: skipMsg };
      }

      if (existingOutreach) {
        const skipMsg = `Outreach already completed or sent for this website. Status: ${existingOutreach.outreachStatus}`;
        console.log(`⚠️ Skipping outreach job for ${websiteUrl}: ${skipMsg}`);

        await emitToAdmin(adminUserId, "outreach:skipped", {
          websiteHash,
          websiteUrl,
          error: skipMsg,
        });

        return { skipped: true, reason: skipMsg };
      }

      /* ─────────────────────────────────────────────
         STEP 0.2 — Mark as processing
      ───────────────────────────────────────────── */
      let profile = await AdminOutreachProfile.findOneAndUpdate(
        { websiteHash },
        {
          websiteUrl,
          websiteHash,
          adminId: adminUserId,
          outreachStatus: "VALIDATING",
          processingStartedAt: new Date(),
          templateId: templateId || null,
          errorMessage: null,
        },
        { upsert: true, new: true },
      );

      await emitToAdmin(adminUserId, "outreach:validating", {
        websiteHash,
        websiteUrl,
      });

      /* ─────────────────────────────────────────────
         STEP 1 — Validate website existence
         (mirrors firecrawl.worker.js pre-checks)
      ───────────────────────────────────────────── */
      console.log("🔍 Validating website:", websiteUrl);
      websiteUrl = normalizeUrl(websiteUrl);
      const validation = await validateWebsite(websiteUrl);

      await updateProfile(websiteHash, {
        websiteExists: validation.exists,
        websiteHttpStatus: validation.httpStatus,
        websiteResponseTime: validation.responseTime,
        validationErrors: validation.errors,
      });

      if (!validation.exists) {
        const errorMsg = `Website validation failed: ${validation.errors.join("; ") || "Website is unreachable"
          }`;
        console.log("❌ Website validation failed:", errorMsg);

        await updateProfile(websiteHash, {
          outreachStatus: "SKIPPED",
          errorMessage: errorMsg,
        });

        await emitToAdmin(adminUserId, "outreach:skipped", {
          websiteHash,
          websiteUrl,
          error: errorMsg,
        });

        // Don't throw — this is a soft skip, not a crash
        return { skipped: true, reason: errorMsg };
      }

      console.log("✅ Website is reachable:", {
        status: validation.httpStatus,
        responseTime: `${validation.responseTime}ms`,
      });

      /* ─────────────────────────────────────────────
         STEP 2 — Firecrawl scraping
         (with cache check, same as firecrawl.worker.js)
      ───────────────────────────────────────────── */
      await updateProfile(websiteHash, { outreachStatus: "CRAWLING" });
      await emitToAdmin(adminUserId, "outreach:crawling", {
        websiteHash,
        websiteUrl,
      });

      const credential = await ApiCredential.findOne({
        provider: "FIRECRAWL",
        isActive: true,
      }).lean();

      if (!credential) {
        throw new Error("No active Firecrawl API credential found");
      }

      const apiKey = decrypt(credential.credentials.apiKey);
      const firecrawlUrl = credential.meta?.baseUrl?.length
        ? credential.meta.baseUrl
        : "https://api.firecrawl.dev/v2/scrape";

      let firecrawlResponse, savedFirecrawlData;

      // Always make a fresh Firecrawl API call
      try {
        firecrawlResponse = await axios.post(
          firecrawlUrl,
          {
            url: websiteUrl,
            onlyMainContent: false,
            maxAge: 1728000000000,
            parsers: ["pdf"],
            formats: ["markdown", "summary", "links", "images", "branding"],
          },
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: FIRECRAWL_TIMEOUT_MS,
          },
        );

        savedFirecrawlData = await saveFirecrawlLog({
          userId: adminUserId,
          websiteUrl,
          websiteHash,
          firecrawlUrl,
          response: firecrawlResponse?.data,
          status: "success",
        });
      } catch (fcErr) {
        await saveFirecrawlLog({
          userId: adminUserId,
          websiteUrl,
          websiteHash,
          firecrawlUrl,
          response: fcErr?.response?.data || null,
          status: "failed",
          errorMessage: fcErr.message,
        });
        logger.error("[AdminOutreachWorker] Firecrawl error", {
          error: fcErr.message,
        });
        throw new Error(`Firecrawl Error: ${fcErr.message}`);
      }

      await updateProfile(websiteHash, {
        firecrawlLogId: savedFirecrawlData?._id || null,
      });

      console.log("✅ Firecrawl completed:", {
        websiteHash,
      });

      /* ─────────────────────────────────────────────
         STEP 3 — Claude AI Analysis
      ───────────────────────────────────────────── */
      await updateProfile(websiteHash, { outreachStatus: "ANALYZING" });
      await emitToAdmin(adminUserId, "outreach:analyzing", {
        websiteHash,
        websiteUrl,
      });

      const isAdminOutreach = true;

      console.log("🤖 Claude Analysis Started");
      const claudeAnalysis = await runClaudeAnalysis(
        firecrawlResponse?.data,
        adminUserId,
        isAdminOutreach,
      );
      const analysisSummary = await generateAnalysisSummary(claudeAnalysis);

      console.log("🤖 Claude Analysis Completed");

      /* ─────────────────────────────────────────────
         STEP 4a — Collect & validate all contacts
      ───────────────────────────────────────────── 
         (combine provided emails + crawled from analysis)
      ───────────────────────────────────────────── */
      const allContacts = [];

      await updateProfile(websiteHash, { outreachStatus: "EMAILS_EXTRACTING" });
      await emitToAdmin(adminUserId, "outreach:emails_extracting", {
        websiteHash,
        websiteUrl,
      });

      // A. Emails provided by admin
      if (providedEmails && Array.isArray(providedEmails)) {
        providedEmails.forEach((email) => {
          if (isValidEmail(email)) {
            allContacts.push({
              email: email.toLowerCase().trim(),
              source: "provided",
              isValid: true,
              emailStatus: "pending",
            });
          }
        });
      }

      // B. Emails extracted from advanced extraction (Firecrawl custom logic)
      try {
        const analysisEmails = await extractWebsiteContacts({ websiteUrl });
        if (
          analysisEmails &&
          analysisEmails.emails &&
          analysisEmails.emails.length > 0
        ) {
          analysisEmails.emails.forEach((email) => {
            const normalizedEmail = String(email).toLowerCase().trim();
            // Avoid duplicates
            if (
              isValidEmail(normalizedEmail) &&
              !allContacts.find((c) => c.email === normalizedEmail)
            ) {
              allContacts.push({
                email: normalizedEmail,
                source: "analysis",
                isValid: true,
                emailStatus: "pending",
              });
            }
          });
        } else {
          throw new Error("No emails found via advanced extraction");
        }
      } catch (err) {
        console.log(
          `⚠️ Advanced email extraction failed or found no emails (${err.message}). Falling back to Claude analysis...`,
        );
        const fallbackEmails = extractEmailsFromAnalysis(claudeAnalysis);
        fallbackEmails.forEach((email) => {
          const normalizedEmail = String(email).toLowerCase().trim();
          if (
            isValidEmail(normalizedEmail) &&
            !allContacts.find((c) => c.email === normalizedEmail)
          ) {
            allContacts.push({
              email: normalizedEmail,
              source: "analysis",
              isValid: true,
              emailStatus: "pending",
            });
          }
        });
      }

      // C. Emails from firecrawl response if available
      const firecrawlEmails =
        firecrawlResponse?.data?.data?.metadata?.emails || [];
      firecrawlEmails.forEach((email) => {
        const e = String(email).toLowerCase().trim();
        if (isValidEmail(e) && !allContacts.find((c) => c.email === e)) {
          allContacts.push({
            email: e,
            source: "crawled",
            isValid: true,
            emailStatus: "pending",
          });
        }
      });

      // Filter out blacklisted emails
      const filteredContacts = allContacts.filter(
        (c) => filterBlacklistedEmails([c.email]).length > 0,
      );

      // Final strict deduplication of email addresses for logs/jobs
      const uniqueEmailsSet = new Set(filteredContacts.map((c) => c.email));
      const crawledEmails = Array.from(uniqueEmailsSet);

      await updateProfile(websiteHash, {
        contacts: filteredContacts,
        crawledEmails,
      });

      console.log(
        `📧 Collected ${filteredContacts.length} valid contacts:`,
        crawledEmails,
      );

      /* ─────────────────────────────────────────────
         STEP 4b — Link BusinessSummaryProfile
         (bidirectional reference) — Must happen before image generation
      ───────────────────────────────────────────── */
      // ── BoradeAI creates an "unclaimed" BSP — userId is intentionally NOT set here.
      // It will be stamped with the real userId when the business owner onboards
      // via VerifyOtpAndStartCrawl (the email we just sent them).
      const bsp = await BusinessSummaryProfile.findOneAndUpdate(
        { websiteHash },
        {
          $set: {
            websiteUrl,
            websiteHash,
            analysis: claudeAnalysis,
            analysisSummary,
            model: "firecrawl+claude",
            whoGenerated: "boradeai",
            status: "COMPLETED",
            crawledEmails,
            verifiedEmail: crawledEmails.length > 0 ? crawledEmails[0] : "",
          },
          // Do NOT overwrite userId if a real user already owns this profile
          $setOnInsert: { userId: null },
        },
        { upsert: true, new: true },
      );

      // Link both models
      await updateProfile(websiteHash, {
        businessSummaryProfileId: bsp._id,
      });
      await BusinessSummaryProfile.findByIdAndUpdate(bsp._id, {
        adminOutreachId: profile._id,
      });

      console.log("🔗 BusinessSummaryProfile linked:", bsp._id);

      /* ─────────────────────────────────────────────
         STEP 5 — Generate Images & Save to MediaStore
      ───────────────────────────────────────────── */
      await updateProfile(websiteHash, { outreachStatus: "IMAGE_GENERATING" });
      await emitToAdmin(adminUserId, "outreach:image_generating", {
        websiteHash,
      });

      console.log("🎨 Starting image generation");
      let generatedImages = [];
      try {
        let rawImageList = null;
        let attempt = 0;
        let lastError;

        while (attempt < 3) {
          try {
            rawImageList = await runImageContentGeneration(
              adminUserId,
              websiteHash,
              true,
            );
            break;
          } catch (err) {
            lastError = err;
            attempt++;
            logger.warn(
              `[AdminOutreachWorker] Image generation failed. Retry ${attempt}/3`,
              { error: err.message },
            );
            if (attempt < 3) {
              await new Promise((res) => setTimeout(res, 3000));
            }
          }
        }

        if (!rawImageList && lastError) {
          logger.error(
            "[AdminOutreachWorker] Image generation failed completely",
            { error: lastError.message },
          );
          rawImageList = [];
        }

        logger.info("[AdminOutreachWorker] Image generation returned", {
          count: Array.isArray(rawImageList) ? rawImageList.length : 0,
        });
        if (Array.isArray(rawImageList)) {
          const imageList = rawImageList.slice(0, MAX_IMAGES);
          if (rawImageList.length > MAX_IMAGES) {
            logger.warn("[AdminOutreachWorker] Image list truncated", {
              original: rawImageList.length,
              capped: MAX_IMAGES,
            });
          }
          for (const image of imageList) {
            if (!image?.mediaUrl) continue;
            const savedMedia = await createMediaDocument({
              userId: adminUserId,
              chatId: null,
              messageId: null,
              imageThumbnailUrl: image?.imageThumbnailUrl,
              mediaUrl: image.mediaUrl,
              mediaType: "image",
              description: image?.description,
              hashtags: image?.hashtags,
              callBy: "worker",
              generationSource: "Marketing",
            });
            generatedImages.push({
              mediaUrl: image.mediaUrl,
              description: image.description,
              hashtags: image.hashtags,
            });

            await updateProfile(websiteHash, {
              $push: { mediaUrls: savedMedia._id },
            });
          }
        }
      } catch (imgErr) {
        logger.error("[AdminOutreachWorker] Image generation failed", {
          error: imgErr.message,
        });
      }

      console.log("🎬 Starting video generation");
      let generatedVideos = [];
      // try {
      //   // Must import dynamically if not exported at top level, but we imported runImageContentGeneration from runVideoImageContentGeneration
      //   const { runVideoContentGeneration } = await import("../../services/runVideoImageContentGeneration.js");
      //   const videoList = await runVideoContentGeneration(adminUserId, websiteHash);

      //   if (Array.isArray(videoList)) {
      //     for (const video of videoList) {
      //       if (!video?.videoUrl) continue;
      //       const savedMedia = await createMediaDocument({
      //         userId: adminUserId,
      //         chatId: null,
      //         messageId: null,
      //         imageThumbnailUrl: video?.imageThumbnailUrl,
      //         mediaUrl: video.videoUrl,
      //         mediaType: "video",
      //         description: video?.description,
      //         hashtags: video?.hashtags,
      //         callBy: "worker",
      //       });
      //       generatedVideos.push({
      //         mediaUrl: video.videoUrl,
      //         description: video.description,
      //       });
      //     }
      //   }
      // } catch (vidErr) {
      //   console.error("🎬 Video generation failed:", vidErr.message);
      // }

      // Fetch the populated profile to get all media references
      const populatedProfile = await AdminOutreachProfile.findOne({
        websiteHash,
      }).populate("mediaUrls");
      const populatedMedia = populatedProfile?.mediaUrls || [];

      // Extract generated images and videos from the populated array
      const populatedImages = populatedMedia.filter(
        (m) => m.mediaType === "image",
      );
      const populatedVideos = populatedMedia.filter(
        (m) => m.mediaType === "video",
      );

      /* ─────────────────────────────────────────────
         STEP 4 — Generate PDF (Now with populated media)
      ───────────────────────────────────────────── */
      await updateProfile(websiteHash, { outreachStatus: "PDF_GENERATING" });
      await emitToAdmin(adminUserId, "outreach:pdf_generating", {
        websiteHash,
      });
      console.log("📄 Generating PDF");

      const pdfData = preparePdfData(claudeAnalysis, websiteUrl);
      // Append generated images and videos to pdfData so email templates can access them
      // Using generatedImages directly to avoid any populate() or schema reference timing issues
      pdfData.generatedImages = generatedImages;
      pdfData.generatedVideos = generatedVideos;

      const pdfBuffer = await generatePdfBuffer(
        "analysis_report.html",
        pdfData,
      );
      const pdfUrl = await uploadPdfToS3(pdfBuffer);

      await updateProfile(websiteHash, {
        analysisSummary,
        model: "firecrawl+claude",
        pdfUrl,
        outreachStatus: "PDF_GENERATED",
      });

      // Update the BusinessSummaryProfile with the new PDF URL
      await BusinessSummaryProfile.findOneAndUpdate(
        { websiteHash },
        { pdfUrl },
      );

      await emitToAdmin(adminUserId, "outreach:pdf_generated", {
        websiteHash,
        pdfUrl,
      });

      console.log("📄 PDF uploaded:", pdfUrl);

      /* ─────────────────────────────────────────────
         STEP 6 — Send outreach emails
         (using selected template with Handlebars)
      ───────────────────────────────────────────── */
      if (filteredContacts.length > 0) {
        await updateProfile(websiteHash, { outreachStatus: "EMAILING" });
        await emitToAdmin(adminUserId, "outreach:emailing", {
          websiteHash,
          contactCount: filteredContacts.length,
        });

        const brandName =
          claudeAnalysis?.business_overview?.brand_name || websiteUrl;

        try {
          // 1. Create a system-level EmailCampaign for tracking in the UI
          const campaignName = `Admin Outreach: ${brandName} - ${Date.now()}`;
          const campaign = await campaignSchema.create({
            name: campaignName,
            userId: adminUserId,
            templateId: templateId || null,
            provider: provider || "system",
            companyName: brandName,
            companyAddress: "", // System default
            campaignMail: campaignMail || "info@borade.ai",
            totalRecipients: crawledEmails.length,
            sentCount: 0,
            failedCount: 0,
            status: "queued",
          });

          // 2. Prepare dynamic attachments (only the generated PDF)
          const dynamicAttachments = [];
          if (pdfUrl) {
            dynamicAttachments.push({
              originalName: `${brandName.replace(/[^a-zA-Z0-9]/g, "_")}_Report.pdf`,
              url: pdfUrl,
              contentType: "application/pdf",
            });
          }

          // Map generated images to postImage1, postImage2, etc. in pdfData for template rendering
          if (pdfData.generatedImages && pdfData.generatedImages.length > 0) {
            const post1 = pdfData.generatedImages[0] || {};
            const post2 = pdfData.generatedImages[1] || {};

            for (let i = 0; i < pdfData.generatedImages.length; i++) {
              const post = pdfData.generatedImages[i];
              if (post?.mediaUrl) {
                dynamicAttachments.push({
                  originalName: `${brandName.replace(/[^a-zA-Z0-9]/g, "_")}_Post_${i + 1}.jpg`,
                  url: post.mediaUrl,
                  contentType: "image/jpeg",
                });
              }
            }

            pdfData.postImage1 = post1.mediaUrl || "";
            pdfData.postDescription1 = post1.description || "";
            pdfData.postHashtags1 = Array.isArray(post1.hashtags)
              ? post1.hashtags.join(" ")
              : post1.hashtags || "";

            pdfData.postImage2 = post2.mediaUrl || "";
            pdfData.postDescription2 = post2.description || "";
            pdfData.postHashtags2 = Array.isArray(post2.hashtags)
              ? post2.hashtags.join(" ")
              : post2.hashtags || "";
          }

          if (pdfData.generatedVideos && pdfData.generatedVideos.length > 0) {
            for (let i = 0; i < pdfData.generatedVideos.length; i++) {
              const video = pdfData.generatedVideos[i];
              if (video?.mediaUrl) {
                dynamicAttachments.push({
                  originalName: `${brandName.replace(/[^a-zA-Z0-9]/g, "_")}_Video_${i + 1}.mp4`,
                  url: video.mediaUrl,
                  contentType: "video/mp4",
                });
              }
            }
          }

          logger.debug(
            "[AdminOutreachWorker] pdfData keys",
            Object.keys(pdfData),
          );

          // 3. Create Logs & Queue jobs
          const logEntries = crawledEmails.map((email) => ({
            campaignId: campaign._id,
            senderUserId: adminUserId,
            recipientEmail: email,
            recipientName: "",
            companyName: brandName,
            status: "queued",
          }));

          await CampaignRecipientLog.insertMany(logEntries);

          const jobs = crawledEmails.map((email) => ({
            name: "send-email",
            data: {
              campaignId: campaign._id,
              templateId,
              outReachWebsiteId: websiteUrl,
              isAdminOutreach: true,
              userId: adminUserId,
              recipientData: {
                email,
                brandName,
                pdfUrl,
                ...pdfData,
              },
              CampaignSenderEmail: campaignMail || "info@borade.ai",
              dynamicAttachments,
            },
            opts: {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            },
          }));

          // Batch email jobs to avoid Redis spikes
          for (let i = 0; i < jobs.length; i += EMAIL_BATCH_SIZE) {
            const batch = jobs.slice(i, i + EMAIL_BATCH_SIZE);
            await bulkEmailQueue.addBulk(batch);
            if (i + EMAIL_BATCH_SIZE < jobs.length) {
              await new Promise((resolve) =>
                setTimeout(resolve, EMAIL_BATCH_PAUSE_MS),
              );
            }
          }

          // Mark contacts as queued
          const queuedContacts = filteredContacts.map((c) => ({
            ...c,
            emailStatus: "queued", // Has been handed off to Campaign queue
          }));

          await updateProfile(websiteHash, {
            outreachStatus: "EMAIL_SENT", // Meaning handed off to campaign subsystem
            contactEmail: crawledEmails[0],
            contacts: queuedContacts,
            emailSentAt: new Date(),
            processingCompletedAt: new Date(),
          });

          await emitToAdmin(adminUserId, "outreach:email_sent", {
            websiteHash,
            emails: crawledEmails,
          });

          console.log(
            "✅ Outreach emails queued to EmailCampaign:",
            crawledEmails,
          );
        } catch (queueErr) {
          logger.error(
            "[AdminOutreachWorker] Failed to queue campaign:",
            queueErr,
          );

          const failedContacts = filteredContacts.map((c) => ({
            ...c,
            emailStatus: "failed",
            errorMessage: queueErr.message,
          }));

          await updateProfile(websiteHash, {
            contacts: failedContacts,
            outreachStatus: "PDF_GENERATED", // PDF is ready, queueing failed
            errorMessage: `Failed to queue campaign: ${queueErr.message}`,
          });

          await emitToAdmin(adminUserId, "outreach:email_failed", {
            websiteHash,
            error: queueErr.message,
          });
        }
      } else {
        console.log("⚠️ No valid contacts found — skipping email step");
        await updateProfile(websiteHash, {
          outreachStatus: "PDF_GENERATED",
          processingCompletedAt: new Date(),
        });

        await emitToAdmin(adminUserId, "outreach:no_contacts", {
          websiteHash,
          message: "No valid email contacts found for this website",
        });
      }

      /* ─────────────────────────────────────────────
         STEP 7 — Mark as completed
      ───────────────────────────────────────────── */
      await updateProfile(websiteHash, {
        outreachStatus:
          filteredContacts.length > 0 ? "COMPLETED" : "PDF_GENERATED",
        processingCompletedAt: new Date(),
      });

      console.log("🎉 Admin Outreach Job Completed Successfully:", {
        websiteUrl,
        contactsFound: filteredContacts.length,
      });

      await emitToAdmin(adminUserId, "outreach:completed", { websiteHash });

      return true;
    } catch (error) {
      console.error("🔥 Admin Outreach Worker Error:", error.message);

      // Notify admin via error email
      const user = await userModel.findById(adminUserId);
      try {
        await sendThirdPartyApiErrorEmail(
          {
            name: user?.name || "Admin",
            email: user?.email || "-",
            phone: user?.phone || "-",
          },
          {
            jobId: job.id,
            userId: adminUserId,
            message: error.message,
          },
        );
      } catch (emailErr) {
        console.error("Error email sending failed:", emailErr);
      }

      // Update profile with error
      await AdminOutreachProfile.findOneAndUpdate(
        { websiteHash },
        {
          outreachStatus: "FAILED",
          errorMessage: error.message,
          processingCompletedAt: new Date(),
          $inc: { retryCount: 1 },
        },
      );

      await emitToAdmin(adminUserId, "outreach:failed", {
        websiteHash,
        error: error.message,
      });

      throw error;
    }
  },
  {
    connection: workerConnection,
    concurrency: 5, // Process up to 5 websites in parallel
    skipVersionCheck: true,
    limiter: {
      max: 50, // max 50 jobs
      duration: 60000, // per minute
    },
  },
);

/* ─────────────────────────────────────────────
   GRACEFUL SHUTDOWN
───────────────────────────────────────────── */
// async function shutdownAdminOutreach(signal) {
//   logger.info(`[AdminOutreachWorker] ${signal} received — shutting down`);
//   try {
//     if (typeof outreachWorker !== 'undefined') {
//       await outreachWorker.close();
//     }
//     await publisher.quit();
//     await workerConnection.quit();
//     logger.info("[AdminOutreachWorker] Connections closed cleanly");
//   } catch (err) {
//     logger.error("[AdminOutreachWorker] Shutdown error", {
//       error: err.message,
//     });
//   }
// }

// process.on("SIGTERM", () => shutdownAdminOutreach("SIGTERM"));
// process.on("SIGINT", () => shutdownAdminOutreach("SIGINT"));
