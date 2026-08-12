// utils/formatDate.js
export const formatDate = (date, format = "DD-MMM-YYYY") => {
  if (!date) return "Present";

  const d = new Date(date);
  if (isNaN(d)) return "Present";

  const year = d.getFullYear();

  // 🔴 Sentinel years used by govt APIs
  if (year <= 1900) return "Present";

  const day = String(d.getDate()).padStart(2, "0");
  const month = d
    .toLocaleString("en-IN", { month: "short" })
    .toUpperCase();

  return `${day}-${month}-${year}`;
};
