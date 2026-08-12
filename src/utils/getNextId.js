import logger from "../config/logger.js";

async function getNextId(model, fieldName) {
  try {
    // Find the document with the highest ID in that field
    const lastRecord = await model
      .findOne({}, { [fieldName]: 1 })
      .sort({ [fieldName]: -1 })
      .lean();

    // If no records exist, start at 1
    if (!lastRecord) return 1;

    // Otherwise return max + 1
    return lastRecord[fieldName] + 1;
  } catch (err) {
    logger.error("Error in getNextId:", err);
    throw err;
  }
}

export default getNextId;
