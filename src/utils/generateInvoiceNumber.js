import Counter from "../models/Counter.js";
import DSAInvoiceCounter from "../models/DSAInvoiceCounter.js";

const getFinancialYear = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0 = Jan, 11 = Dec

  // Financial Year in India: April to March
  if (month >= 3) {
    // April (3) to December (11)
    const currentYear = String(year).slice(-2);
    const nextYear = String(year + 1).slice(-2);
    return `${currentYear}-${nextYear}`;
  } else {
    // January (0) to March (2)
    const prevYear = String(year - 1).slice(-2);
    const currentYear = String(year).slice(-2);
    return `${prevYear}-${currentYear}`;
  }
};

export const generateInvoiceNumber = async () => {
  const financialYear = getFinancialYear();
  const prefix = financialYear; // E.g., "25-26"

  const counter = await Counter.findOneAndUpdate(
    { key: prefix },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  );

  const sequence = String(counter.seq).padStart(4, "0");

  return `${prefix}/${sequence}`;
};

export const generateDSAInvoiceNumber = async (user) => {
  const financialYear = getFinancialYear();

  const baseName = (user.businessName || user.name).trim();
  const words = baseName.split(/\s+/);
  let shortName = "";

  if (words.length >= 2) {
    shortName = (words[0][0] + words[1][0]).toUpperCase();
  } else if (words[0]?.length >= 2) {
    shortName = words[0].slice(0, 2).toUpperCase();
  } else {
    shortName = words[0]?.toUpperCase();
  }

  const counter = await DSAInvoiceCounter.findOneAndUpdate(
    { userId: user._id, financialYear },
    {
      $inc: { seq: 1 },
      $setOnInsert: {
        userEmail: user.email,
        userShortName: shortName,
      },
    },
    { new: true, upsert: true },
  );

  const sequence = String(counter.seq).padStart(4, "0");

  return `SM/${financialYear}/${sequence}`;
};
