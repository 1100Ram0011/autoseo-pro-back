import { S3Client } from "@aws-sdk/client-s3";
import config from "../config/config.js";

// Create reusable S3 client
const s3Client = new S3Client({
  region: config.AWS_REGION,
  credentials: {
    accessKeyId: config.AWS_ACCESS_KEY_ID,
    secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
  },
});

export default s3Client;
