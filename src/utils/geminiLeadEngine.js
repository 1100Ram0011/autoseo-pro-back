import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from "axios";

// ─── Client ek baar banao ─────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// ─── Prompt banao ─────────────────────────────────────────────────────────────
// const buildPrompt = (targetMarket, geographicFocus, limit) => `
// You are a B2B lead database. Generate ${limit} realistic Indian business leads.

// Target Market: ${targetMarket}
// City: ${geographicFocus}

// RULES:
// - Indian mobile numbers only (10 digits, starting with 6, 7, 8, or 9)
// - Real looking business emails (e.g. info@businessname.com)
// - Addresses must be in ${geographicFocus}, India
// - Every lead MUST have phone AND email
// - All ${limit} leads must be COMPLETELY DIFFERENT businesses
// - NO duplicate business names
// - NO duplicate phone numbers
// - NO duplicate emails
// - Generate diverse business types within ${targetMarket}
// - Use different areas/localities in ${geographicFocus}
// - Return ONLY a raw JSON array, no markdown, no explanation, no backticks

// DIVERSITY EXAMPLES:
// If ${targetMarket} = "IT Companies", generate:
// - Software development firms
// - Web design agencies
// - Mobile app developers
// - Cloud consulting companies
// - Cybersecurity firms
// - Data analytics companies
// etc.

// [
//   {
//     "name": "Unique Business Name ${Date.now()}",  // ← Add timestamp for uniqueness
//     "address": "Full address, ${geographicFocus}",
//     "phone": "9876543210",
//     "additionalPhones": [],
//     "emails": ["contact@business.com"],
//     "website": "https://business.com",
//     "rating": 4.2,
//     "reviews": 120,
//     "business_type": "${targetMarket}",
//     "city": "${geographicFocus}",
//     "location_name": "${geographicFocus}"
//   }
// ]
// `;

const buildPrompt = (targetMarket, geographicFocus, limit, radius) => `
You are a B2B lead database. Generate ${limit} highly realistic and actual Indian business leads from your existing knowledge base.

Target Market: ${targetMarket}
Target Location: ${geographicFocus}
${radius ? `STRICT RADIUS CONSTRAINT: You may include businesses within a ${radius} km radius of ${geographicFocus}. CRITICAL GEOGRAPHICAL ACCURACY: You must have explicit knowledge that the city/town is actually within ${radius} km of ${geographicFocus}. Do NOT guess or assume proximity based on the state. If you are not absolutely certain that a city is within ${radius} km, DO NOT include it. For example, do not include cities like 'Pen' if the target location is hundreds of kilometers away.` : ''}

RULES:
- STRICTLY USE REAL BUSINESS NAMES: Do NOT invent or hallucinate fake business names or generic placeholders. Use actual, existing businesses, brands, or well-known registered firms matching ${targetMarket}.
- STRICT LOCATION: You MUST ONLY generate businesses that are ACTUALLY located in ${geographicFocus}${radius ? ` or genuinely within the strict ${radius} km radius` : ''}. DO NOT expand the search area beyond this restriction under any circumstances.
- ACTUAL LOCATION: You MUST provide the ACTUAL city and address where the business is located. Do not just blindly copy "${geographicFocus}" if the business is actually in a different city.
- DISTANCE CHECK: You MUST provide a realistic estimate of the distance in km from ${geographicFocus} in the "estimated_distance_from_target_km" field. If the radius constraint is active and this distance is greater than ${radius || 0} km, DO NOT include the business in the array.
- REAL WEBSITES ONLY: The "website" field MUST be the official, actual, and correct website URL of that specific business. No placeholder domains, no sequential numbers, no fake extensions.
- Indian mobile/landline numbers only (10 digits, starting with 6, 7, 8, or 9, or standard city landline formats).
- Real operational business emails (e.g., HR, sales, or info handles using the company's real domain name).
- Addresses must be real, existing areas or tech parks within the actual city.
- Every lead MUST have phone AND email.
- All ${limit} leads must be COMPLETELY DIFFERENT businesses. No duplicates.
- Generate diverse business scales (Large enterprises, mid-sized firms, established agencies) within ${targetMarket}.
- Return ONLY a raw JSON array, no markdown, no explanation, no backticks.
- IF YOU CANNOT FIND ANY REAL BUSINESSES MATCHING THE CRITERIA: DO NOT write apologies or explanations inside the JSON properties. Simply return an empty JSON array: [].

[
  {
    "name": "Actual Registered Business Name",
    "address": "Real area or locality address, Actual City",
    "phone": "9876543210",
    "additionalPhones": [],
    "emails": ["contact@actualdomain.com"],
    "website": "https://actualdomain.com",
    "linkedin": "https://www.linkedin.com/company/actualdomain",
    "rating": 4.5,
    "reviews": 250,
    "business_type": "${targetMarket}",
    "city": "Actual City",
    "location_name": "Actual City",
    "estimated_distance_from_target_km": 15
  }
]
`;
// ───  ─────────────────────────────────────────────────────────
const askGemini = async (prompt) => {
  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();
  return raw
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
};

// ───  ───────────────────────────────────────────────────
const parseLeadJson = (raw) => {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// ───  ───────────────────────────────────────────
const shapeLead = (lead, targetMarket, geographicFocus, index, radius) => {
  if (!lead.phone || !lead.emails?.length) return null;
  if (!lead.name || lead.name.length > 80 || /unable to find|cannot find|apologize|apologies|adjust the location|stringent rules/i.test(lead.name)) return null;

  if (radius && lead.estimated_distance_from_target_km && Number(lead.estimated_distance_from_target_km) > Number(radius)) {
    return null;
  }

  let linkedinUrl = lead.linkedin;
  if (!linkedinUrl || linkedinUrl === "N/A" || linkedinUrl === "") {
    const fullNameSlug = (lead.name || "Unknown").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim().replace(/\s+/g, "-");
    linkedinUrl = fullNameSlug ? `https://www.linkedin.com/company/${fullNameSlug}` : "N/A";
  }

  return {
    name: lead.name || "Unknown",
    address: lead.address || `${geographicFocus}, India`,
    phone: String(lead.phone).trim(),
    additionalPhones: Array.isArray(lead.additionalPhones)
      ? lead.additionalPhones
      : [],
    emails: Array.isArray(lead.emails) ? lead.emails : [],
    website: lead.website || "N/A",
    linkedin: linkedinUrl,
    rating: parseFloat(lead.rating) || 0,
    reviews: parseInt(lead.reviews) || 0,
    business_type: targetMarket,
    city: lead.city || geographicFocus,
    location_name: lead.location_name || lead.city || geographicFocus,
    placeId: `gemini-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    match_score: Math.floor(Math.random() * (98 - 85 + 1) + 85),
    search_query: `${targetMarket} in ${geographicFocus}`,

  };
};

// ─── ──────────────────────────────────────────────────────
const fetchOneBatch = async (
  targetMarket,
  geographicFocus,
  batchSize,
  batchNum,
  radius
) => {
  console.log(`Batch ${batchNum} started — requesting ${batchSize} leads...`);
  try {
    const prompt = buildPrompt(targetMarket, geographicFocus, batchSize, radius);
    const raw = await askGemini(prompt);
    const leads = parseLeadJson(raw);
    console.log(`Batch ${batchNum} done — Gemini returned ${leads.length} leads`);
    return leads;
  } catch (err) {
    console.error(`Batch ${batchNum} failed:`, err.message);
    return [];
  }
};

// ─── MAIN REUSABLE FUNCTION ───────────────────────────────────────────────────
/**
 * Gemini se leads generate karo — batch system ke saath
 * 500 leads bhi aayenge — automatically batches mein todega
 *
 * @param {string} targetMarket    - e.g. "IT Companies"
 * @param {string} geographicFocus - e.g. "Mumbai"
 * @param {number} limit           - kitne leads chahiye (default 10, max 500)
 * @returns {Promise<Array>}       - valid unique leads array
 *
 * @example
 * const leads = await fetchLeadsWithGemini('IT Companies', 'Mumbai', 500);
 */
export const fetchLeadsWithGemini = async (
  targetMarket,
  geographicFocus,
  limit = 10,
  radius = null
) => {
  console.log(`Gemini generating ${limit} leads | ${targetMarket} | ${geographicFocus}`);

  // ───  ────────────────────────────────
  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(limit / BATCH_SIZE);

  console.log(`Total batches: ${totalBatches} x ${BATCH_SIZE} leads each`);

  const allRawLeads = [];

  // ───   ─────────────────────────────────────
  for (let i = 1; i <= totalBatches; i++) {

    const batchSize =
      i === totalBatches ? limit - (totalBatches - 1) * BATCH_SIZE : BATCH_SIZE;

    const batchLeads = await fetchOneBatch(
      targetMarket,
      geographicFocus,
      batchSize,
      i,
      radius
    );
    allRawLeads.push(...batchLeads);

    console.log(`Batch ${i}/${totalBatches} complete — total so far: ${allRawLeads.length}`);


    if (i < totalBatches) {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  if (!allRawLeads.length) {
    console.warn("Gemini returned no leads");
    return [];
  }

  // ───   ────────────────────────────────────────────────
  const shapedLeads = allRawLeads
    .map((lead, i) => shapeLead(lead, targetMarket, geographicFocus, i, radius))
    .filter(Boolean); // null wale hato

  // ───   ────────────────────────────────────────────────
  const seenPhones = new Set();
  const seenNames = new Set();

  const uniqueLeads = shapedLeads.filter((lead) => {
    const phoneKey = lead.phone.replace(/\D/g, "");
    const nameKey = lead.name.toLowerCase().trim();

    // 
    if (seenPhones.has(phoneKey) || seenNames.has(nameKey)) return false;

    seenPhones.add(phoneKey);
    seenNames.add(nameKey);
    return true;
  });

  const finalLeads = uniqueLeads.slice(0, limit);

  // Validate LinkedIn URLs to ensure they exist
  for (let lead of finalLeads) {
    if (lead.linkedin !== "N/A") {
      try {
        const res = await axios.head(lead.linkedin, {
          timeout: 4000,
          validateStatus: (status) => status === 200, // Only accept 200 OK
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
          }
        });
      } catch (err) {
        // If 404, 999, timeout, or anything else, mark as N/A
        lead.linkedin = "N/A";
      }
    }
  }

  console.log(`Final: ${finalLeads.length} unique valid leads (requested: ${limit})`);
  return finalLeads;
};

export async function searchGoogleMaps({ query, city }) {
  try {
    // 
    const searchUrl =
      "https://maps.googleapis.com/maps/api/place/textsearch/json";

    const searchResponse = await axios.get(searchUrl, {
      params: {
        query: `${query} in ${city}`,
        key: process?.env?.GOOGLE_MAPS_API_KEY,
      },
    });

    const places = searchResponse.data.results || [];

    //  
    const businesses = await Promise.all(
      places.slice(0, 5).map(async (place) => {
        try {
          const detailsUrl =
            "https://maps.googleapis.com/maps/api/place/details/json";

          const detailsResponse = await axios.get(detailsUrl, {
            params: {
              place_id: place.place_id,
              fields: [
                "name",
                "formatted_address",
                "formatted_phone_number",
                "website",
                "rating",
              ].join(","),
              key: process?.env?.GOOGLE_MAPS_API_KEY,
            },
          });

          const details = detailsResponse.data.result;

          return {
            name: details.name,
            address: details.formatted_address,
            phone: details.formatted_phone_number || "",
            website: details.website || "",
            rating: details.rating || 0,
          };
        } catch (err) {
          return null;
        }
      }),
    );

    return businesses.filter(Boolean);
  } catch (error) {
    console.error("Google Maps API Error:", error.message);

    return [];
  }
}

// const result = await searchGoogleMaps({
//   query: "restaurants",
//   city: "Mumbai",
// });

// console.log(result);

export const suggestTargetMarketsFromGemini = async (businessName, industry, businessDescription, input) => {
  const prompt = `You are an expert lead generation assistant. The user is looking for B2B leads.
Based on the user's keyword '${input || ""}', suggest 3-5 specific target markets they should reach out to. 
If no keyword is provided, suggest 3-5 popular B2B target markets.
CRITICAL RULE: Keep each suggestion extremely short and concise (maximum 2-4 words). Do not write sentences. Examples: "E-commerce SMBs", "Local Plumbers", "Marketing Agencies".
Reply ONLY in JSON format: ["suggestion1", "suggestion2"].`;
  
  try {
    const raw = await askGemini(prompt);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Gemini Target Market Suggestion Error:", err.message);
    return [];
  }
};

export const validateTargetMarketWithGemini = async (businessName, industry, businessDescription, targetMarket) => {
  const prompt = `You are a validation assistant. A user wants to generate leads for the target market: '${targetMarket}'. 
Is this a valid and recognizable target market for B2B lead generation?
If the input is just random gibberish (e.g., 'asdasd', '123123') or not a valid market category, mark it as invalid and provide a short reason.
Reply ONLY in JSON format exactly like this: { "isValid": true, "reason": "short explanation" }. Use boolean true or false for isValid.`;

  try {
    const raw = await askGemini(prompt);
    const parsed = JSON.parse(raw);
    return {
      isValid: parsed.isValid ?? true,
      reason: parsed.reason || ""
    };
  } catch (err) {
    console.error("Gemini Target Market Validation Error:", err.message);
    return { isValid: true, reason: "" }; // Default to true to prevent blocking if AI fails
  }
};


