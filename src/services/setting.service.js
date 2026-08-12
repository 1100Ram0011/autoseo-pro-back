import SettingDefinition from "../models/settingDefinition.model.js";
import SettingValue from "../models/settingValue.model.js";

export const getFullSetting = async (key) => {
  const definition = await SettingDefinition.findOne({ key }).lean();
  const values = await SettingValue.findOne({ key }).lean();

  return {
    definition,
    values: values?.values || {},
  };
};

export const getSettingValue = async (key) => {
  return await SettingValue.findOne({ key }).lean();
};

export const getSettingValues = async (key) => {
  const data = await getSettingValue(key);
  return data?.values || {};
};

const normalizeCountryPricingEntry = (entry) => {
  if (!entry || typeof entry !== "object") return null;

  const country = entry.country?.toString().toUpperCase().trim();
  if (!country) return null;

  const rawRate = Number(entry.creditRate);
  const creditRate = Number.isFinite(rawRate) ? rawRate : 1;

  return {
    country,
    countryName: entry.countryName?.toString().trim() || country,
    currency: entry.currency?.toString().toUpperCase().trim() || "USD",
    dialCode: entry.dialCode?.toString().trim() || null,
    pricingRegion: entry.pricingRegion?.toString().trim() || undefined,
    creditRate,
    paymentGateways: Array.isArray(entry.paymentGateways)
      ? entry.paymentGateways
          .map((gateway) => gateway?.toString().toLowerCase().trim())
          .filter(Boolean)
      : [],
    isActive: entry.isActive !== false,
    ...entry,
  };
};

const normalizeCountryPricingEntries = (entries) => {
  if (!entries) return [];
  if (Array.isArray(entries)) {
    return entries.map(normalizeCountryPricingEntry).filter(Boolean);
  }
  if (typeof entries === "object") {
    return Object.entries(entries)
      .map(([country, value]) => normalizeCountryPricingEntry({ country, ...value }))
      .filter(Boolean);
  }
  return [];
};

export const getCountryPricingConfig = async () => {
  const values = await getSettingValues("country_pricing");
  const entries = normalizeCountryPricingEntries(
    values.countryPricing || values.countries || []
  );
  return entries.sort((a, b) => a.country.localeCompare(b.country));
};

export const getCountryPricingForCountry = async (country) => {
  if (!country) return null;
  const normalizedCountry = country.toString().toUpperCase().trim();
  const entries = await getCountryPricingConfig();

  const directMatch = entries.find(
    (item) => item.country === normalizedCountry && item.isActive
  );
  if (directMatch) return directMatch;

  return (
    entries.find(
      (item) =>
        item.pricingRegion &&
        item.pricingRegion.toString().toUpperCase() === normalizedCountry &&
        item.isActive
    ) || null
  );
};

// ── Currency symbol lookup ──────────────────────────────────
// Keep this in sync with the `currencyOptions` used when seeding
// the "country_pricing" setting definition.
const CURRENCY_SYMBOLS = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "د.إ",
  SGD: "S$",
  JPY: "¥",
};

export const getCurrencySymbol = (currencyCode) => {
  if (!currencyCode) return "$";
  return CURRENCY_SYMBOLS[currencyCode.toString().toUpperCase()] || currencyCode;
};

// Fallback used when a country code isn't present in country_pricing
export const DEFAULT_COUNTRY_PRICING = {
  country: "US",
  currency: "USD",
  creditRate: 3,
  paymentGateways: ["payu"],
  dialCode: null,
  isActive: true,
};