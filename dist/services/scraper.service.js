"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scrapeWebsite = void 0;
const axios_1 = __importDefault(require("axios"));
const puppeteer_1 = __importDefault(require("puppeteer"));
const url_1 = require("url");
// Cache the Turndown script so we don't have to fetch it repeatedly
let cachedTurndownScript = null;
const getTurndownScript = async () => {
    if (cachedTurndownScript)
        return cachedTurndownScript;
    try {
        const res = await axios_1.default.get("https://unpkg.com/turndown/dist/turndown.js");
        cachedTurndownScript = res.data;
        return cachedTurndownScript;
    }
    catch (err) {
        console.error("[SCRAPER] Failed to fetch Turndown from CDN. Fallbacks will be used.");
        return "";
    }
};
/**
 * Helper to quickly verify if a URL is reachable, and automatically resolve WWW fallbacks
 * before wasting time in the headless browser.
 */
const resolveValidUrl = async (targetUrl) => {
    try {
        // Quick ping to check if DNS resolves
        await axios_1.default.get(targetUrl, {
            timeout: 8000,
            headers: { "User-Agent": "Mozilla/5.0" },
        });
        return targetUrl;
    }
    catch (err) {
        // If DNS completely fails or connection times out, try www.
        if (err.code === "ENOTFOUND" ||
            err.code === "ETIMEDOUT" ||
            err.message?.includes("timeout")) {
            const urlObj = new url_1.URL(targetUrl);
            if (!urlObj.hostname.startsWith("www.")) {
                urlObj.hostname = "www." + urlObj.hostname;
                const wwwUrl = urlObj.toString();
                try {
                    await axios_1.default.get(wwwUrl, {
                        timeout: 8000,
                        headers: { "User-Agent": "Mozilla/5.0" },
                    });
                    return wwwUrl; // WWW works!
                }
                catch (e) {
                    // Both failed, return original and let Puppeteer handle the error
                }
            }
        }
        return targetUrl;
    }
};
/**
 * Scrapes a website using a stealthy headless browser to extract text, links, images, and branding info.
 * Implements advanced "God Mode" anti-bot bypass techniques to evade detection from services like
 * Cloudflare, disable-devtool, and basic fingerprinting.
 *
 * @param {string} formattedUrl - The target website URL to scrape
 * @returns {Promise<Object>} An object containing markdown text, images, iframes, metadata, links, and branding details
 * @throws {Error} If the scraper fails to extract any valid content or crashes
 */
const scrapeWebsite = async (formattedUrl) => {
    // Pre-flight check to resolve WWW and verify existence
    const resolvedUrl = await resolveValidUrl(formattedUrl);
    if (resolvedUrl !== formattedUrl) {
        console.log(`[SCRAPER] Auto-Resolved URL to: ${resolvedUrl}`);
        formattedUrl = resolvedUrl;
    }
    let browser = null;
    let firecrawlLikeData = {
        url: formattedUrl,
        markdown: "",
        metadata: {},
        links: [],
        images: [],
        iframes: [],
        branding: {},
    };
    try {
        console.log(`[SCRAPER] Initializing Stealth Puppeteer browser...`);
        // Add proxy support to prevent IP reputation bans in production (AWS/DigitalOcean)
        // To use this, the user just needs to set a PROXY_URL environment variable (e.g., PROXY_URL=http://user:pass@proxy-ip:port)
        const puppeteerArgs = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--disable-features=IsolateOrigins,site-per-process",
        ];
        if (process.env.PROXY_URL) {
            console.log(`[SCRAPER] Using proxy for routing...`);
            puppeteerArgs.push(`--proxy-server=${process.env.PROXY_URL}`);
        }
        browser = await puppeteer_1.default.launch({
            headless: true,
            // @ts-ignore
            ignoreHTTPSErrors: true,
            args: puppeteerArgs,
        });
        const page = await browser.newPage();
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        // Explicitly emulate a real user's browser environment (Updated to Latest Chrome to bypass Cloudflare)
        await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36");
        await page.setViewport({ width: 1920, height: 1080 });
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => false });
            // Spoof outer dimensions to hide headless mode differences (common disable-devtool check)
            Object.defineProperty(window, "outerWidth", {
                get: () => window.innerWidth,
            });
            Object.defineProperty(window, "outerHeight", {
                get: () => window.innerHeight,
            });
            // Block programmatic navigation fallback used by disable-devtool to redirect to blank pages
            window.addEventListener("beforeunload", (e) => {
                if (window.__ALLOW_NAVIGATION__)
                    return;
                e.preventDefault();
                e.returnValue = "";
            });
            // Protect document.write which is often used by disable-devtool to wipe the page
            const originalWrite = document.write;
            document.write = function (content) {
                if (!content || content.trim() === "")
                    return;
                return originalWrite.apply(this, arguments);
            };
        });
        const turndownSrc = await getTurndownScript();
        /**
         * Helper function to navigate to a specific URL and extract DOM data.
         * Includes timeout fallbacks and anti-bot VIP navigation bypass.
         *
         * @param {string} urlToVisit - The specific page URL to navigate to
         * @returns {Promise<Object|null>} The extracted page data or null if a fatal network error occurred
         */
        const extractPageData = async (urlToVisit) => {
            try {
                console.log(`[SCRAPER] Navigating to: ${urlToVisit}`);
                await page
                    .evaluateOnNewDocument(() => {
                    window.__ALLOW_NAVIGATION__ = true;
                    // Bypass Disable-Devtool securely without triggering Cloudflare Native Hook detection
                    const originalSetInterval = window.setInterval;
                    const newSetInterval = function (callback, time) {
                        if (time && time < 1000)
                            return 0;
                        return originalSetInterval(callback, time);
                    };
                    // Cloudflare explicitly checks if setInterval is spoofed by calling .toString()
                    // We must fake the native code string to prevent Cloudflare from permanently blocking us!
                    newSetInterval.toString = function () {
                        return "function setInterval() { [native code] }";
                    };
                    window.setInterval = newSetInterval;
                })
                    .catch(() => { });
                try {
                    await page.goto(urlToVisit, {
                        waitUntil: "networkidle2",
                        timeout: 60000,
                    });
                }
                catch (gotoErr) {
                    if (gotoErr.message.includes("net::ERR_ABORTED") ||
                        gotoErr.message.includes("net::ERR_CONNECTION_REFUSED") ||
                        gotoErr.message.includes("net::ERR_NAME_NOT_RESOLVED")) {
                        console.log(`[SCRAPER] Network error for ${urlToVisit}, skipping...`);
                        return { error: "NETWORK_ERROR", message: gotoErr.message }; // Return structured error
                    }
                    console.log(`[SCRAPER] Navigation timeout for ${urlToVisit}, proceeding to extract current DOM...`);
                }
                // Ensure SPA has actually rendered by waiting for substantial text
                try {
                    // Relaxed to 50 characters to support minimal landing pages
                    await page.waitForFunction(() => document.body.innerText.length > 50, { timeout: 8000 });
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                }
                catch (waitErr) {
                    console.log(`[SCRAPER] Timeout waiting for text on ${urlToVisit}. Proceeding with current DOM.`);
                }
                // Auto-scroll to trigger lazy loading of images, iframes, and hidden content
                // Rewritten to use async loops instead of setInterval to bypass our own anti-bot protections!
                try {
                    await page.evaluate(async () => {
                        const distance = 250;
                        let totalHeight = 0;
                        // Scroll down a maximum of 60 times (15,000 pixels)
                        for (let i = 0; i < 60; i++) {
                            const scrollHeight = document.body.scrollHeight;
                            window.scrollBy(0, distance);
                            totalHeight += distance;
                            if (totalHeight >= scrollHeight)
                                break;
                            // Wait 50ms per tick using promises
                            await new Promise((r) => setTimeout(r, 50));
                        }
                    });
                    await new Promise((resolve) => setTimeout(resolve, 1000)); // allow time for lazy loads to finish
                }
                catch (scrollErr) {
                    console.log(`[SCRAPER] Scroll failed for ${urlToVisit}`);
                }
                if (turndownSrc) {
                    await page.addScriptTag({ content: turndownSrc });
                }
                const evaluatedData = await page.evaluate((currentUrl, hasTurndown) => {
                    const errorCodeDiv = document.querySelector(".error-code");
                    const isErrorPage = document.title.includes("site can’t be reached") ||
                        (errorCodeDiv && errorCodeDiv.textContent.includes("ERR_"));
                    if (isErrorPage) {
                        return {
                            error: "CHROME_ERROR",
                            errorCode: errorCodeDiv
                                ? errorCodeDiv.textContent
                                : "ERR_CONNECTION_FAILED",
                        };
                    }
                    // Detect Bot Protection (Cloudflare / Captchas)
                    const lowerTitle = document.title.toLowerCase();
                    const lowerText = document.body ? document.body.innerText.toLowerCase() : "";
                    const isBotBlocked = lowerTitle.includes("just a moment...") ||
                        lowerTitle.includes("attention required!") ||
                        lowerText.includes("verify you are human") ||
                        lowerText.includes("checking your browser before accessing") ||
                        lowerText.includes("enable javascript and cookies to continue") ||
                        lowerText.includes("please complete the security check to access");
                    if (isBotBlocked) {
                        return {
                            error: "BOT_PROTECTION_BLOCKED",
                            message: "Website is protected by Cloudflare/Captcha and blocked the headless browser."
                        };
                    }
                    try {
                        const metadata = {
                            title: document.title || "",
                            description: document.querySelector('meta[name="description"]')?.content ||
                                "",
                            ogImage: document.querySelector('meta[property="og:image"]')
                                ?.content || "",
                            ogTitle: document.querySelector('meta[property="og:title"]')
                                ?.content || "",
                            keywords: document.querySelector('meta[name="keywords"]')?.content ||
                                "",
                            sourceURL: currentUrl,
                        };
                        const favicon = document.querySelector('link[rel="icon"]')?.href ||
                            document.querySelector('link[rel="shortcut icon"]')?.href ||
                            "";
                        const resolveUrl = (urlStr) => {
                            try {
                                return new url_1.URL(urlStr, currentUrl).href;
                            }
                            catch (e) {
                                return "";
                            }
                        };
                        let logo = "";
                        const navHeaders = Array.from(document.querySelectorAll('nav, header, [class*="nav"], [class*="header"]'));
                        for (const container of navHeaders) {
                            const imgs = Array.from(container.querySelectorAll("img"));
                            const logoImg = imgs.find((img) => {
                                const src = img.src || img.getAttribute("src") || "";
                                const alt = img.alt || "";
                                const cls = img.className || "";
                                return (src.toLowerCase().includes("logo") ||
                                    alt.toLowerCase().includes("logo") ||
                                    (typeof cls === "string" &&
                                        cls.toLowerCase().includes("logo")));
                            });
                            const bestImg = logoImg || imgs[0]; // fallback to first image in nav
                            if (bestImg) {
                                const src = bestImg.src ||
                                    bestImg.getAttribute("src") ||
                                    bestImg.getAttribute("data-src") ||
                                    "";
                                if (src && !src.startsWith("data:")) {
                                    logo = resolveUrl(src);
                                    break;
                                }
                            }
                            // Try SVG if no img found
                            const svgs = Array.from(container.querySelectorAll("svg"));
                            const logoSvg = svgs.find((svg) => {
                                const cls = svg.getAttribute("class") || "";
                                return (typeof cls === "string" &&
                                    cls.toLowerCase().includes("logo"));
                            });
                            const bestSvg = logoSvg || svgs[0];
                            if (bestSvg && !logo) {
                                const svgString = new XMLSerializer().serializeToString(bestSvg);
                                logo =
                                    "data:image/svg+xml;utf8," + encodeURIComponent(svgString);
                                break;
                            }
                        }
                        const footer = document.querySelector("footer");
                        let footerBg = "";
                        let footerColor = "";
                        if (footer) {
                            const footerStyle = window.getComputedStyle(footer);
                            footerBg =
                                footerStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
                                    ? footerStyle.backgroundColor
                                    : "";
                            footerColor = footerStyle.color;
                        }
                        const computedBody = document.body ? window.getComputedStyle(document.body) : { backgroundColor: "#ffffff", color: "#000000", fontFamily: "sans-serif" };
                        let mainBg = computedBody.backgroundColor || "#ffffff";
                        let mainTextColor = computedBody.color || "#000000";
                        // Advanced Background Scanner: Check root divs instead of just body
                        if (mainBg === "rgba(0, 0, 0, 0)" || mainBg === "transparent") {
                            const rootEl = document.querySelector("#root, #__next, #app, main");
                            if (rootEl) {
                                const rootStyle = window.getComputedStyle(rootEl);
                                if (rootStyle.backgroundColor !== "rgba(0, 0, 0, 0)") {
                                    mainBg = rootStyle.backgroundColor;
                                }
                            }
                        }
                        // Scan multiple buttons to find the true primary theme color (ignoring transparent ghost buttons)
                        const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn"], a[class*="button"]'));
                        let buttonBg = "#000000";
                        let buttonColor = "#FFFFFF";
                        for (const btn of buttons) {
                            const btnStyle = window.getComputedStyle(btn);
                            if (btnStyle.backgroundColor !== "rgba(0, 0, 0, 0)" && btnStyle.backgroundColor !== "transparent") {
                                buttonBg = btnStyle.backgroundColor;
                                buttonColor = btnStyle.color;
                                break; // found the first solid button!
                            }
                        }
                        const h1 = document.querySelector("h1");
                        const computedH1 = h1 ? window.getComputedStyle(h1) : computedBody;
                        const rgbToHex = (rgb) => {
                            if (!rgb || typeof rgb !== "string")
                                return "#000000";
                            const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                            if (!match)
                                return rgb;
                            return "#" + match.slice(1).map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join('');
                        };
                        const branding = {
                            colorScheme: "light",
                            favicon: favicon,
                            logo: logo,
                            colors: {
                                primary: rgbToHex(buttonBg),
                                background: rgbToHex(mainBg),
                                textPrimary: rgbToHex(mainTextColor),
                                footerBackground: rgbToHex(footerBg),
                                footerText: rgbToHex(footerColor),
                            },
                            typography: {
                                fontFamilies: {
                                    primary: computedBody.fontFamily,
                                    heading: computedH1.fontFamily,
                                },
                            },
                            components: {
                                buttonPrimary: {
                                    background: rgbToHex(buttonBg),
                                    textColor: rgbToHex(buttonColor),
                                },
                            },
                        };
                        const images = Array.from(document.querySelectorAll("img"))
                            .map((img) => {
                            let src = img.src ||
                                img.getAttribute("src") ||
                                img.getAttribute("data-src") ||
                                "";
                            if (typeof src !== "string")
                                src = "";
                            if (src.startsWith("data:"))
                                return null; // Skip data URIs
                            return {
                                src: resolveUrl(src),
                                alt: img.alt || "",
                            };
                        })
                            .filter((img) => img && img.src && img.src.startsWith("http"));
                        // Also capture background images (limit to main structural elements to prevent lag on huge pages)
                        document.querySelectorAll("body, main, header, section, div, article").forEach((el) => {
                            try {
                                const bg = window.getComputedStyle(el).backgroundImage;
                                if (bg && typeof bg === "string" && bg !== "none" && bg.includes("url(")) {
                                    const match = bg.match(/url\(['"]?(.*?)['"]?\)/);
                                    if (match && match[1] && !match[1].startsWith("data:")) {
                                        const src = resolveUrl(match[1]);
                                        if (src &&
                                            src.startsWith("http") &&
                                            !images.some((i) => i && i.src === src)) {
                                            images.push({ src, alt: "Background Image" });
                                        }
                                    }
                                }
                            }
                            catch (e) {
                                // Ignore detached element errors
                            }
                        });
                        const iframes = Array.from(document.querySelectorAll("iframe"))
                            .map((iframe) => typeof iframe.src === "string"
                            ? iframe.src
                            : iframe.getAttribute("src") || "")
                            .filter((src) => typeof src === "string" && src.startsWith("http"));
                        const links = Array.from(document.querySelectorAll("a"))
                            .map((a) => {
                            let href = typeof a.href === "string" ? a.href : a.getAttribute("href") || "";
                            if (typeof href !== "string")
                                href = "";
                            if (href.startsWith("mailto:") || href.startsWith("tel:"))
                                return href;
                            return resolveUrl(href);
                        })
                            .filter((href) => href &&
                            (href.startsWith("http") ||
                                href.startsWith("mailto:") ||
                                href.startsWith("tel:")));
                        // Remove noisy elements before parsing text (DO NOT remove noscript, it contains fallback SEO content!)
                        // We KEEP nav and footer because they contain critical contact details and branding!
                        document
                            .querySelectorAll("script, style, iframe, svg")
                            .forEach((el) => el.remove());
                        let markdown = "";
                        if (hasTurndown && typeof window.TurndownService !== "undefined") {
                            try {
                                // @ts-ignore
                                const turndownService = new window.TurndownService({
                                    headingStyle: "atx",
                                    codeBlockStyle: "fenced",
                                });
                                markdown = turndownService.turndown(document.body.innerHTML);
                            }
                            catch (err) {
                                markdown = "";
                            }
                        }
                        if (!markdown || markdown.trim() === "") {
                            markdown = document.body ? document.body.innerText : "";
                        }
                        return { markdown, links, images, iframes, metadata, branding };
                    }
                    catch (evalErr) {
                        console.error("DOM Evaluation error:", evalErr);
                        return {
                            error: "DOM_EVALUATION_ERROR",
                            message: evalErr.message || evalErr.toString(),
                            markdown: "",
                            links: [],
                            images: [],
                            iframes: [],
                            metadata: {},
                            branding: {},
                        };
                    }
                }, urlToVisit, !!turndownSrc);
                if (evaluatedData && evaluatedData.error === "CHROME_ERROR") {
                    console.error(`[SCRAPER] Chrome Error Page detected for ${urlToVisit}: ${evaluatedData.errorCode}`);
                    return { error: "CHROME_ERROR", message: evaluatedData.errorCode };
                }
                if (evaluatedData && evaluatedData.error === "BOT_PROTECTION_BLOCKED") {
                    console.error(`[SCRAPER] Bot Protection Blocked for ${urlToVisit}`);
                    return { error: "BOT_PROTECTION_BLOCKED", message: evaluatedData.message };
                }
                return evaluatedData;
            }
            catch (e) {
                console.error(`[SCRAPER] Failed to scrape ${urlToVisit}:`, e.message);
                return { error: "UNKNOWN_PUPPETEER_ERROR", message: e.message };
            }
        };
        // ---------------------------------------------------------
        // SCRAPE HOMEPAGE
        // ---------------------------------------------------------
        let homeData = await extractPageData(formattedUrl);
        // Explicit Error Handling for Homepage
        if (homeData && homeData.error) {
            await browser.close();
            throw new Error(`[${homeData.error}] Failed to extract content from ${formattedUrl}. Reason: ${homeData.message || "Unknown error"}`);
        }
        let uniqueLinks = [];
        if (homeData && !homeData.error) {
            firecrawlLikeData.markdown += `\n\n--- PAGE: ${formattedUrl} ---\n\n${homeData.markdown}`;
            firecrawlLikeData.metadata = homeData.metadata;
            firecrawlLikeData.branding = homeData.branding;
            firecrawlLikeData.images = homeData.images || [];
            firecrawlLikeData.iframes = homeData.iframes || [];
            uniqueLinks = [...new Set(homeData.links || [])];
        }
        // ---------------------------------------------------------
        // SCRAPE SUB-PAGES
        // ---------------------------------------------------------
        // Extract up to 7 important internal pages to build a complete context model
        const baseUrl = new url_1.URL(formattedUrl).origin;
        const importantKeywords = [
            "about",
            "contact",
            "service",
            "product",
            "pricing",
            "faq",
            "feature",
            "solution",
            "team",
            "story",
            "mission",
        ];
        // Get valid internal links (excluding anchors and the exact homepage itself)
        let internalLinks = uniqueLinks.filter((link) => {
            try {
                const linkUrl = new url_1.URL(link);
                const base = new url_1.URL(baseUrl);
                return (linkUrl.origin === base.origin &&
                    linkUrl.pathname !== "/" &&
                    linkUrl.pathname !== base.pathname &&
                    !link.includes("#"));
            }
            catch (e) {
                return false;
            }
        });
        // Sort links: Priority to important keywords
        internalLinks.sort((a, b) => {
            const lowerA = a.toLowerCase();
            const lowerB = b.toLowerCase();
            const aImportant = importantKeywords.some((k) => lowerA.includes(k));
            const bImportant = importantKeywords.some((k) => lowerB.includes(k));
            if (aImportant && !bImportant)
                return -1;
            if (!aImportant && bImportant)
                return 1;
            return 0;
        });
        // Always try to crawl up to 5 sub-pages if they exist!
        const linksToVisit = internalLinks.slice(0, 5);
        for (const link of linksToVisit) {
            const subData = await extractPageData(link);
            if (subData && !subData.error && subData.markdown && subData.markdown.length > 100) {
                firecrawlLikeData.markdown += `\n\n--- PAGE: ${link} ---\n\n${subData.markdown}`;
                firecrawlLikeData.images = [
                    ...firecrawlLikeData.images,
                    ...subData.images,
                ];
                if (subData.iframes) {
                    firecrawlLikeData.iframes = [
                        ...firecrawlLikeData.iframes,
                        ...subData.iframes,
                    ];
                }
            }
        }
        // Deduplicate array data
        firecrawlLikeData.images = firecrawlLikeData.images.filter((img, index, self) => index === self.findIndex((t) => t.src === img.src));
        firecrawlLikeData.iframes = [...new Set(firecrawlLikeData.iframes)];
        firecrawlLikeData.links = uniqueLinks;
        console.log(`[SCRAPER] Custom Scraping Finished. Total markdown length: ${firecrawlLikeData.markdown.length}`);
        await browser.close();
        if (firecrawlLikeData.markdown
            .replace(/--- PAGE: .*? ---/g, "")
            .trim().length === 0) {
            throw new Error(`Failed to extract any content from ${formattedUrl}. The site might be blocking headless browsers or the URL might be invalid.`);
        }
        return firecrawlLikeData;
    }
    catch (error) {
        if (browser)
            await browser.close();
        console.error("[SCRAPER] Global Error:", error);
        throw error;
    }
};
exports.scrapeWebsite = scrapeWebsite;
//# sourceMappingURL=scraper.service.js.map