import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME || '';

export const uploadToS3 = async (
  fileBuffer: Buffer,
  fileName: string,
  folder: string = 'whatsapp-validator',
  mimeType: string = 'application/octet-stream',
  contentDisposition?: string
): Promise<string> => {
  if (!BUCKET_NAME) {
    console.error('AWS_BUCKET_NAME is not set');
    throw new Error('AWS configuration is missing');
  }

  const key = `${folder}/${fileName}`;
  
  const params: any = {
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: mimeType,
  };

  if (contentDisposition) {
    params.ContentDisposition = contentDisposition;
  }

  await s3Client.send(new PutObjectCommand(params));
  
  // Return the public URL or S3 URL based on bucket configuration
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};

export const deleteFromS3 = async (fileUrl: string): Promise<void> => {
  if (!fileUrl || !BUCKET_NAME) return;
  
  try {
    const urlObj = new URL(fileUrl);
    // Extract key from the URL, assuming standard AWS S3 format
    const key = urlObj.pathname.substring(1); 
    
    await s3Client.send(new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    }));
  } catch (error) {
    console.error('Error deleting from S3:', error);
  }
};
