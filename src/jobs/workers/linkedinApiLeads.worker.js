import { Worker } from 'bullmq';
import redisClient from '../../config/redis.js';
import { ApifyClient } from 'apify-client';
import LinkedinLead from '../../models/linkedin/LinkedinLead.js';
import mongoose from 'mongoose';
import axios from 'axios';
import { deductDynamicCredit } from '../../utils/creditTracker.js';
import { lookupRocketReachPerson } from '../../utils/rocketreachHelper.js';

export const linkedinApiLeadGenerationWorker = new Worker(
    'linkedin-api-lead-generation-queue',
    async (job) => {
        const client = new ApifyClient({
            token: process.env.APIFY_API_TOKEN || '',
        });

        const { companyNames, userId, perEmployeeCost = 20, maxEmployees = 5 } = job.data;
        console.log(`Starting LinkedIn lead generation for ${companyNames.length} companies.`);

        if (!process.env.APIFY_API_TOKEN) {
            console.log('Error: APIFY_API_TOKEN is missing in env');
            throw new Error('APIFY_API_TOKEN missing');
        }
        
        for (const companyName of companyNames) {
            let newLead = null;
            try {
                // Fetch company's phone and email from businesses collection (Google Leads) as fallback
                const shortName = companyName.split(' ').slice(0, 2).join(' ');
                const supplier = await mongoose.connection.db.collection('businesses').findOne({
                    userId: new mongoose.Types.ObjectId(userId),
                    name: new RegExp(shortName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
                });
                const companyPhone = supplier && supplier.phone !== 'N/A' ? supplier.phone : '';
                const companyEmail = supplier && supplier.emails && supplier.emails.length > 0 ? supplier.emails[0] : (supplier && supplier.email ? supplier.email : '');

                // 1. Create lead immediately so user sees it in UI
                newLead = await LinkedinLead.create({
                    userId,
                    companyName,
                    status: 'pending', // or searching_url
                    employees: [{
                        name: "Official Company Contact",
                        title: "HQ / Reception",
                        phone: companyPhone,
                        email: companyEmail,
                    }]
                });

                let linkedinUrl = supplier && supplier.linkedin && supplier.linkedin !== 'N/A' ? supplier.linkedin : null;

                if (!linkedinUrl) {
                    console.log(`LinkedIn URL not found in database for ${companyName}. Falling back to Apify Google Search...`);
                    newLead.status = 'searching_url';
                    await newLead.save();

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
                                .map(res => res.url)
                                .find(url => url.includes('linkedin.com/company/'));
                        }
                    } catch (searchErr) {
                        console.log(`Apify Google Search failed: ${searchErr.message}`);
                    }
                }

                if (!linkedinUrl) {
                    console.log(`No LinkedIn company URL found for ${companyName} even after search.`);
                    newLead.status = 'failed';
                    await newLead.save();
                    continue;
                }

                console.log(`Found LinkedIn URL: ${linkedinUrl}`);

                newLead.linkedinUrl = linkedinUrl;
                newLead.status = 'scraping_company';
                await newLead.save();

                // Step 2: Scrape Company Details
                console.log(`Scraping company details for ${linkedinUrl}`);
                const companyInput = {
                    "mode": "get_company",
                    "profileCompanies": [linkedinUrl]
                };
                const companyRun = await client.actor("unseenuser/linkedin-company-scraper").call(companyInput);
                const { items: companyItems } = await client.dataset(companyRun.defaultDatasetId).listItems();
                
                const companyData = companyItems[0] || {};
                
                newLead.industry = companyData.industries?.[0]?.name;
                newLead.employeeCount = companyData.employeeCount;
                newLead.website = companyData.website || companyData.callToActionUrl;
                newLead.description = companyData.description;
                newLead.followers = companyData.followerCount;
                newLead.companySize = companyData.employeeCountRange ? `${companyData.employeeCountRange.start}+` : undefined;
                newLead.headquarters = companyData.locations?.find(loc => loc.headquarter)?.parsed?.city || companyData.locations?.[0]?.parsed?.city;
                newLead.logoUrl = companyData.logo || companyData.logos?.[0]?.url;
                
                newLead.status = 'scraping_employees';
                await newLead.save();

                // Step 3: Scrape Employees
                // Priority: Apify pehle (LinkedIn URL + basic info), phir RocketReach se enrich (email/phone missing ho tab)
                let baseEmployees = [];

                console.log(`Scraping employees for ${linkedinUrl} using Apify`);
                try {
                    const employeesInput = {
                        "companies": [linkedinUrl],
                        "profileScraperMode": "Full ($8 per 1k)",
                        "maxItems": maxEmployees
                    };
                    const employeesRun = await client.actor("harvestapi/linkedin-company-employees").call(employeesInput);
                    const { items: employeesItems } = await client.dataset(employeesRun.defaultDatasetId).listItems();

                    if (employeesItems && employeesItems.length > 0) {
                        baseEmployees = employeesItems.map(emp => {
                            const title = emp.position || emp.title || emp.headline || (emp.currentPositions && emp.currentPositions[0] ? emp.currentPositions[0].title : null) || emp.summary || '';

                            const locString = emp.location?.linkedinText || (typeof emp.location === 'string' ? emp.location : '') || '';
                            const locParts = locString.split(',').map(s => s.trim());
                            let city = '', state = '', country = '';
                            if (locParts.length === 3) {
                                city = locParts[0]; state = locParts[1]; country = locParts[2];
                            } else if (locParts.length === 2) {
                                city = locParts[0]; country = locParts[1];
                            } else if (locParts.length === 1) {
                                country = locParts[0];
                            }

                            return {
                                name: emp.fullName || emp.name || `${emp.firstName || ''} ${emp.lastName || ''}`.trim(),
                                profileUrl: emp.linkedinUrl || emp.profileUrl,
                                title: title,
                                location: locString,
                                city: city,
                                state: state,
                                country: country,
                                description: emp.summary || emp.about || '',
                                email: emp.email || emp.emailAddress || (emp.contactInfo && emp.contactInfo.emailAddress) || '',
                                personalEmail: '',
                                phone: emp.phone || emp.phoneNumber || (emp.contactInfo && emp.contactInfo.phoneNumber) || '',
                                mobilePhone: '',
                                pictureUrl: (() => {
                                    const pic = emp.pictureUrl || emp.profilePicture;
                                    if (!pic) return '';
                                    if (typeof pic === 'string') return pic;
                                    if (typeof pic === 'object' && pic.url) return pic.url;
                                    return '';
                                })(),
                                premium: emp.premium || false
                            };
                        });
                        console.log(`Apify found ${baseEmployees.length} employees for ${companyName}.`);
                    } else {
                        console.log(`Apify returned 0 employees for ${companyName}.`);
                    }
                } catch (apifyErr) {
                    console.log(`Apify employee scraping failed: ${apifyErr.message}`);
                }

                // RocketReach enrichment: sirf un employees ke liye jinka email ya phone nahi mila Apify se
                if (baseEmployees.length > 0 && process.env.ROCKETREACH_API_KEY) {
                    const needsEnrichment = baseEmployees.filter(emp => !emp.email && !emp.phone);
                    if (needsEnrichment.length > 0) {
                        console.log(`${needsEnrichment.length} employees missing contact info. Starting RocketReach enrichment...`);
                        for (let emp of baseEmployees) {
                            if (emp.email && emp.phone) continue; // Already has contact info, skip
                            try {
                                const contactInfo = await lookupRocketReachPerson({
                                    employeeName: emp.name,
                                    profileUrl: emp.profileUrl,
                                    companyName: companyName
                                });

                                if (contactInfo) {
                                    emp.email = contactInfo.email || emp.email;
                                    emp.personalEmail = contactInfo.personalEmail || emp.personalEmail;
                                    emp.phone = contactInfo.phone || emp.phone;
                                    emp.mobilePhone = contactInfo.mobilePhone || emp.mobilePhone;
                                    emp.isEnriched = true;
                                    console.log(`RocketReach enriched: ${emp.name}`);
                                }
                            } catch (enrichErr) {
                                console.log(`Error enriching ${emp.name} via RocketReach: ${enrichErr.message}`);
                            }
                        }
                    } else {
                        console.log(`All employees already have contact info from Apify. Skipping RocketReach.`);
                    }
                }

                if (baseEmployees.length > 0) {
                    console.log(`Applying company fallbacks for employees still missing contact info...`);
                    baseEmployees = baseEmployees.map(emp => ({
                        ...emp,
                        email: emp.email || companyEmail,
                        phone: emp.phone || companyPhone
                    }));
                }

                newLead.employees = [
                    {
                        name: "Official Company Contact",
                        title: "HQ / Reception",
                        phone: companyPhone,
                        email: companyEmail,
                    },
                    ...(baseEmployees || [])
                ];
                newLead.status = 'completed';
                await newLead.save();
                console.log(`Completed scraping for ${linkedinUrl}`);

                // Deduct credits only for employees where we actually found specific contact info
                let enrichedCount = baseEmployees.filter(emp => emp.isEnriched).length;
                
                if (enrichedCount > 0) {
                    try {
                        const amountToDeduct = perEmployeeCost * enrichedCount;
                        await deductDynamicCredit({
                            userId,
                            creditAmount: amountToDeduct,
                            serviceName: 'linkedinLeads',
                            description: `LinkedIn Lead Extracted - ${companyName} (${enrichedCount} employees enriched)`,
                            idempotencyKey: `linkedin-lead-${userId}-${companyName}-${Date.now()}`
                        });
                        console.log(`Deducted ${amountToDeduct} credits for extracting ${enrichedCount} enriched employees of ${companyName} (Total found: ${baseEmployees.length})`);
                    } catch (creditErr) {
                        console.log(`Error deducting credits: ${creditErr.message}`);
                    }
                } else if (baseEmployees.length > 0) {
                    console.log(`Found ${baseEmployees.length} employees for ${companyName}, but none could be enriched with contact info. No credits deducted.`);
                } else {
                    console.log(`No actual employees found for ${companyName}, no credits deducted.`);
                }

            } catch (err) {
                console.log(`Error scraping ${companyName}: ${err.message}`);
                if (newLead) {
                    newLead.status = 'failed';
                    await newLead.save();
                }
            }
        }
        
        console.log('LinkedIn lead generation completed successfully');
        return { success: true };
    },
    {
        connection: redisClient,
        concurrency: 10,
    }
);

linkedinApiLeadGenerationWorker.on('failed', (job, err) => {
    console.error(`[LinkedinApiLeadWorker] Job ${job.id} failed:`, err);
});
