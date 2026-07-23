"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichLinkedinEmployee = exports.generateLinkedinLead = exports.getLinkedinLead = exports.validateTargetMarket = exports.getTargetMarketSuggestions = exports.getGooglePlacesAutocomplete = exports.verifyMapLeadWhatsApp = exports.getMapLeadProgress = exports.deleteMapLead = exports.getMapLeads = exports.generateMapLeads = exports.getLeads = void 0;
const prisma_1 = __importDefault(require("../config/prisma"));
const axios_1 = __importDefault(require("axios"));
const leadsQueue_1 = require("../jobs/leadsQueue");
const linkedinQueue_1 = require("../jobs/linkedinQueue");
const geminiLeadEngine_1 = require("../services/geminiLeadEngine");
const getLeads = async (req, res) => {
    const userId = req.query.userId || "1";
    try {
        let leads = await prisma_1.default.lead.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });
        if (leads.length === 0) {
            // Seed default leads for MVP
            const defaultLeads = [
                { name: 'Mumbai Café Hub', url: 'mumbaicafehub.com', city: 'Mumbai', score: 34, status: 'Email Sent' },
                { name: 'Thane Sweet Shop', url: 'thanesweetshoppe.in', city: 'Thane', score: 51, status: 'Opened' },
                { name: 'Kurla Auto Parts', url: 'kurlaauto.com', city: 'Kurla', score: 28, status: 'Replied ✉️' },
                { name: 'Andheri Glam Salon', url: 'andheriglam.in', city: 'Andheri', score: 45, status: 'Email Sent' },
                { name: 'Powai Tech Store', url: 'powaitech.com', city: 'Powai', score: 62, status: 'Converted 🎉' },
                { name: 'Bandra Bookstore', url: 'bandrabooks.in', city: 'Bandra', score: 38, status: 'Email Sent' },
            ];
            for (const lead of defaultLeads) {
                await prisma_1.default.lead.create({
                    data: { ...lead, userId }
                });
            }
            leads = await prisma_1.default.lead.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
        }
        res.json(leads);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch leads' });
    }
};
exports.getLeads = getLeads;
const generateMapLeads = async (req, res) => {
    try {
        const { targetMarket, geographicFocus, NumberOfLeads } = req.body;
        const userId = req.user?.id || req.query.userId || "1";
        if (!targetMarket || !geographicFocus) {
            return res.status(400).json({ success: false, message: 'Target Market and Geographic Focus are required!' });
        }
        const requestedLeads = Number(NumberOfLeads) || 10;
        const job = await leadsQueue_1.leadsQueue.add('generate-leads', { targetMarket, geographicFocus, numberOfLeads: requestedLeads, userId }, { jobId: `lead-${userId}-${Date.now()}` });
        return res.json({ success: true, jobId: job.id, message: 'Lead generation started.' });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to start lead generation', error: error.message });
    }
};
exports.generateMapLeads = generateMapLeads;
const getMapLeads = async (req, res) => {
    try {
        const userId = req.user?.id || req.query.userId || "1";
        const isAdmin = req.user?.role === 'admin';
        const filter = isAdmin ? {} : { userId };
        const leads = await prisma_1.default.mapLead.findMany({
            where: filter,
            orderBy: { createdAt: 'desc' },
            include: isAdmin ? { user: { select: { name: true, email: true } } } : undefined
        });
        const totalInDb = leads.length;
        let avgRating = 0;
        let leadsWithEmails = 0;
        if (totalInDb > 0) {
            const sumRating = leads.reduce((sum, lead) => sum + (lead.rating || 0), 0);
            avgRating = sumRating / totalInDb;
            leadsWithEmails = leads.filter(l => l.emails && l.emails !== "[]" && l.emails !== "").length;
        }
        return res.json({
            success: true,
            data: leads.map(l => ({
                ...l,
                emails: l.emails ? JSON.parse(l.emails) : [],
                additionalPhones: l.additionalPhones ? JSON.parse(l.additionalPhones) : [],
            })),
            statistics: { totalInDb, avg_rating: avgRating.toFixed(1), leads_with_emails: leadsWithEmails }
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch leads", details: error.message });
    }
};
exports.getMapLeads = getMapLeads;
const deleteMapLead = async (req, res) => {
    try {
        const id = req.params.id;
        const userId = req.user?.id || req.query.userId || "1";
        const deletedLead = await prisma_1.default.mapLead.deleteMany({ where: { id, userId } });
        if (deletedLead.count === 0) {
            return res.status(404).json({ success: false, message: "Lead not found" });
        }
        return res.json({ success: true, message: "Lead deleted successfully" });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to delete lead" });
    }
};
exports.deleteMapLead = deleteMapLead;
const getMapLeadProgress = async (req, res) => {
    try {
        const { jobId } = req.query;
        if (!jobId)
            return res.json({ success: false, message: 'Job ID required' });
        const job = await leadsQueue_1.leadsQueue.getJob(jobId);
        if (!job)
            return res.json({ success: true, data: null, message: 'Job not found' });
        const state = await job.getState();
        const progress = job.progress;
        return res.json({ success: true, data: { state, progress } });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to get progress' });
    }
};
exports.getMapLeadProgress = getMapLeadProgress;
const verifyMapLeadWhatsApp = async (req, res) => {
    try {
        const id = req.params.id;
        const lead = await prisma_1.default.mapLead.findUnique({ where: { id } });
        if (lead) {
            await prisma_1.default.mapLead.update({
                where: { id },
                data: { isWhatsAppNumber: true, whatsappProcessingStatus: 'COMPLETED' }
            });
        }
        return res.json({ success: true, isWhatsAppNumber: true, message: "WhatsApp verification mocked successfully" });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};
exports.verifyMapLeadWhatsApp = verifyMapLeadWhatsApp;
const getGooglePlacesAutocomplete = async (req, res) => {
    try {
        const { input } = req.query;
        if (!input)
            return res.json({ success: true, predictions: [] });
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey)
            return res.status(500).json({ success: false, message: "Google Maps API Key is missing." });
        const response = await axios_1.default.get(`https://maps.googleapis.com/maps/api/place/autocomplete/json`, {
            params: { input, types: 'geocode', key: apiKey, }
        });
        return res.json({ success: true, predictions: response.data.predictions || [] });
    }
    catch (err) {
        return res.status(500).json({ success: false, message: "Failed to fetch autocomplete suggestions" });
    }
};
exports.getGooglePlacesAutocomplete = getGooglePlacesAutocomplete;
const getTargetMarketSuggestions = async (req, res) => {
    try {
        const { input } = req.body;
        const suggestions = await (0, geminiLeadEngine_1.suggestTargetMarketsFromGemini)("User Business", "General Industry", "Provides B2B Services", input);
        return res.json({ success: true, data: suggestions });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to generate suggestions" });
    }
};
exports.getTargetMarketSuggestions = getTargetMarketSuggestions;
const validateTargetMarket = async (req, res) => {
    try {
        const { targetMarket } = req.body;
        const result = await (0, geminiLeadEngine_1.validateTargetMarketWithGemini)("User Business", "General Industry", "Provides B2B Services", targetMarket);
        return res.json({ success: true, data: result });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to validate target market" });
    }
};
exports.validateTargetMarket = validateTargetMarket;
const getLinkedinLead = async (req, res) => {
    try {
        const mapLeadId = req.params.mapLeadId;
        const userId = req.user?.id || req.query.userId || "1";
        const linkedinLead = await prisma_1.default.linkedinLead.findUnique({
            where: { mapLeadId },
            include: { employees: true }
        });
        return res.json({ success: true, data: linkedinLead });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to fetch LinkedIn lead", details: error.message });
    }
};
exports.getLinkedinLead = getLinkedinLead;
const generateLinkedinLead = async (req, res) => {
    try {
        const { mapLeadId, companyName } = req.body;
        const userId = req.user?.id || req.query.userId || "1";
        if (!mapLeadId || !companyName) {
            return res.status(400).json({ success: false, message: "mapLeadId and companyName are required" });
        }
        const job = await linkedinQueue_1.linkedinQueue.add('generate-linkedin', {
            mapLeadId,
            companyName,
            userId
        }, { jobId: `linkedin-${mapLeadId}-${Date.now()}` });
        return res.json({ success: true, jobId: job.id, message: "LinkedIn scraping started" });
    }
    catch (error) {
        return res.status(500).json({ success: false, message: "Failed to start LinkedIn scraping", details: error.message });
    }
};
exports.generateLinkedinLead = generateLinkedinLead;
const enrichLinkedinEmployee = async (req, res) => {
    try {
        const { leadId, employeeName, profileUrl, companyName } = req.body;
        if (!process.env.ROCKETREACH_API_KEY) {
            return res.status(400).json({ success: false, message: 'RocketReach API key not found in server env' });
        }
        let url = `https://api.rocketreach.co/api/v2/person/lookup?`;
        if (profileUrl) {
            url += `linkedin_url=${encodeURIComponent(profileUrl)}`;
        }
        else {
            url += `name=${encodeURIComponent(employeeName)}&current_employer=${encodeURIComponent(companyName)}`;
        }
        const { data } = await axios_1.default.get(url, {
            headers: {
                'Api-Key': process.env.ROCKETREACH_API_KEY
            }
        });
        if (data) {
            let emails = data.emails || [];
            let phones = data.phones || [];
            let professionalEmail = '';
            let personalEmail = '';
            for (let e of emails) {
                let emailStr = typeof e === 'object' ? (e.email || e.smtp_email || '') : e;
                if (!emailStr)
                    continue;
                const isPersonal = /@gmail\.com|@yahoo\.com|@hotmail\.com|@outlook\.com|@icloud\.com|@live\.com/i.test(emailStr);
                if (isPersonal && !personalEmail) {
                    personalEmail = emailStr;
                }
                else if (!isPersonal && !professionalEmail) {
                    professionalEmail = emailStr;
                }
            }
            let rrPhone = phones.length > 0 ? (typeof phones[0] === 'object' ? (phones[0].number || '') : phones[0]) : '';
            let rrPhone2 = phones.length > 1 ? (typeof phones[1] === 'object' ? (phones[1].number || '') : phones[1]) : '';
            // Find lead and update the specific employee using Prisma
            const employee = await prisma_1.default.linkedinEmployee.findFirst({
                where: {
                    linkedinLeadId: leadId,
                    name: employeeName
                }
            });
            if (employee) {
                await prisma_1.default.linkedinEmployee.update({
                    where: { id: employee.id },
                    data: {
                        email: professionalEmail || employee.email,
                        personalEmail: personalEmail || employee.personalEmail,
                        phone: rrPhone || employee.phone,
                        mobilePhone: rrPhone2 || employee.mobilePhone
                    }
                });
            }
            return res.json({
                success: true,
                message: `Contact enriched for ${employeeName}`,
                data: {
                    email: professionalEmail,
                    phone: rrPhone,
                    personalEmail: personalEmail,
                    mobilePhone: rrPhone2
                }
            });
        }
        res.status(404).json({ success: false, message: 'No data found from RocketReach' });
    }
    catch (error) {
        console.error('Enrichment error:', error.message);
        return res.status(500).json({ success: false, message: "Failed to enrich contact", details: error.message });
    }
};
exports.enrichLinkedinEmployee = enrichLinkedinEmployee;
//# sourceMappingURL=leads.controller.js.map