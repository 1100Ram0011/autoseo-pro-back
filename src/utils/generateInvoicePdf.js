import fs from "fs";
import path from "path";
import pdf from "html-pdf-node";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { fileURLToPath } from "url";
import logger from "../config/logger.js";
import config from "../config/config.js";
import s3Client from "./s3Client.js";

// -----------------------
// __dirname fix for ES modules
// -----------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -----------------------
// Get Template Path
// -----------------------
const getTemplatePath = (templateName = "./invoice.html") => {
  const templatePath = path.join(__dirname, templateName);
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template "${templatePath}" not found`);
  }
  return templatePath;
};

// -----------------------
// Convert Logo to Base64
// -----------------------
const getLogoBase64 = (logoFileName = "./MytekAILogo.svg") => {
  const logoPath = path.join(__dirname, logoFileName);
  if (!fs.existsSync(logoPath)) {
    throw new Error(`Logo file "${logoPath}" not found`);
  }
  const logoBase64 = fs.readFileSync(logoPath, { encoding: "base64" });
  return `data:image/png;base64,${logoBase64}`;
};

// -----------------------
// Generate PDF Buffer
// -----------------------
export const generateInvoicePdfBuffer = async (
  templateName = "./invoice.html",
  data = {},
) => {
  const templatePath = getTemplatePath(templateName);
  let htmlContent = fs.readFileSync(templatePath, "utf-8");

  // Add base64 logo
  data.logo = getLogoBase64();

  // Replace {{key}} placeholders
  for (const key in data) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    htmlContent = htmlContent.replace(regex, data[key]);
  }

  // Generate PDF buffer
  const pdfBuffer = await pdf.generatePdf(
    { content: htmlContent },
    { format: "A4", printBackground: true },
  );

  return pdfBuffer;
};

// -----------------------
// Upload PDF to S3
// -----------------------
export const uploadPdfToS3 = async (pdfBuffer) => {
  const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_INVOICES_FOLDER}/invoice-${Date.now()}.pdf`;

  // Ensure pdfBuffer is a valid Buffer
  let buffer;
  if (Buffer.isBuffer(pdfBuffer)) {
    buffer = pdfBuffer;
  } else if (pdfBuffer instanceof Uint8Array) {
    buffer = Buffer.from(pdfBuffer);
  } else if (typeof pdfBuffer === "object" && pdfBuffer.pipe) {
    buffer = await new Promise((resolve, reject) => {
      const chunks = [];
      pdfBuffer.on("data", (chunk) => chunks.push(chunk));
      pdfBuffer.on("end", () => resolve(Buffer.concat(chunks)));
      pdfBuffer.on("error", reject);
    });
  } else {
    throw new Error("Invalid PDF data type. Expected Buffer or Stream.");
  }

  // Upload to S3
  await s3Client.send(
    new PutObjectCommand({
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: fileKey,
      Body: buffer,
      ContentType: "application/pdf",
    }),
  );

  // ✅ Return full S3 public URL
  const pdfUrl = `${config.CLOUDFRONT_BASE_URL}.s3.${config.AWS_REGION}.amazonaws.com/${fileKey}`;

  return pdfUrl;
};

// -----------------------
// Full Flow: Generate + Upload PDF
// -----------------------
export const generateInvoicePdf = async (templateName, data) => {
  try {
    const startTime = Date.now();

    const pdfBuffer = await generateInvoicePdfBuffer(templateName, data);
    const pdfUrl = await uploadPdfToS3(pdfBuffer);

    const duration = Date.now() - startTime;
    logger.info(`PDF Generation & Upload took ${duration}ms`);

    return { success: true, pdfUrl };
  } catch (error) {
    logger.error("❌ Error generating/uploading PDF:", error);
    return { success: false, message: error.message };
  }
};
