"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteFromS3 = exports.uploadToS3 = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3Client = new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'ap-south-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
    }
});
const BUCKET_NAME = process.env.AWS_BUCKET_NAME || '';
const uploadToS3 = async (fileBuffer, fileName, folder = 'whatsapp-validator', mimeType = 'application/octet-stream', contentDisposition) => {
    if (!BUCKET_NAME) {
        console.error('AWS_BUCKET_NAME is not set');
        throw new Error('AWS configuration is missing');
    }
    const key = `${folder}/${fileName}`;
    const params = {
        Bucket: BUCKET_NAME,
        Key: key,
        Body: fileBuffer,
        ContentType: mimeType,
    };
    if (contentDisposition) {
        params.ContentDisposition = contentDisposition;
    }
    await s3Client.send(new client_s3_1.PutObjectCommand(params));
    // Return the public URL or S3 URL based on bucket configuration
    return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};
exports.uploadToS3 = uploadToS3;
const deleteFromS3 = async (fileUrl) => {
    if (!fileUrl || !BUCKET_NAME)
        return;
    try {
        const urlObj = new URL(fileUrl);
        // Extract key from the URL, assuming standard AWS S3 format
        const key = urlObj.pathname.substring(1);
        await s3Client.send(new client_s3_1.DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key
        }));
    }
    catch (error) {
        console.error('Error deleting from S3:', error);
    }
};
exports.deleteFromS3 = deleteFromS3;
//# sourceMappingURL=upload.service.js.map