import Groq from "groq-sdk";
import config from "../config/config.js";

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

export async function cleanLocationsWithAI(rawLocations = []) {
  if (!Array.isArray(rawLocations) || rawLocations.length === 0) return [];

  const sanitized = rawLocations
    .filter(Boolean)
    .map((l) => String(l).trim())
    .filter((l) => l.length > 0);

  if (!sanitized.length) return [];

  const prompt = `
You are a geographic normalization engine similar to Google Maps.

IMPORTANT:
- DO NOT exclude any location.
- Every input must return one structured object.
- If unclear, convert to best possible geographic equivalent.

Normalization Rules:

1. Macro Conversions:
   - "pan india" → India
   - "pan usa" → United States
   - "pan uk" → United Kingdom
   - "global" → Global
   - "remote" → Global
   - "worldwide" → Global

2. Expand abbreviations:
   - usa, us, u.s. → United States
   - uk → United Kingdom
   - uae → United Arab Emirates
   - ind → India
   - State codes (CA → California, NY → New York, etc.)

3. Fix spelling errors.

4. Remove duplicates AFTER normalization.

5. Format rules:
   - City, State, Country
   - If only country → Country
   - If Global → formatted must be "Global"

6. Use full English country names.

Return ONLY JSON array. No explanation.

Format:

[
  {
    "city": string | null,
    "state": string | null,
    "country": string,
    "formatted": string
  }
]

Locations:
${JSON.stringify(sanitized)}
`;

  let aiResponse = null;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1,
    });

    aiResponse = completion.choices?.[0]?.message?.content || "";

    aiResponse = aiResponse
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/gi, "")
      .trim();

    const start = aiResponse.indexOf("[");
    if (start === -1) return fallbackFormat(sanitized);

    let depth = 0;
    let end = -1;

    for (let i = start; i < aiResponse.length; i++) {
      if (aiResponse[i] === "[") depth++;
      else if (aiResponse[i] === "]") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }

    if (end === -1) return fallbackFormat(sanitized);

    const jsonString = aiResponse.slice(start, end + 1);
    const parsed = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) return fallbackFormat(sanitized);

    const seen = new Set();

    const cleaned = parsed
      .map((loc) => {
        if (!loc || typeof loc !== "object") return null;

        const formatted = loc.formatted?.trim();
        if (!formatted) return null;

        if (seen.has(formatted.toLowerCase())) return null;
        seen.add(formatted.toLowerCase());

        return {
          city: loc.city || null,
          state: loc.state || null,
          country: loc.country || formatted,
          formatted,
        };
      })
      .filter(Boolean);

    return cleaned.length ? cleaned : fallbackFormat(sanitized);

  } catch (err) {
    console.error(
      "[cleanLocationsWithAI] Failed:",
      err.message,
      "\nAI Response was:",
      aiResponse ?? "(no response)"
    );
    return fallbackFormat(sanitized);
  }
}

/**
 * Fallback formatter — ensures nothing is ever excluded
 */
function fallbackFormat(locations) {
  return locations.map((loc) => {
    const lower = loc.toLowerCase();

    if (lower.includes("pan india")) {
      return {
        city: null,
        state: null,
        country: "India",
        formatted: "India",
      };
    }

    if (lower.includes("global") || lower.includes("remote") || lower.includes("world")) {
      return {
        city: null,
        state: null,
        country: "Global",
        formatted: "Global",
      };
    }

    return {
      city: null,
      state: null,
      country: loc,
      formatted: loc,
    };
  });
}