import Groq from "groq-sdk";
import config from "../config/config.js";
import logger from "../config/logger.js";

function cleanAIResponse(aiResponse, fallback) {
  aiResponse = aiResponse.replace(/```/g, "").trim();

  if (
    (aiResponse.startsWith('"') && aiResponse.endsWith('"')) ||
    (aiResponse.startsWith("'") && aiResponse.endsWith("'"))
  ) {
    aiResponse = aiResponse.slice(1, -1);
  }

  return aiResponse || fallback;
}

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

export async function cleanSearchQueriesWithAI(
  rawQueries = [],
  analysisContext = {},
) {
  if (!Array.isArray(rawQueries) || rawQueries.length === 0) return [];

  const sanitized = rawQueries
    .filter(Boolean)
    .map((q) => String(q).trim())
    .filter((q) => q.length > 0);

  if (!sanitized.length) return [];

  // Extract context about what the analyzed business SELLS
  const productType = analysisContext?.business_overview?.business_model || "";
  const productDescription =
    analysisContext?.business_overview?.value_proposition || "";
  const industries = (
    analysisContext?.business_overview?.industries || []
  ).join(", ");

  const prompt = `
You are an expert B2B lead generation strategist.

A business sells: "${productDescription || productType || "software/services"}"
It operates in: "${industries || "technology"}"

Your task: Given a list of ICP descriptions and market segments from this business's profile,
convert them into SHORT, SPECIFIC Google Maps search terms that represent 
REAL PHYSICAL BUSINESSES that would PURCHASE this product or service.

═══════════════════════════════════════════
UNIVERSAL THINKING FRAMEWORK
═══════════════════════════════════════════

Step 1 — Ask: "Who actually BUYS this product?"
  - If the product is CRM software → buyers are sales teams in any industry (pharma, real estate, insurance)
  - If the product is payment gateway → buyers are ecommerce stores, retail chains, restaurants
  - If the product is HR software → buyers are manufacturing plants, corporate offices, hospitals
  - If the product is accounting software → buyers are trading companies, retail shops, manufacturers
  - If the product is marketing tool → buyers are consumer brands, retail chains, fmcg companies

Step 2 — Convert the segment to the BUYER'S INDUSTRY TYPE, not the segment label itself:
  - "Accounting Firms" → who needs accounting = "trading company", "retail shop", "manufacturer"
  - "Digital Agencies" → who hires agencies = "consumer brand", "retail chain", "fmcg company"  
  - "Enterprises" → what kind = "corporate office", "large manufacturer", "conglomerate"
  - "SMBs" → what kind = "retail shop", "local manufacturer", "trading company"
  - "Startups" → what kind = "tech startup office", "coworking space"

Step 3 — ALWAYS reject these output types:
  ✗ Individual people: freelancer, content writer, web developer, designer, consultant
  ✗ Vendor/agency types that SELL similar things: "software company", "saas company", "crm company", "platform"
  ✗ Advisory/setup services: "business setup consultant", "auditor", "advisory firm"
  ✗ Abstract phrases: "companies that...", "organizations with...", "businesses requiring..."
  ✗ Non-Google-Maps-searchable terms: job titles, decision maker names, vague descriptors
  ✗ Communities / nonprofits / hubs / spaces:
    "hub", "incubator", "accelerator", "innovation hub", "community centre",
    "coworking space", "association", "ngo", "nonprofit", "foundation",
    "entrepreneurs organization", "chamber of commerce"

Step 4 — Output must be:
  ✓ 2-4 words maximum
  ✓ A real business type findable on Google Maps
  ✓ Represents a BUYER, not a seller or intermediary
  ✓ Industry-specific enough to return relevant results

═══════════════════════════════════════════
UNIVERSAL CONVERSION RULES
═══════════════════════════════════════════

SIZE/TYPE SEGMENTS → convert to specific industry buyers:
  "SMBs / Small businesses" → ["retail shop", "trading company", "local manufacturer"]
  "Enterprises / Large companies" → ["corporate office", "manufacturing plant", "conglomerate office"]
  "Startups / Solopreneurs" → ["web design studio", "digital marketing agency", "professional services firm"]
  "Mid-market companies" → ["mid-size manufacturer", "regional distributor", "growing retail chain"]

INDUSTRY SEGMENTS → keep but make Google Maps friendly:
  "Financial Services / BFSI" → ["bank branch", "insurance company", "nbfc", "investment firm"]
  "Healthcare / Medical" → ["hospital", "clinic", "diagnostic centre", "pharmacy chain"]
  "Manufacturing / Industrial" → ["manufacturing company", "factory", "industrial unit"]
  "Education / Edtech" → ["school", "college", "coaching institute", "university"]
  "Real Estate" → ["real estate developer", "property developer", "construction company"]
  "Retail / FMCG" → ["retail chain", "supermarket", "consumer goods company", "fmcg distributor"]
  "Logistics / Supply Chain" → ["logistics company", "freight company", "warehouse"]
  "Automotive" → ["car dealership", "automobile company", "auto parts dealer"]
  "Hospitality / Travel" → ["hotel", "travel agency", "resort", "tour operator"]
  "Agriculture" → ["agribusiness", "farm equipment dealer", "agri cooperative"]
  "Legal / Professional Services" → ["law firm", "legal services company", "chartered accountant firm"]

TECH/DIGITAL SEGMENTS → convert to their OFFLINE/PHYSICAL BUYER counterparts:
  "SaaS companies" → ["it company", "tech office", "product company"]
  "E-commerce businesses" → ["ecommerce company", "online retail brand", "d2c company"]
  "Digital agencies" → ["advertising agency", "marketing firm", "creative studio"]
  "Fintech companies" → ["fintech startup", "payment company", "neobank"]
  "Digital Native Businesses" → ["tech startup", "app company", "digital brand"]

ICP DESCRIPTIONS → extract the BUYER INDUSTRY from the description:
  "Companies with field sales teams" → ["pharmaceutical company", "fmcg company", "insurance company"]
  "Businesses with high lead volumes" → ["real estate developer", "bank", "edtech company"]
  "Companies needing payroll automation" → ["manufacturing plant", "corporate office", "hospital"]
  "Businesses needing payment infrastructure" → ["ecommerce company", "retail chain", "restaurant chain"]
  "Organizations needing CRM" → ["pharmaceutical company", "real estate company", "insurance firm"]
  "Companies consolidating software" → ["manufacturing company", "trading company", "retail chain"]
  "Businesses needing data privacy" → ["hospital", "legal firm", "financial company"]
  "Growing businesses needing software" → ["manufacturing company", "retail chain", "trading company"]

PHYSICAL PRODUCT BUYERS → find the businesses that BUY/resell/use these products:
  "Furniture" / "Home furnishing" → ["interior design firm", "architecture firm", "corporate office", "hotel"]
  "Office furniture" / "Corporate buyers" → ["corporate office", "coworking space", "it company office"]
  "Interior designers & architects" → ["interior design firm", "architecture firm", "design studio"]
  "Businesses setting up offices" → ["corporate office", "coworking space", "startup office"]
  "Healthcare furniture" → ["hospital", "clinic", "diagnostic centre"]
  "Hospitality furniture" → ["hotel", "resort", "restaurant chain"]
  "Industrial equipment" → ["manufacturing company", "factory", "industrial unit"]
  "Retail fixtures / display" → ["retail chain", "supermarket", "showroom"]
  "Construction materials" → ["construction company", "real estate developer", "builder"]
  "Clothing / Apparel" → ["retail clothing store", "fashion brand", "garment manufacturer"]
  "Food products / FMCG" → ["supermarket", "grocery chain", "food distributor"]
  "Electronics / Appliances" → ["electronics retailer", "appliance store", "consumer electronics company"]
  "Pharma / Medical devices" → ["hospital", "clinic", "pharmacy chain", "diagnostic lab"]
  "Automobiles / Vehicles" → ["car dealership", "fleet company", "logistics company"]
  "Agricultural inputs" → ["farm", "agri cooperative", "agricultural dealer"]

SKIP THESE ENTIRELY (return nothing for these):
  - "Freelancers", "Solopreneurs", "Content writers", "Web developers", "Designers"
  - "Decision makers", "CIOs", "CFOs", "VP Sales" (job titles, not businesses)
  - Any segment that is itself a SOFTWARE/SAAS/TECH PRODUCT TYPE
  - B2C INDIVIDUALS — skip these, they are not findable on Google Maps:
    "Homeowners", "Families", "Renters", "Individual buyers", "Consumers"
    "Urban middle class", "Age 28-50", "Quality-conscious buyers"
    Any segment describing a PERSON, DEMOGRAPHIC, or AGE GROUP

═══════════════════════════════════════════
NOW PROCESS THESE SEGMENTS:
═══════════════════════════════════════════

Input segments from the analyzed website:
${JSON.stringify(sanitized)}

Return ONLY a flat JSON array of 5-10 unique, short, Google Maps-searchable buyer business types.
IMPORTANT: Prioritize SPECIFIC business types over generic ones.
Examples: ["hospital", "bank branch", "manufacturing company", "retail chain", "logistics company", "school", "restaurant", "hotel", "pharmacy", "clinic"]
AVOID: "corporate office", "business center", "office building" (too generic)

JSON array only. No explanation. No markdown. No extra text.
`;

  let aiResponse = null;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `You are a B2B lead generation expert. 
Your only job is to output a JSON array of Google Maps search terms representing BUYER businesses.
Think carefully about WHO BUYS the product being sold, not who sells similar products.
Never output individuals, job titles, or vendor types.
Always output real, physical business establishments findable on Google Maps.
Output JSON array only — no markdown, no explanation.`,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.1,
    });

    aiResponse = completion.choices?.[0]?.message?.content || "";

    aiResponse = aiResponse
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    const start = aiResponse.indexOf("[");
    if (start === -1) return sanitized;

    const parsed = JSON.parse(aiResponse.slice(start));
    if (!Array.isArray(parsed)) return sanitized;

    // ── Universal post-filter: reject anything that slipped through ──
    const REJECT_KEYWORDS = [
      // Vendors/sellers
      "saas",
      "crm",
      "erp",
      "platform",
      "software company",
      // Individuals
      "freelancer",
      "content writer",
      "web developer",
      "graphic designer",
      "solopreneur",
      "individual",
      "contractor",
      "blogger",
      // Intermediaries
      "setup agency",
      "auditor",
      // Setup/formation/pro services (non-buyer)
      "business setup",
      "company formation",
      "formation",
      "pro services",
      "visa",
      "immigration",
      // Job titles
      "cio",
      "cfo",
      "cto",
      "vp ",
      "director",
      "manager",
      "officer",
      // Vague/abstract
      "companies that",
      "businesses that",
      "organizations with",
      "businesses requiring",
      "teams needing",
      // Generic business types (too broad)
      "corporate office",
      "business center",
      "office building",
      // Communities / hubs / nonprofits / spaces (low-intent, not buyers)
      "hub",
      "incubator",
      "accelerator",
      "coworking",
      "co-working",
      "community",
      "foundation",
      "nonprofit",
      "non-profit",
      "ngo",
      "association",
      "chamber of commerce",
      "innovation centre",
      "innovation center",
      "entrepreneurs organization",
      "entrepreneur organization",
      "recruitment agency",
      "placement consultant",
      "staffing",
      "manpower",
      "hiring agency",
      "hr consultancy",
      // HR / hiring intermediaries (more variants)
      "talent acquisition",
      "executive search",
      "headhunter",
      "recruiter",

      // Low-value service businesses
      "document clearing",
      "attestation",
      "certificate attestation",

      // Generic agencies
      "digital marketing agency",
      "marketing agency",
      "seo agency",
      "branding agency",

      // Training / institutes (not buyers)
      "training institute",
      "coaching center",
      "academy",
    ];
    const ALLOW_KEYWORDS = [
      "company",
      "corporate",
      "office",
      "pvt ltd",
      "private limited",
      "ltd",
      "inc",
      "llp",
      "industries",
      "solutions",
    ];

    const filtered = parsed
      .map((q) => String(q).trim().toLowerCase())
      .filter((q) => q.length > 2 && q.length <= 50)
      .filter((q) => !REJECT_KEYWORDS.some((bad) => q.includes(bad)))
      .filter((q) => {
        // Allow if it has good keywords OR is a known valid business type
        return ALLOW_KEYWORDS.some((good) => q.includes(good)) ||
          q.includes('school') || q.includes('college') || q.includes('university') ||
          q.includes('institute') || q.includes('academy') || q.includes('educational') ||
          q.includes('hospital') || q.includes('clinic') || q.includes('bank') ||
          q.includes('restaurant') || q.includes('hotel') || q.includes('retail');
      });

    const unique = [...new Set(filtered)];

    logger.info("[cleanSearchQueriesWithAI] Final queries", {
      input: sanitized,
      output: unique,
      productContext: productDescription || productType,
    });

    // ── Contextual fallback: if the AI output was fully filtered out,
    // return high-intent buyer business-types based on the analyzed product.
    if (!unique.length) {
      const ctx =
        `${productDescription || ""} ${productType || ""} ${industries || ""}`.toLowerCase();
      const looksLikeWebsiteBuilder =
        ctx.includes("website") ||
        ctx.includes("website builder") ||
        ctx.includes("landing page") ||
        ctx.includes("web builder") ||
        ctx.includes("e-commerce") ||
        ctx.includes("ecommerce");

      if (looksLikeWebsiteBuilder) {
        return [
          "digital marketing agency",
          "web design studio",
          "branding agency",
          "accounting firm",
          "law firm",
          "real estate agency",
          "restaurant",
          "retail shop",
          "corporate office",
          "manufacturing company",
          "trading company",
          "it company office",
          "logistics company",
        ];
      }
    }

    return unique.length ? unique : sanitized;
  } catch (err) {
    logger.error("[cleanSearchQueriesWithAI] Failed:", {
      error: err.message,
      rawQueries,
    });
    return sanitized;
  }
}

export async function enhanceUserTopicPrompt(userPrompt = "", limit = 150) {
  if (!userPrompt || typeof userPrompt !== "string") return "";

  const sanitized = userPrompt.trim();
  if (!sanitized.length) return "";

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.5,
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content: `You enhance short social media content topics.
Rewrite the user's topic to be clearer, more engaging, and suitable for social media planning.
Keep the original intent.
Return only one improved topic sentence under ${limit} characters.
Do not include explanations or formatting.`
        },
        {
          role: "user",
          content: sanitized
        }
      ]
    });

    let aiResponse = completion.choices?.[0]?.message?.content || "";

    aiResponse = aiResponse
      .replace(/```/g, "")
      .trim();

    // remove wrapping quotes
    if (
      (aiResponse.startsWith('"') && aiResponse.endsWith('"')) ||
      (aiResponse.startsWith("'") && aiResponse.endsWith("'"))
    ) {
      aiResponse = aiResponse.slice(1, -1);
    }

    return aiResponse || sanitized;

  } catch (err) {
    console.error("[enhanceUserPrompt] Failed:", err.message);
    return sanitized;
  }
}

export async function validateUserPrompt(userPrompt = "") {
  if (!userPrompt || typeof userPrompt !== "string") {
    return { safe: false, reason: "Empty or invalid prompt" };
  }

  const sanitized = userPrompt.trim();

  if (!sanitized.length) {
    return { safe: false, reason: "Empty prompt" };
  }

  const validatorInstruction = `
  You are a safety validator.

Your job is to detect CLEAR harmful intent only.

Mark as unsafe ONLY if the user is:
- explicitly asking for harm, violence, illegal activity, hate, or abuse

DO NOT mark as unsafe for:
- normal requests (e.g. create image, make video, build app)
- vague prompts
- harmless creative tasks
Rules:
- Be lenient
- Assume good intent unless clearly harmful

Return ONLY JSON:
{"safe": true}
OR
{"safe": false, "reason": "short reason"}
`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      max_tokens: 4000,
      messages: [
        { role: "system", content: validatorInstruction },
        { role: "user", content: sanitized }
      ]
    });


    // Clean possible markdown
    let aiResponse = completion?.choices?.[0]?.message?.content || "";

    console.log("RAW RESPONSE:", aiResponse);

    aiResponse = aiResponse
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    let parsed;

    try {
      parsed = JSON.parse(aiResponse);
    } catch {
      const match = aiResponse.match(/\{[\s\S]*?\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    // ✅ FAIL-OPEN instead of FAIL-CLOSED
    if (!parsed || typeof parsed.safe !== "boolean") {
      return { safe: true };
    }

    return parsed;



  } catch (err) {
    console.error("[validateUserPrompt] Failed:", err.message);
    return { safe: false, reason: "Validation failed" };
  }
}


export async function validateTopicMeaning(userPrompt = "") {
  // ❌ Basic validation
  if (!userPrompt || typeof userPrompt !== "string") {
    return { valid: false, reason: "Invalid topic" };
  }

  // 🔹 Trim + remove sensitive data (like phone numbers)
  const sanitized = userPrompt
    .trim()
    .replace(/\+?\d[\d\s-]{7,}/g, "[PHONE]");

  if (sanitized.length < 3) {
    return { valid: false, reason: "Topic too short" };
  }

  // ✅ Fast local validation (primary logic)
  if (!/[a-zA-Z]{3,}/.test(sanitized)) {
    return { valid: false, reason: "Please enter a meaningful topic" };
  }

  // 🚀 OPTIONAL AI validation (non-blocking)
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a strict validator.

Return ONLY:
{"valid": true}
OR
{"valid": false, "reason": "short reason"}

Do NOT generate content.
Do NOT return extra fields.`
        },
        {
          role: "user",
          content: sanitized
        }
      ]
    });

    let response = completion.choices?.[0]?.message?.content;

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      const match = response?.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : null;
    }

    // 🛡️ HARD GUARD: ignore bad AI responses
    if (!parsed || typeof parsed.valid !== "boolean") {
      return { valid: true }; // fallback → don't break UX
    }

    // 🧠 Detect generation drift (like title/layout JSON)
    if (parsed.title || parsed.description || parsed.layout) {
      return { valid: true };
    }

    return parsed;

  } catch (err) {
    console.error("[validateTopicMeaning]", err.message);

    // ✅ Fail open (never block user due to AI failure)
    return { valid: true };
  }
}

function fallbackValidation(text) {
  // ❌ Only numbers / symbols
  if (!/[a-zA-Z]/.test(text)) {
    return {
      valid: false,
      reason: "Please use meaningful words",
    };
  }

  // ❌ Repeated characters (gibberish)
  if (/(.)\1{4,}/.test(text)) {
    return {
      valid: false,
      reason: "This doesn't look like a clear topic",
    };
  }

  // ❌ Too random (low vowel ratio heuristic)
  const vowels = text.match(/[aeiou]/gi)?.length || 0;
  if (vowels / text.length < 0.2) {
    return {
      valid: false,
      reason: "Please enter a clearer topic",
    };
  }

  return { valid: true };
}

export async function enhanceImagePrompt(prompt = "", limit = 300) {
  if (!prompt || typeof prompt !== "string") return "";

  const sanitized = prompt.trim();
  if (!sanitized.length) return "";

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.6,
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content: `You enhance AI image generation prompts.

IMPORTANT:
- Do NOT remove or change any brand names mentioned.
- Preserve the brand tone, style, and visual identity strictly.
- If brand context is provided, incorporate it naturally.



Enhance the prompt with:
- richer visual details
- environment
- lighting
- mood
- camera style

Keep original intent intact.

Return ONLY the enhanced prompt under ${limit} characters.`
        },
        {
          role: "user",
          content: sanitized
        }
      ]
    });

    let aiResponse = completion.choices?.[0]?.message?.content || "";

    return cleanAIResponse(aiResponse, sanitized);

  } catch (err) {
    console.error("[enhanceImagePrompt] Failed:", err.message);
    return sanitized;
  }
}

export async function enhanceVideoPrompt(prompt = "", limit = 400) {
  if (!prompt || typeof prompt !== "string") return "";

  const sanitized = prompt.trim();
  if (!sanitized.length) return "";

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.7,
      max_tokens: 6000,
      messages: [
        {
          role: "system",
          content: `You enhance AI video generation prompts.

IMPORTANT:
- Never remove or alter brand names.
- Maintain brand tone, theme, and visual identity.
- Respect brand aesthetics if provided.

Enhance into a cinematic description including:
- subject/action
- environment
- motion
- camera movement
- lighting & mood

Keep original meaning intact.

Return ONLY the enhanced prompt under ${limit} characters.`
        },
        {
          role: "user",
          content: sanitized
        }
      ]
    });

    let aiResponse = completion.choices?.[0]?.message?.content || "";

    return cleanAIResponse(aiResponse, sanitized);

  } catch (err) {
    console.error("[enhanceVideoPrompt] Failed:", err.message);
    return sanitized;
  }
}
