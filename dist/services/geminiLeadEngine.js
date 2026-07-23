"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateTargetMarketWithGemini = exports.suggestTargetMarketsFromGemini = exports.fetchLeadsWithGemini = void 0;
const genai_1 = require("@google/genai");
const axios_1 = __importDefault(require("axios"));
// Initialize Gemini Client
const ai = new genai_1.GoogleGenAI({ apiKey: (process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || "") });
const buildPrompt = (targetMarket, geographicFocus, limit) => `
You are a B2B lead database. Generate ${limit} highly realistic and actual Indian business leads from your existing knowledge base.

Target Market: ${targetMarket}
City: ${geographicFocus}

RULES:
- STRICTLY USE REAL BUSINESS NAMES: Do NOT invent or hallucinate fake business names or generic placeholders. Use actual, existing businesses, brands, or well-known registered firms matching ${targetMarket} in ${geographicFocus} that you know exist.
- REAL WEBSITES ONLY: The "website" field MUST be the official, actual, and correct website URL of that specific business (e.g., https://www.tcs.com). No placeholder domains, no sequential numbers, no fake extensions.
- Indian mobile/landline numbers only (10 digits, starting with 6, 7, 8, or 9, or standard city landline formats).
- Real operational business emails (e.g., HR, sales, or info handles using the company's real domain name).
- Addresses must be real, existing areas or tech parks within ${geographicFocus}, India.
- Every lead MUST have phone AND email.
- All ${limit} leads must be COMPLETELY DIFFERENT businesses. No duplicates.
- Generate diverse business scales (Large enterprises, mid-sized firms, established agencies) within ${targetMarket}.
- Return ONLY a raw JSON array, no markdown, no explanation, no backticks.

[
  {
    "name": "Actual Registered Business Name",
    "address": "Real area or locality address, ${geographicFocus}",
    "phone": "9876543210",
    "additionalPhones": [],
    "emails": ["contact@actualdomain.com"],
    "website": "https://actualdomain.com",
    "linkedin": "https://www.linkedin.com/company/actualdomain",
    "rating": 4.5,
    "reviews": 250,
    "business_type": "${targetMarket}",
    "city": "${geographicFocus}",
    "location_name": "${geographicFocus}"
  }
]
`;
const askGemini = async (prompt) => {
    const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt
    });
    const raw = (result.text || "").trim();
    return raw.replace(/```json/gi, "").replace(/```/g, "").trim();
};
const parseLeadJson = (raw) => {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match)
        return [];
    try {
        const parsed = JSON.parse(match[0]);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
};
const shapeLead = (lead, targetMarket, geographicFocus, index) => {
    if (!lead.phone || !lead.emails?.length)
        return null;
    let linkedinUrl = lead.linkedin;
    if (!linkedinUrl || linkedinUrl === "N/A" || linkedinUrl === "") {
        const fullNameSlug = (lead.name || "Unknown").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
        linkedinUrl = fullNameSlug ? `https://www.linkedin.com/company/${fullNameSlug}` : "N/A";
    }
    return {
        name: lead.name || "Unknown",
        address: lead.address || `${geographicFocus}, India`,
        phone: String(lead.phone).trim(),
        additionalPhones: Array.isArray(lead.additionalPhones) ? lead.additionalPhones : [],
        emails: Array.isArray(lead.emails) ? lead.emails : [],
        website: lead.website || "N/A",
        linkedin: linkedinUrl,
        rating: parseFloat(lead.rating) || 0,
        reviews: parseInt(lead.reviews) || 0,
        business_type: targetMarket,
        city: geographicFocus,
        location_name: geographicFocus,
        placeId: `gemini-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
        match_score: Math.floor(Math.random() * (98 - 85 + 1) + 85),
        search_query: `${targetMarket} in ${geographicFocus}`,
    };
};
const fetchOneBatch = async (targetMarket, geographicFocus, batchSize, batchNum) => {
    console.log(`Batch ${batchNum} started — requesting ${batchSize} leads...`);
    try {
        const prompt = buildPrompt(targetMarket, geographicFocus, batchSize);
        const raw = await askGemini(prompt);
        const leads = parseLeadJson(raw);
        console.log(`Batch ${batchNum} done — Gemini returned ${leads.length} leads`);
        return leads;
    }
    catch (err) {
        console.error(`Batch ${batchNum} failed:`, err.message);
        return [];
    }
};
const fetchLeadsWithGemini = async (targetMarket, geographicFocus, limit = 10) => {
    console.log(`Gemini generating ${limit} leads | ${targetMarket} | ${geographicFocus}`);
    const BATCH_SIZE = 50;
    const totalBatches = Math.ceil(limit / BATCH_SIZE);
    console.log(`Total batches: ${totalBatches} x ${BATCH_SIZE} leads each`);
    const allRawLeads = [];
    for (let i = 1; i <= totalBatches; i++) {
        const batchSize = i === totalBatches ? limit - (totalBatches - 1) * BATCH_SIZE : BATCH_SIZE;
        const batchLeads = await fetchOneBatch(targetMarket, geographicFocus, batchSize, i);
        allRawLeads.push(...batchLeads);
        if (i < totalBatches) {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
    if (!allRawLeads.length) {
        console.warn("Gemini returned no leads");
        return [];
    }
    const shapedLeads = allRawLeads
        .map((lead, i) => shapeLead(lead, targetMarket, geographicFocus, i))
        .filter(Boolean);
    const seenPhones = new Set();
    const seenNames = new Set();
    const uniqueLeads = shapedLeads.filter((lead) => {
        const phoneKey = lead.phone.replace(/\D/g, "");
        const nameKey = lead.name.toLowerCase().trim();
        if (seenPhones.has(phoneKey) || seenNames.has(nameKey))
            return false;
        seenPhones.add(phoneKey);
        seenNames.add(nameKey);
        return true;
    });
    const finalLeads = uniqueLeads.slice(0, limit);
    // Validate LinkedIn URLs
    for (let lead of finalLeads) {
        if (lead.linkedin !== "N/A") {
            try {
                await axios_1.default.head(lead.linkedin, {
                    timeout: 4000,
                    validateStatus: (status) => status === 200,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
                    }
                });
            }
            catch (err) {
                lead.linkedin = "N/A";
            }
        }
    }
    return finalLeads;
};
exports.fetchLeadsWithGemini = fetchLeadsWithGemini;
const suggestTargetMarketsFromGemini = async (businessName, industry, businessDescription, input) => {
    const prompt = `You are an expert lead generation assistant. The user runs a business (Name: ${businessName || "Unknown"}, Industry: ${industry || "Unknown"}, Desc: ${businessDescription || "Unknown"}). They are looking for leads.
If they provided an input '${input || ""}', first evaluate if this input is relevant to their business. If the input is completely unrelated to their business, ignore the input and suggest 3-5 target markets that ARE relevant to their actual business. If the input IS relevant, suggest 3-5 refined target markets based on it.
If no input is provided, suggest 3-5 target markets they should reach out to. 
CRITICAL RULE: Keep each suggestion extremely short and concise (maximum 2-4 words). Do not write sentences. Examples: "E-commerce SMBs", "Local Plumbers", "Marketing Agencies".
Reply ONLY in JSON format: ["suggestion1", "suggestion2"].`;
    try {
        const raw = await askGemini(prompt);
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch (err) {
        console.error("Gemini Target Market Suggestion Error:", err.message);
        return [];
    }
};
exports.suggestTargetMarketsFromGemini = suggestTargetMarketsFromGemini;
const validateTargetMarketWithGemini = async (businessName, industry, businessDescription, targetMarket) => {
    const prompt = `You are a validation assistant. A user runs a business (Name: ${businessName || "Unknown"}, Industry: ${industry || "Unknown"}, Desc: ${businessDescription || "Unknown"}). 
They want to generate leads for the target market: '${targetMarket}'. 
Is this target market logically relevant to their business (e.g. as potential clients, partners, or B2B prospects)? 
Reply ONLY in JSON format exactly like this: { "isValid": true, "reason": "short explanation" }. Use boolean true or false for isValid.`;
    try {
        const raw = await askGemini(prompt);
        const parsed = JSON.parse(raw);
        return {
            isValid: parsed.isValid ?? true,
            reason: parsed.reason || ""
        };
    }
    catch (err) {
        console.error("Gemini Target Market Validation Error:", err.message);
        return { isValid: true, reason: "" };
    }
};
exports.validateTargetMarketWithGemini = validateTargetMarketWithGemini;
//# sourceMappingURL=geminiLeadEngine.js.map