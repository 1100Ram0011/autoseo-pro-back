import {
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import config from "../config/config.js";
import logger from "../config/logger.js";
import s3Client from "../utils/s3Client.js";

export const uploadToS3 = async (
    buffer,
    key,
    folder = "",
    contentType,
    contentDisposition
) => {
    try {
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

        const url = config.CLOUDFRONT_BASE_URL
            ? `${config.CLOUDFRONT_BASE_URL}/${finalKey}`
            : `https://${config.AWS_S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${finalKey}`;

        return {
            key: finalKey,
            url,
        };

    } catch (error) {
        logger.error(`S3 Upload Failed: ${error.message}`);
        throw new Error("S3 Upload Failed");
    }
};

export const deleteFromS3 = async (key) => {
    try {
        let finalKey = key;

        if (key.startsWith("http")) {
            const urlObj = new URL(key);
            finalKey = urlObj.pathname.replace(/^\/+/, "");
        }

        await s3Client.send(
            new DeleteObjectCommand({
                Bucket: config.AWS_S3_BUCKET_NAME,
                Key: finalKey,
            })
        );

        logger.info(`Deleted from S3: ${finalKey}`);

    } catch (error) {
        logger.error(`S3 Delete Failed: ${error.message}`);
        throw new Error("S3 Delete Failed");
    }
};
