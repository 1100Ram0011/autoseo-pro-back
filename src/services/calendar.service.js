import axios from "axios";
import CalendarFestival from "../models/CalendarFestival.js";
import config from "../config/config.js";
import logger from "../config/logger.js";

const CALENDARIFIC_API_KEY = config.CALENDARIFIC_API_KEY;

export const syncFestivalsForCountry = async (countryCode, year) => {
  try {
    const upperCountryCode = countryCode.toUpperCase();
    logger.info(`[CalendarService] Syncing festivals for ${upperCountryCode} for year ${year}...`);

    const response = await axios.get(
      `https://calendarific.com/api/v2/holidays?api_key=${CALENDARIFIC_API_KEY}&country=${upperCountryCode}&year=${year}&type=national,local,religious,observance`,
    );

    if (response.data && response.data.meta && response.data.meta.code === 200) {
      const apiFestivals = response.data.response.holidays;
      const festivalOperations = apiFestivals.map((h) => {
        const date = h.date.datetime;
        return {
          updateOne: {
            filter: {
              name: h.name,
              countryCode: upperCountryCode,
              year: year,
              month: date.month,
              day: date.day,
            },
            update: {
              $set: {
                description: h.description || "",
                dateIso: h.date.iso,
                type: h.type || [],
                canonicalUrl: h.canonical_url || "",
                urlid: h.urlid || "",
                locations: h.locations || "All",
                states: h.states || "All",
              },
            },
            upsert: true,
          },
        };
      });

      if (festivalOperations.length > 0) {
        await CalendarFestival.bulkWrite(festivalOperations);
        logger.info(`[CalendarService] Successfully synced ${festivalOperations.length} festivals for ${upperCountryCode} (${year}).`);
        return true;
      }
    }
    return false;
  } catch (error) {
    logger.error(`[CalendarService] Error syncing festivals for ${countryCode}:`, error.message);
    return false;
  }
};
