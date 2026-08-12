import fs from "fs";
import path from "path";
import pdf from "html-pdf-node";
import { fileURLToPath } from "url";
import handlebars from "handlebars";
import logger from "../config/logger.js";
import config from "../config/config.js";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import s3Client from "../utils/s3Client.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----------------------
// Handlebars Helpers
// ----------------------
handlebars.registerHelper("eq", (a, b) => a === b);
handlebars.registerHelper("ne", (a, b) => a !== b);
handlebars.registerHelper("math", function (lvalue, operator, rvalue) {
  lvalue = parseFloat(lvalue);
  rvalue = parseFloat(rvalue);
  return {
    "+": lvalue + rvalue,
    "-": lvalue - rvalue,
    "*": lvalue * rvalue,
    "/": lvalue / rvalue,
    "%": lvalue % rvalue
  }[operator];
});

handlebars.registerHelper("formatINR", function (value) {
  if (value === null || value === undefined || value === "") return "₹ 0.00";

  const number = Number(value);
  if (isNaN(number)) return value;

  const formatted = number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `₹ ${formatted}`;
});

handlebars.registerHelper("formatCurrency", function (value, currency = "₹") {
  if (value === null || value === undefined || value === "") return "";

  const number = Number(value);
  if (isNaN(number)) return value;

  const formatted = number.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const normalizedCurrency = (currency || "").toString().trim();
  if (!normalizedCurrency || normalizedCurrency.toUpperCase() === "INR" || normalizedCurrency === "₹") {
    return `₹ ${formatted}`;
  }
  if (normalizedCurrency === "Rs") {
    return `Rs. ${formatted}`;
  }
  return `${normalizedCurrency} ${formatted}`;
});

// -----------------------
// Get Template Path
// -----------------------
const getTemplatePath = (templateName = "invoice.html") => {
  const templatePath = path.join(__dirname, "../template", templateName);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template "${templatePath}" not found`);
  }

  return templatePath;
};

// -----------------------
// Convert Logo to Base64
// -----------------------
const getLogoBase64 = () => {
  try {
    const logoPath = path.join(__dirname, "../assets/boradeai_logo.svg");

    if (fs.existsSync(logoPath)) {
      const logoBase64 = fs.readFileSync(logoPath, { encoding: "base64" });
      return `data:image/svg+xml;base64,${logoBase64}`;
    }

    logger.warn(`⚠️ Logo file not found at: ${logoPath}.`);
    return "";
  } catch (err) {
    logger.error("❌ Error in getLogoBase64:", err.message);
    return "";
  }
};

// -----------------------
// Generate PDF Buffer
// -----------------------
export const generatePdfBuffer = async (templateName, data = {}) => {
  const templatePath = getTemplatePath(templateName);
  const rawHtml = fs.readFileSync(templatePath, "utf-8");

  // Add logo to data
  data.company = data.company || {};
  data.company.logo = getLogoBase64();

  // Compile Handlebars template
  const template = handlebars.compile(rawHtml);
  const htmlContent = template(data);

  // Generate PDF buffer
  const pdfBuffer = await pdf.generatePdf(
    { content: htmlContent },
    {
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "6mm",
        bottom: "6mm",
        left: "6mm",
        right: "6mm",
      },
    },
  );

  return pdfBuffer;
};

// ----------------------
// Generate PDF Buffer from RAW HTML
// ----------------------
export const generatePdfFromHtml = async (htmlContent) => {
  const pdfBuffer = await pdf.generatePdf(
    { content: htmlContent },
    {
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: {
        top: "6mm",
        bottom: "6mm",
        left: "6mm",
        right: "6mm",
      },
    },
  );

  return pdfBuffer;
};

// ----------------------
// Upload PDF to S3
// ----------------------
export const uploadPdfToS3 = async (pdfBuffer) => {
  const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_INVOICES_FOLDER}/invoice-${Date.now()}.pdf`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: fileKey,
      Body: pdfBuffer,
      ContentType: "application/pdf",
    }),
  );

  // Return full URL
  return `${config.CLOUDFRONT_BASE_URL}/${fileKey}`;
};
