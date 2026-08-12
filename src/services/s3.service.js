import fs from 'fs'
import mime from 'mime-types'

import {
  PutObjectCommand,
} from '@aws-sdk/client-s3'

import s3Client from '../utils/s3Client.js'
import config from '../config/config.js'

const getContentType = (
  filePath
) => {
  /**
   * HLS playlist
   */
  if (
    filePath.endsWith('.m3u8')
  ) {
    return 'application/vnd.apple.mpegurl'
  }

  /**
   * HLS chunks
   */
  if (
    filePath.endsWith('.ts')
  ) {
    return 'video/mp2t'
  }

  /**
   * Thumbnail
   */
  if (
    filePath.endsWith('.jpg') ||
    filePath.endsWith('.jpeg')
  ) {
    return 'image/jpeg'
  }

  /**
   * Fallback
   */
  return (
    mime.lookup(filePath) ||
    'application/octet-stream'
  )
}

export const uploadFileToS3 =
  async ({
    filePath,
    s3Key,
    contentType,
  }) => {
    const fileStream =
      fs.createReadStream(filePath)

    const resolvedContentType =
      contentType ||
      getContentType(filePath)

    const finalS3Key = `${config.AWS_S3_BASE_FOLDER}/${s3Key}`

    await s3Client.send(
      new PutObjectCommand({
        Bucket:
          process.env.AWS_S3_BUCKET_NAME,

        Key: finalS3Key,

        Body: fileStream,

        ContentType:
          resolvedContentType,

        /**
         * IMPORTANT
         */
        CacheControl:
          filePath.endsWith('.ts')
            ? 'public,max-age=31536000,immutable'
            : filePath.endsWith(
              '.m3u8'
            )
              ? 'no-cache'
              : 'public,max-age=300',
      })
    )

    return `${config.CLOUDFRONT_BASE_URL}/${finalS3Key}`
  }