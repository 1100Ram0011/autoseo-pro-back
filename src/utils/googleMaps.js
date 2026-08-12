import axios from 'axios';
import { extractWebsiteContacts } from '../controllers/Auth/businessController.js';

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const URL = process.env.VITE_BACKEND_API_URL;

// ─── Phone clean + mobile-only filter ────────────────────────────────────────
const cleanPhone = (phone) => {
    if (!phone || phone === "N/A") return null;
    const digitsOnly = phone.replace(/\D/g, '');

    const isMobile =
        (digitsOnly.length === 10 && /^[6-9]/.test(digitsOnly)) ||
        (digitsOnly.length === 12 && digitsOnly.startsWith('91') && /^91[6-9]/.test(digitsOnly)) ||
        (digitsOnly.length === 13 && digitsOnly.startsWith('091'));

    return isMobile ? phone.trim() : null;
};

// ───Remove duplicate phones ──────────────────────────────────────────────────
const uniquePhones = (arr) => {
    const seen = new Set();
    return arr.filter(p => {
        const key = p.replace(/\D/g, '');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// ─── Fetch one page from Google─────────────────────────────────────────────────
const fetchGooglePage = async (query, pageToken = null) => {
    let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
    if (pageToken) {
        url += `&pagetoken=${pageToken}`;
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
    const res = await axios.get(url);
    return res.data;
};

// ─── Process one place and build a lead ────────────────────────────────────
const buildLeadFromPlace = async (place, targetMarket, geographicFocus, query) => {
    const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=formatted_phone_number,website,address_components,user_ratings_total&key=${API_KEY}`;

    try {
        const dRes = await axios.get(detailsUrl);
        const d = dRes.data.result || {};
        const website = d.website || "N/A";
        const googlePhone = d.formatted_phone_number || null;

        
        const contacts = await extractWebsiteContacts({ websiteUrl: website });

        
        const allRawPhones = [googlePhone, ...(contacts.phones || [])];
        const allMobilePhones = uniquePhones(
            allRawPhones.map(cleanPhone).filter(Boolean)
        );

        const primaryPhone = allMobilePhones[0] || null;
        const additionalPhones = allMobilePhones.slice(1);
        const emails = contacts.emails || [];

         
        const hasAnyPhone = primaryPhone !== null || additionalPhones.length > 0;
        const hasAnyEmail = emails.length > 0;

        if (!hasAnyPhone || !hasAnyEmail) {
            console.log(`⏭️  SKIP (phone: ${hasAnyPhone}, email: ${hasAnyEmail}): ${place.name}`);
            return null;
        }

        console.log(`✅ VALID: ${place.name} | Mobile: ${primaryPhone || '—'} | +${additionalPhones.length} more | Emails: ${emails.length}`);

        return {
            name: place.name,
            address: place.formatted_address,
            phone: primaryPhone || "N/A",
            additionalPhones,
            emails,
            website,
            rating: place.rating || 0,
            reviews: d.user_ratings_total || 0,
            business_type: targetMarket,
            city: geographicFocus,
            location_name: geographicFocus,
            placeId: place.place_id,
            match_score: Math.floor(Math.random() * (98 - 85 + 1) + 85),
            search_query: query,
            location: {
                lat: place.geometry.location.lat,
                lng: place.geometry.location.lng
            }
        };

    } catch (err) {
        console.error(`❌ Error processing ${place.name}:`, err.message);
        return null;
    }
};

// ─── Main Export ──────────────────────────────────────────────────────────────
export const fetchSuppliersFromGoogle = async (targetMarket, geographicFocus, limit = 20, existingPlaceIds = new Set()) => {

     
    const queries = [
        `${targetMarket} in ${geographicFocus}`,
        `${targetMarket} near ${geographicFocus}`,
        `small ${targetMarket} in ${geographicFocus}`,
        `local ${targetMarket} ${geographicFocus}`,
    ];

    const validLeads = [];
    const processedIds = new Set();  

    for (const query of queries) {
        if (validLeads.length >= limit) break;  

        console.log(`🔍 Query: "${query}" | Valid so far: ${validLeads.length}/${limit}`);

        let rawBuffer = [];
        let bufferIndex = 0;
        let nextPageToken = null;
        let hasMorePages = true;

        
        while (hasMorePages && rawBuffer.length < limit * 3) {
            const data = await fetchGooglePage(query, nextPageToken);
            if (data.status === 'OK' && data.results?.length > 0) {
                rawBuffer = [...rawBuffer, ...data.results];
                nextPageToken = data.next_page_token || null;
                hasMorePages = !!nextPageToken;
            } else {
                hasMorePages = false;
            }
        }

         
        while (validLeads.length < limit && bufferIndex < rawBuffer.length) {
            const place = rawBuffer[bufferIndex++];

            if (processedIds.has(place.place_id)) continue; //  already processed
            processedIds.add(place.place_id);

            if (existingPlaceIds.has(place.place_id)) {
                console.log(`⏭️  SKIP (already in DB): ${place.name}`);
                continue;
            }

            const lead = await buildLeadFromPlace(place, targetMarket, geographicFocus, query);
            if (lead) {
                validLeads.push(lead);
                console.log(`📊 Progress: ${validLeads.length}/${limit}`);
            }

            // Buffer exhausted — fetch next page
            if (bufferIndex >= rawBuffer.length && hasMorePages) {
                console.log('🔄 Buffer exhausted — fetching next Google page...');
                const data = await fetchGooglePage(query, nextPageToken);
                if (data.status === 'OK' && data.results?.length > 0) {
                    rawBuffer = [...rawBuffer, ...data.results];
                    nextPageToken = data.next_page_token || null;
                    hasMorePages = !!nextPageToken;
                } else {
                    hasMorePages = false;
                }
            }
        }
    }

    if (validLeads.length < limit) {
        console.warn(`⚠️  Only ${validLeads.length}/${limit} valid leads found`);
    }

    return validLeads;
};