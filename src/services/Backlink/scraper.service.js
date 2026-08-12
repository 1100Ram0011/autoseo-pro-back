// scrapper commented and packages removed

// import puppeteer from "puppeteer-extra";
// import StealthPlugin from "puppeteer-extra-plugin-stealth";

// puppeteer.use(StealthPlugin());

// export const scrapeBacklinks = async (rawDomain) => {
//   // ✅ Normalize domain
//   const domain = rawDomain
//     .replace(/^https?:\/\//, "")
//     .replace(/\/$/, "")
//     .trim();

//   console.log(`[BACKLINKS] Scraping domain: "${domain}"`);

//   const browser = await puppeteer.launch({
//     headless: "new",
//     args: [
//       "--no-sandbox",
//       "--disable-setuid-sandbox",
//       "--disable-blink-features=AutomationControlled",
//       "--disable-dev-shm-usage",
//       "--window-size=1440,900",
//     ],
//   });

//   const page = await browser.newPage();

//   // ✅ Headers (anti-bot)
//   await page.setExtraHTTPHeaders({
//     "accept-language": "en-US,en;q=0.9",
//   });

//   await page.setUserAgent(
//     "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
//   );

//   await page.setViewport({ width: 1440, height: 900 });

//   // Hide automation
//   await page.evaluateOnNewDocument(() => {
//     Object.defineProperty(navigator, "webdriver", { get: () => undefined });
//     window.chrome = { runtime: {} };
//   });

//   // ── Step 1: Open site ──
//   await page.goto("https://backlinks.live", {
//     waitUntil: "networkidle2",
//     timeout: 80000,
//   });

//   await delay(3000);

//   // ── Step 2: Input ──
//   const inputSelector =
//     'input[type="text"], input[type="url"], input:not([type="hidden"])';

//   await page.waitForSelector(inputSelector, { timeout: 15000 });

//   await page.click(inputSelector, { clickCount: 3 });
//   await page.keyboard.type(domain, { delay: 80 });

//   console.log(`[BACKLINKS] Typed domain`);

//   await delay(3000);

//   // ── Step 3: Submit ──
//   await page.keyboard.press("Enter");

//   await delay(9000);

//   // Force click button (IMPORTANT)
//   await page.evaluate(() => {
//     const btn = [...document.querySelectorAll("button")].find((b) =>
//       /check|analyze|search|submit/i.test(b.innerText)
//     );
//     if (btn) btn.click();
//   });

//   console.log(`[BACKLINKS] Submitted`);

//   // ── Step 4: Wait for results ──
//   console.log(`[BACKLINKS] Waiting for results...`);

//   try {
//     await page.waitForFunction(
//       () =>
//         document.body.innerText.toLowerCase().includes("backlinks") ||
//         document.querySelectorAll("table tbody tr").length > 0,
//       { timeout: 900000 }
//     );
//   } catch {
//     console.log("[BACKLINKS] Wait timeout (site may block)");
//   }

//   await delay(9000);

//   // // ✅ DEBUG SCREENSHOT
//   // await page.screenshot({ path: "debug.png", fullPage: true });

//   // ── Step 5: Scroll ──
//   await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
//   await delay(3000);

//   // ── Step 6: Extract ──
//   const result = await page.evaluate(() => {
//     const text = document.body.innerText;

//     let total = 0;
//     const match = text.match(/(\d[\d,]*)\s+backlinks?\s+found/i);
//     if (match) total = parseInt(match[1].replace(/,/g, ""), 10);

//     let authority = null;
//     const authMatch = text.match(/LIVE[\s\S]{0,30}?([\d.]+)[\s\S]{0,20}?DOMAIN\s+AUTHORITY/i);
//     if (authMatch) authority = parseFloat(authMatch[1]);

//     const rows = document.querySelectorAll("table tbody tr");
//     const data = [];

//     rows.forEach((row) => {
//       const cols = row.querySelectorAll("td");

//       if (cols.length >= 2) {
//         const lines = cols[1]?.innerText.split("\n").filter(Boolean);

//         data.push({
//           da: cols[0]?.innerText.trim() || "—",
//           source_title: lines?.[0] || "",
//           source_url:
//             lines?.[1] ||
//             cols[1]?.querySelector("a")?.href ||
//             "",
//           target_url: cols[2]?.innerText.trim() || "",
//           date: cols[3]?.innerText.trim() || "",
//         });
//       }
//     });

//     return { total, authority, data };
//   });

//   console.log(
//     `[BACKLINKS] DONE — total=${result.total} | rows=${result.data.length}`
//   );

//   await browser.close();
//   return result;
// };

// const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// //per fect
// //
 



























 
















































// // //claude
// // import { connect } from "puppeteer-real-browser"; // package uninstalled

// // export const scrapeBacklinks = async (rawDomain) => {
// //   const domain = rawDomain
// //     .replace(/^https?:\/\//, "")
// //     .replace(/\/$/, "")
// //     .trim();

// //   const { browser, page } = await connect({
// //     headless: true,
// //     args: [],
// //     customConfig: {},
// //     turnstile: true,
// //     connectOption: {},
// //     disableXvfb: false,
// //     ignoreAllFlags: false,
// //   });

// //   try {
// //     await page.goto("https://backlinks.live", {
// //       waitUntil: "networkidle2",
// //       timeout: 60000,
// //     });

// //     await delay(3000);

// //     // ── Step 1: Domain type karo ──
// //     const inputSelector = 'input[type="text"], input[type="url"]';
// //     await page.waitForSelector(inputSelector, { timeout: 15000 });
// //     await page.click(inputSelector, { clickCount: 3 });
// //     await page.keyboard.type(domain, { delay: 80 });

// //     console.log(`[BACKLINKS] Typed domain: ${domain}`);
// //     await delay(1500);

// //     // ── Step 2: Submit ──
// //     await page.keyboard.press("Enter");
// //     await delay(4000);

// //     // Button bhi click karo (backup)
// //     await page.evaluate(() => {
// //       const btn = [...document.querySelectorAll("button")].find((b) =>
// //         /check|analyze|search|submit/i.test(b.innerText)
// //       );
// //       if (btn) btn.click();
// //     });

// //     console.log(`[BACKLINKS] Submitted`);

// //     // ── Step 3: Wait for results ──
// //     try {
// //       await page.waitForFunction(
// //         () =>
// //           document.querySelectorAll("table tbody tr").length > 0 ||
// //           document.body.innerText.toLowerCase().includes("backlinks found"),
// //         { timeout: 60000 }
// //       );
// //       console.log(`[BACKLINKS] Results loaded`);
// //     } catch {
// //       console.log("[BACKLINKS] Timeout — saving debug screenshot");
// //       await page.screenshot({ path: "debug.png", fullPage: true });
// //     }

// //     await delay(5000);

// //     // ── Step 4: Scroll to load all ──
// //     await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
// //     await delay(2000);

// //     // ── Step 5: Extract data ──
// //     const result = await page.evaluate(() => {
// //       const text = document.body.innerText;

// //       // Total backlinks
// //       let total = 0;
// //       const match = text.match(/(\d[\d,]*)\s+backlinks?\s+found/i);
// //       if (match) total = parseInt(match[1].replace(/,/g, ""), 10);

// //       // Domain authority
// //       let authority = null;
// //       const authMatch = text.match(
// //         /LIVE[\s\S]{0,30}?([\d.]+)[\s\S]{0,20}?DOMAIN\s+AUTHORITY/i
// //       );
// //       if (authMatch) authority = parseFloat(authMatch[1]);

// //       // Table rows
// //       const rows = document.querySelectorAll("table tbody tr");
// //       const data = [];

// //       rows.forEach((row) => {
// //         const cols = row.querySelectorAll("td");
// //         if (cols.length >= 2) {
// //           const lines = cols[1]?.innerText.split("\n").filter(Boolean);
// //           data.push({
// //             da: cols[0]?.innerText.trim() || "—",
// //             source_title: lines?.[0] || "",
// //             source_url:
// //               lines?.[1] || cols[1]?.querySelector("a")?.href || "",
// //             target_url: cols[2]?.innerText.trim() || "",
// //             date: cols[3]?.innerText.trim() || "",
// //           });
// //         }
// //       });

// //       return { total, authority, data };
// //     });

// //     console.log(
// //       `[BACKLINKS] DONE — total=${result.total} | rows=${result.data.length}`
// //     );

// //     return result;
// //   } catch (e) {
// //     console.error("[BACKLINKS] Error:", e.message);
// //     return { total: 0, authority: null, data: [] };
// //   } finally {
// //     await browser.close();
// //   }
// // };

// // const delay = (ms) => new Promise((r) => setTimeout(r, ms));