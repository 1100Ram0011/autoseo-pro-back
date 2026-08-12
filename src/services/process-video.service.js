// services/process-video.service.js

import path from 'path'
import os from 'os'

import fsExtra from 'fs-extra'

import ffmpeg from 'fluent-ffmpeg'

import { downloadVideoFile } from './download.service.js'

import { getVideoMetadata } from './ffprobe.service.js'

import { uploadFileToS3 } from './s3.service.js'

/**
 * Generate Thumbnail
 */
const generateThumbnail =
  async ({
    inputPath,
    outputDir,
  }) => {
    await fsExtra.ensureDir(
      outputDir
    )

    return new Promise(
      (resolve, reject) => {
        ffmpeg(inputPath)
          .screenshots({
            timestamps: ['1'],

            filename:
              'thumbnail.jpg',

            folder: outputDir,

            size: '720x?',
          })

          .on(
            'end',
            () => {
              resolve(
                path.join(
                  outputDir,
                  'thumbnail.jpg'
                )
              )
            }
          )

          .on(
            'error',
            reject
          )
      }
    )
  }

/**
 * Generate Original Quality HLS
 */
const generateHls =
  async ({
    inputPath,
    outputDir,
  }) => {
    await fsExtra.ensureDir(
      outputDir
    )

    const masterPlaylistPath =
      path.join(
        outputDir,
        'master.m3u8'
      )

    return new Promise(
      (resolve, reject) => {
        ffmpeg(inputPath)

          /**
           * PRODUCTION STREAMING
           */
          .videoCodec('libx264')

          .audioCodec('aac')

          .audioBitrate('128k')

          .videoBitrate('2200k')

          .fps(30)

          .outputOptions([
            /**
             * Fast streaming
             */
            '-preset veryfast',

            /**
             * Better mobile playback
             */
            '-profile:v main',

            '-level 4.0',

            /**
             * IMPORTANT
             * 2 sec chunks
             */
            '-hls_time 2',

            /**
             * Independent chunks
             */
            '-hls_flags independent_segments',

            /**
             * Proper keyframes
             * REQUIRED
             */
            '-g 60',

            '-keyint_min 60',

            '-sc_threshold 0',

            /**
             * Streaming optimized
             */
            '-movflags +faststart',

            /**
             * Playlist
             */
            '-hls_playlist_type vod',

            '-start_number 0',

            /**
             * Better chunk loading
             */
            '-max_muxing_queue_size 2048',

            /**
             * Segment naming
             */
            '-hls_segment_filename',

            path.join(
              outputDir,
              'segment_%03d.ts'
            ),
          ])

          .output(
            masterPlaylistPath
          )

          .on(
            'start',
            (command) => {
              console.log(
                'FFMPEG_COMMAND',
                command
              )
            }
          )

          .on(
            'progress',
            (progress) => {
              console.log(
                'HLS_PROGRESS',
                progress.percent
              )
            }
          )

          .on(
            'end',
            () => {
              console.log(
                'HLS_GENERATION_COMPLETED'
              )

              resolve(
                masterPlaylistPath
              )
            }
          )

          .on(
            'error',
            (error) => {
              console.error(
                'HLS_GENERATION_FAILED',
                error
              )

              reject(error)
            }
          )

          .run()
      }
    )
  }
/**
 * Upload all HLS files
 */
const uploadHlsDirectory =
  async ({
    outputDir,
    processedVideoId,
  }) => {
    const uploadedFiles = []

    const getAllFiles =
      async (dir) => {
        const entries =
          await fsExtra.readdir(
            dir,
            {
              withFileTypes: true,
            }
          )

        const files =
          await Promise.all(
            entries.map(
              async (
                entry
              ) => {
                const fullPath =
                  path.join(
                    dir,
                    entry.name
                  )

                return entry.isDirectory()
                  ? getAllFiles(
                      fullPath
                    )
                  : fullPath
              }
            )
          )

        return files.flat()
      }

    const files =
      await getAllFiles(
        outputDir
      )

    for (const absolutePath of files) {
      const relativePath =
        path.relative(
          outputDir,
          absolutePath
        )

      const normalizedPath =
        relativePath
          .split(path.sep)
          .join('/')

      const s3Key = `${process.env.AWS_PROCCESS_VIDEOS_FOLDER}/${processedVideoId}/${normalizedPath}`

      console.log(
        'UPLOADING_FILE',
        s3Key
      )

      const url =
        await uploadFileToS3({
          filePath:
            absolutePath,

          s3Key,
        })

      uploadedFiles.push({
        path: normalizedPath,

        url,
      })
    }

    return uploadedFiles
  }

/**
 * MAIN PROCESSOR
 */
export const processVideoToHls =
  async ({
    mp4Url,
    processedVideoId,
  }) => {
    const tempRoot = path.join(
      os.tmpdir(),
      processedVideoId.toString()
    )

    const hlsDir = path.join(
      tempRoot,
      'hls'
    )

    const thumbnailDir =
      path.join(
        tempRoot,
        'thumbnail'
      )

    try {
      await fsExtra.ensureDir(
        tempRoot
      )

      /**
       * Download
       */
      console.log(
        'DOWNLOADING_VIDEO'
      )

      const inputPath =
        await downloadVideoFile({
          videoUrl: mp4Url,

          outputDir: tempRoot,
        })

      /**
       * Metadata
       */
      console.log(
        'READING_METADATA'
      )

      const metadata =
        await getVideoMetadata(
          inputPath
        )

      console.log(
        'VIDEO_METADATA',
        metadata
      )

      /**
       * Generate thumbnail
       */
      console.log(
        'GENERATING_THUMBNAIL'
      )

      const thumbnailPath =
        await generateThumbnail({
          inputPath,

          outputDir:
            thumbnailDir,
        })

      /**
       * Generate HLS
       */
      console.log(
        'GENERATING_HLS'
      )

      await generateHls({
        inputPath,

        outputDir: hlsDir,
      })

      /**
       * Upload HLS
       */
      console.log(
        'UPLOADING_HLS'
      )

      await uploadHlsDirectory({
        outputDir: hlsDir,

        processedVideoId,
      })

      /**
       * Upload Thumbnail
       */
      console.log(
        'UPLOADING_THUMBNAIL'
      )

      const thumbnailUrl =
        await uploadFileToS3({
          filePath:
            thumbnailPath,

          s3Key: `${process.env.AWS_PROCCESS_VIDEOS_FOLDER}/${processedVideoId}/thumbnail.jpg`,
        })

      /**
       * Final URLs
       */
      const masterPlaylistUrl = `${process.env.CLOUDFRONT_BASE_URL}/${process.env.AWS_PROCCESS_VIDEOS_FOLDER}/${processedVideoId}/master.m3u8`

      console.log(
        'PROCESSING_COMPLETED'
      )

      return {
        sourceUrl: mp4Url,

        masterPlaylistUrl,

        thumbnailUrl,

        width: metadata.width,

        height: metadata.height,

        bitrate:
          metadata.bitrate,

        codec: metadata.codec,

        duration:
          metadata.duration,

        processingStatus:
          'completed',
      }
    } catch (error) {
      console.error(
        'VIDEO_PROCESSING_FAILED',
        error
      )

      throw error
    } finally {
      await fsExtra.remove(
        tempRoot
      )
    }
  }