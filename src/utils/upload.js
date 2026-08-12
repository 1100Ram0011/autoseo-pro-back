import multer from "multer";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import s3Client from "./s3Client.js";
import config from "../config/config.js";
import logger from "../config/logger.js";

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error("Only JPG, PNG, WEBP images are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
});

export const uploadToS3 = async (
  buffer,
  key,
  folder = "",
  contentType,
  contentDisposition,
) => {
  let finalKey = folder ? `${folder}/${key}` : key;
  finalKey = `${config.AWS_S3_BASE_FOLDER}/${finalKey}`;
  const params = {
    Bucket: config.AWS_S3_BUCKET_NAME,
    Key: finalKey,
    Body: buffer,
    ContentType: contentType,
    ContentDisposition: contentDisposition,
  };

  await s3Client.send(new PutObjectCommand(params));

  if (config.CLOUDFRONT_BASE_URL) {
    return `${config.CLOUDFRONT_BASE_URL}/${finalKey}`;
  }
  return `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${finalKey}`;
};

export const deleteFromS3 = async (key) => {
  try {
    // If full URL is passed, try to extract key
    let finalKey = key;
    if (key.startsWith("http")) {
      const urlObj = new URL(key);
      finalKey = urlObj.pathname.replace(/^\/+/, "");
    }

    const params = {
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: finalKey,
    };

    await s3Client.send(new DeleteObjectCommand(params));
    logger.info(`Successfully deleted from S3: ${finalKey}`);
  } catch (error) {
    logger.error(`Failed to delete from S3: ${key}`, error);
  }
};

export default upload;

const esignS3Client = new S3Client({
  region: "ap-south-1",
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

const ESIGN_BUCKET = "MytekAi-esign";

export const uploadEsignFile = async ({
  buffer,
  fileName,
  folder = "invoice",
  contentType = "application/pdf",
  contentDisposition = "inline",
}) => {
  // auto filename if missing
  const safeFileName = fileName || `document_${Date.now()}.pdf`;

  // avoid trailing slashes
  let key = folder
    ? `${folder.replace(/\/+$/, "")}/${safeFileName}`
    : safeFileName;
  
  key = `${config.AWS_S3_BASE_FOLDER}/${key}`;

  const params = {
    Bucket: ESIGN_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentDisposition: contentDisposition, // ensures inline preview
  };

  await esignS3Client.send(new PutObjectCommand(params));

  const s3Url = `https://${ESIGN_BUCKET}.s3.ap-south-1.amazonaws.com/${key}`;

  return s3Url;
};
