"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.linkedinWorker = exports.linkedinQueueEvents = exports.linkedinQueue = exports.LINKEDIN_QUEUE_NAME = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const prisma_1 = __importDefault(require("../config/prisma"));
const apify_client_1 = require("apify-client");
exports.LINKEDIN_QUEUE_NAME = 'linkedin-api-lead-generation-queue';
exports.linkedinQueue = new bullmq_1.Queue(exports.LINKEDIN_QUEUE_NAME, {
    connection: redis_1.redis
});
exports.linkedinQueueEvents = new bullmq_1.QueueEvents(exports.LINKEDIN_QUEUE_NAME, {
    connection: redis_1.redis
});
const client = new apify_client_1.ApifyClient({
    token: process.env.APIFY_API_TOKEN || '',
});
exports.linkedinWorker = new bullmq_1.Worker(exports.LINKEDIN_QUEUE_NAME, async (job) => {
    const { companyName, userId, mapLeadId } = job.data;
    job.log(`Starting LinkedIn lead generation for ${companyName}.`);
    if (!process.env.APIFY_API_TOKEN) {
        job.log('Error: APIFY_API_TOKEN is missing in env');
        throw new Error('APIFY_API_TOKEN missing');
    }
    try {
        job.updateProgress({ percent: 10, label: "Checking MapLead details..." });
        // Fetch company's phone and email from MapLead as fallback
        const mapLead = await prisma_1.default.mapLead.findUnique({
            where: { id: mapLeadId }
        });
        if (!mapLead) {
            throw new Error(`MapLead not found for id ${mapLeadId}`);
        }
        const companyPhone = mapLead.phone && mapLead.phone !== 'N/A' ? mapLead.phone : '';
        let companyEmail = '';
        if (mapLead.emails && mapLead.emails !== 'N/A' && mapLead.emails !== '[]') {
            try {
                const parsed = JSON.parse(mapLead.emails);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    companyEmail = parsed[0];
                }
            }
            catch (e) {
                companyEmail = mapLead.emails;
            }
        }
        job.updateProgress({ percent: 20, label: "Creating LinkedIn Lead entry..." });
        // Create or update lead immediately so user sees it in UI
        let linkedinLead = await prisma_1.default.linkedinLead.upsert({
            where: { mapLeadId },
            update: {
                status: 'searching_url',
            },
            create: {
                userId,
                mapLeadId,
                companyName,
                status: 'searching_url',
            }
        });
        // Add the official contact as the first employee
        await prisma_1.default.linkedinEmployee.create({
            data: {
                linkedinLeadId: linkedinLead.id,
                name: "Official Company Contact",
                title: "HQ / Reception",
                phone: companyPhone,
                email: companyEmail,
            }
        });
        let linkedinUrl = mapLead.linkedin && mapLead.linkedin !== 'N/A' ? mapLead.linkedin : null;
        if (!linkedinUrl) {
            job.log(`LinkedIn URL not found for ${companyName}. Falling back to Apify Google Search...`);
            job.updateProgress({ percent: 30, label: "Searching for LinkedIn URL via Google..." });
            const searchInput = {
                "queries": `${companyName} site:linkedin.com/company`,
                "maxPagesPerQuery": 1,
                "resultsPerPage": 3
            };
            try {
                const searchRun = await client.actor("apify/google-search-scraper").call(searchInput);
                const { items: searchResults } = await client.dataset(searchRun.defaultDatasetId).listItems();
                if (searchResults && searchResults.length > 0) {
                    const organicResults = searchResults[0].organicResults || [];
                    linkedinUrl = organicResults
                        .map((res) => res.url)
                        .find((url) => url.includes('linkedin.com/company/'));
                }
            }
            catch (searchErr) {
                job.log(`Apify Google Search failed: ${searchErr.message}`);
            }
        }
        if (!linkedinUrl) {
            job.log(`No LinkedIn company URL found for ${companyName} even after search.`);
            await prisma_1.default.linkedinLead.update({
                where: { id: linkedinLead.id },
                data: { status: 'failed' }
            });
            return { success: false, reason: "No LinkedIn URL found" };
        }
        job.log(`Found LinkedIn URL: ${linkedinUrl}`);
        linkedinLead = await prisma_1.default.linkedinLead.update({
            where: { id: linkedinLead.id },
            data: {
                linkedinUrl,
                status: 'scraping_company'
            }
        });
        // Step 2: Scrape Company Details
        job.updateProgress({ percent: 50, label: "Scraping Company Details..." });
        job.log(`Scraping company details for ${linkedinUrl}`);
        const companyInput = {
            "mode": "get_company",
            "profileCompanies": [linkedinUrl]
        };
        const companyRun = await client.actor("unseenuser/linkedin-company-scraper").call(companyInput);
        const { items: companyItems } = await client.dataset(companyRun.defaultDatasetId).listItems();
        const companyData = companyItems[0] || {};
        linkedinLead = await prisma_1.default.linkedinLead.update({
            where: { id: linkedinLead.id },
            data: {
                industry: companyData.industries?.[0]?.name,
                employeeCount: companyData.employeeCount,
                website: companyData.website || companyData.callToActionUrl,
                description: companyData.description,
                followers: companyData.followerCount,
                companySize: companyData.employeeCountRange ? `${companyData.employeeCountRange.start}+` : null,
                headquarters: companyData.locations?.find((loc) => loc.headquarter)?.parsed?.city || companyData.locations?.[0]?.parsed?.city,
                logoUrl: companyData.logo || companyData.logos?.[0]?.url,
                status: 'scraping_employees'
            }
        });
        // Step 3: Scrape Employees
        job.updateProgress({ percent: 70, label: "Scraping Employees..." });
        job.log(`Scraping employees for ${linkedinUrl}`);
        const employeesInput = {
            "companies": [linkedinUrl],
            "profileScraperMode": "Full ($8 per 1k)",
            "maxItems": 5
        };
        const employeesRun = await client.actor("harvestapi/linkedin-company-employees").call(employeesInput);
        const { items: employeesItems } = await client.dataset(employeesRun.defaultDatasetId).listItems();
        if (employeesItems && employeesItems.length > 0) {
            const employeesToInsert = employeesItems.map((emp) => {
                const title = emp.position || emp.title || emp.headline || (emp.currentPositions && emp.currentPositions[0] ? emp.currentPositions[0].title : null) || emp.summary || '';
                const locString = emp.location?.linkedinText || (typeof emp.location === 'string' ? emp.location : '') || '';
                const locParts = locString.split(',').map((s) => s.trim());
                let city = '', state = '', country = '';
                if (locParts.length === 3) {
                    city = locParts[0];
                    state = locParts[1];
                    country = locParts[2];
                }
                else if (locParts.length === 2) {
                    city = locParts[0];
                    country = locParts[1];
                }
                else if (locParts.length === 1) {
                    country = locParts[0];
                }
                return {
                    linkedinLeadId: linkedinLead.id,
                    name: emp.fullName || emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
                    profileUrl: emp.linkedinUrl || emp.profileUrl,
                    title: title,
                    location: locString,
                    city: city,
                    state: state,
                    country: country,
                    description: emp.summary || emp.about || '',
                    email: emp.email || emp.emailAddress || (emp.contactInfo && emp.contactInfo.emailAddress) || companyEmail || '',
                    personalEmail: '',
                    phone: emp.phone || emp.phoneNumber || (emp.contactInfo && emp.contactInfo.phoneNumber) || companyPhone || '',
                    mobilePhone: '',
                    pictureUrl: (() => {
                        const pic = emp.pictureUrl || emp.profilePicture;
                        if (!pic)
                            return '';
                        if (typeof pic === 'string')
                            return pic;
                        if (typeof pic === 'object' && pic.url)
                            return pic.url;
                        return '';
                    })(),
                    premium: emp.premium || false
                };
            });
            await prisma_1.default.linkedinEmployee.createMany({
                data: employeesToInsert
            });
        }
        await prisma_1.default.linkedinLead.update({
            where: { id: linkedinLead.id },
            data: { status: 'completed' }
        });
        job.updateProgress({ percent: 100, label: "Completed!" });
        job.log(`Completed scraping for ${linkedinUrl}`);
        return { success: true };
    }
    catch (err) {
        job.log(`Error scraping ${companyName}: ${err.message}`);
        await prisma_1.default.linkedinLead.updateMany({
            where: { mapLeadId },
            data: { status: 'failed' }
        });
        throw err;
    }
}, {
    connection: redis_1.redis,
    concurrency: 1, // Be nice to Apify
});
exports.linkedinWorker.on('completed', (job) => {
    console.log(`[Linkedin Worker] Job ${job.id} completed!`);
});
exports.linkedinWorker.on('failed', (job, err) => {
    console.error(`[Linkedin Worker] Job ${job?.id} failed:`, err.message);
});
//# sourceMappingURL=linkedinQueue.js.map