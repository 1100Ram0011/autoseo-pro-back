import * as XLSX from "xlsx";

export interface ExcelRow {
  email: string;
  name?: string;
  company?: string;
  [key: string]: any;
}

/**
 * Parse an Excel/CSV file buffer into an array of row objects.
 * Automatically detects the email column (case-insensitive).
 * Returns only rows that have a valid email address.
 */
export const parseExcel = (buffer: Buffer): ExcelRow[] => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Excel file is empty or has no sheets");

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Worksheet could not be found");
  const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (!rawRows.length) throw new Error("No data rows found in the Excel file");

  // Normalize keys: lowercase + trim
  const normalized = rawRows.map((row) => {
    const newRow: Record<string, any> = {};
    for (const key of Object.keys(row)) {
      newRow[key.trim().toLowerCase()] = String(row[key] ?? "").trim();
    }
    return newRow;
  });

  // Find email column (could be 'email', 'Email Address', 'e-mail', etc.)
  const emailAliases = ["email", "email address", "e-mail", "emailaddress", "mail"];
  const nameAliases = ["name", "full name", "fullname", "first name", "firstname", "contact name"];
  const companyAliases = ["company", "company name", "companyname", "organization", "org", "business"];

  const firstRow = normalized[0] || {};
  const emailKey = Object.keys(firstRow).find((k) => emailAliases.includes(k));
  const nameKey = Object.keys(firstRow).find((k) => nameAliases.includes(k));
  const companyKey = Object.keys(firstRow).find((k) => companyAliases.includes(k));

  if (!emailKey) {
    throw new Error(
      `No email column found. Please include a column named "email" or "Email Address". Found columns: ${Object.keys(firstRow).join(", ")}`
    );
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const rows: ExcelRow[] = normalized
    .filter((row) => emailRegex.test(row[emailKey] ?? ""))
    .map((row) => ({
      email: row[emailKey].toLowerCase(),
      name: nameKey ? row[nameKey] : undefined,
      company: companyKey ? row[companyKey] : undefined,
      ...row, // include all other columns as raw data
    }));

  if (!rows.length) {
    throw new Error("No valid email addresses found in the uploaded file");
  }

  return rows;
};

/**
 * Returns a column summary for validation feedback
 */
export const getExcelColumnPreview = (buffer: Buffer): { columns: string[]; rowCount: number; emailColumn: string | null } => {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { columns: [], rowCount: 0, emailColumn: null };

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return { columns: [], rowCount: 0, emailColumn: null };
  const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  if (!rawRows.length) return { columns: [], rowCount: 0, emailColumn: null };

  const columns = Object.keys(rawRows[0]).map((k) => k.trim());
  const emailAliases = ["email", "email address", "e-mail", "emailaddress", "mail"];
  const emailColumn = columns.find((k) => emailAliases.includes(k.toLowerCase())) ?? null;

  return { columns, rowCount: rawRows.length, emailColumn };
};
