import { PutObjectCommand } from "@aws-sdk/client-s3";
import config from "../config/config.js";
import s3Client from "./s3Client.js";

export const uploadBase64ToS3 = async (base64, FolderName) => {
  const buffer = Buffer.from(base64, "base64");
  const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_IMAGES_FOLDER}/${FolderName}/${Date.now()}.png`;

  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: fileKey,
      Body: buffer,
      ContentType: "image/jpeg",
    }),
  );

  if (response?.$metadata?.httpStatusCode !== 200) {
    throw new Error("S3 upload failed");
  }

  // Return full S3 public URL
  return `${config.CLOUDFRONT_BASE_URL}/${fileKey}`;
};


export const uploadBase64VideoToS3 = async (base64Video, folderName) => {
  const buffer = Buffer.from(base64Video, "base64");

  const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_VIDEOS_FOLDER}/${folderName}/${Date.now()}.mp4`;

  const response = await s3Client.send(
    new PutObjectCommand({
      Bucket: config.AWS_S3_BUCKET_NAME,
      Key: fileKey,
      Body: buffer,
      ContentType: "video/mp4",
    })
  );

  if (response?.$metadata?.httpStatusCode !== 200) {
    throw new Error("S3 video upload failed");
  }

  return `${config.CLOUDFRONT_BASE_URL}/${fileKey}`;
};

export const uploadLogoBufferToS3 = async (base64Video, mimeType = "image/png") => {
  try {
    if (!base64Video) {
      throw new Error("Buffer is required for logo upload");
    }

    const buffer = Buffer.from(base64Video, "base64");
    // Default to PNG for logos (best practice)
    let extension = mimeType.split("/")[1] || "png";
    if (extension === "svg+xml") extension = "svg";

    const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_LOGO_FOLDER}/${Date.now()}.${extension}`;

    const response = await s3Client.send(
      new PutObjectCommand({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Key: fileKey,
        Body: buffer,
        ContentType: mimeType,
        // CacheControl: "public, max-age=31536000", // ✅ logos are static → cache aggressively
      })
    );

    if (response?.$metadata?.httpStatusCode !== 200) {
      throw new Error("Logo upload to S3 failed");
    }

    return `${config.CLOUDFRONT_BASE_URL}/${fileKey}`;
  } catch (error) {
    console.error("uploadLogoBufferToS3 error:", error);
    throw error;
  }
};

export const uploadStudioImageBufferToS3 = async (base64Data, mimeType = "image/png", businessName) => {
  try {
    if (!base64Data) {
      throw new Error("Buffer is required for studio image upload");
    }

    const buffer = Buffer.from(base64Data, "base64");
    let extension = mimeType.split("/")[1] || "png";
    if (extension === "svg+xml") extension = "svg";
    const sanitizedBusinessName = (businessName || "unknown").replace(/[^a-zA-Z0-9_-]/g, "");

    const fileKey = `${config.AWS_S3_BASE_FOLDER}/${config.AWS_S3_WEBANALYSIS_STUDIO_FOLDER}/${sanitizedBusinessName}/studio/${Date.now()}_${Math.random().toString(36).substring(7)}.${extension}`;

    const response = await s3Client.send(
      new PutObjectCommand({
        Bucket: config.AWS_S3_BUCKET_NAME,
        Key: fileKey,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    if (response?.$metadata?.httpStatusCode !== 200) {
      throw new Error("Studio image upload to S3 failed");
    }

    return `${config.CLOUDFRONT_BASE_URL}/${fileKey}`;
  } catch (error) {
    console.error("uploadStudioImageBufferToS3 error:", error);
    throw error;
  }
};

