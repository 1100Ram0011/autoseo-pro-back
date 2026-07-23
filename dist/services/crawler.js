"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlSite = crawlSite;
const puppeteer_1 = __importDefault(require("puppeteer"));
const cheerio = __importStar(require("cheerio"));
const prisma_1 = __importDefault(require("../config/prisma"));
async function crawlSite(siteId, startUrl) {
    console.log(`Starting crawl for site: ${startUrl}`);
    try {
        const browser = await puppeteer_1.default.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        // We will do a basic single-page crawl for MVP, 
        // extracting all internal links from the homepage.
        await page.goto(startUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        const html = await page.content();
        await browser.close();
        const $ = cheerio.load(html);
        const links = new Set();
        // Always add the homepage
        links.add(startUrl);
        const baseUrl = new URL(startUrl);
        $('a').each((_, element) => {
            const href = $(element).attr('href');
            if (href) {
                try {
                    const urlObj = new URL(href, startUrl);
                    // Only add internal links, ignore hashes
                    if (urlObj.hostname === baseUrl.hostname) {
                        // Remove hash from URL
                        urlObj.hash = '';
                        links.add(urlObj.href);
                    }
                }
                catch (e) {
                    // Ignore invalid URLs
                }
            }
        });
        console.log(`Found ${links.size} unique internal pages on ${startUrl}`);
        // Save to Database
        const savedPages = [];
        for (const link of links) {
            // Check if page already exists for this site
            let dbPage = await prisma_1.default.page.findFirst({
                where: { siteId, url: link }
            });
            if (!dbPage) {
                dbPage = await prisma_1.default.page.create({
                    data: {
                        siteId,
                        url: link,
                        indexed: false
                    }
                });
            }
            savedPages.push(dbPage);
        }
        // Update site last_crawled timestamp
        await prisma_1.default.site.update({
            where: { id: siteId },
            data: { last_crawled: new Date() }
        });
        return savedPages;
    }
    catch (error) {
        console.error(`Crawl failed for ${startUrl}:`, error);
        throw error;
    }
}
//# sourceMappingURL=crawler.js.map